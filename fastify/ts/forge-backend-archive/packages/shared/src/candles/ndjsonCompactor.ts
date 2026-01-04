// src/candles/ndjsonCompactor.ts
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Candle, Resolution } from './types';
import { bucketStart } from './diskStore';

const DAY = 86400_000;

// stages: move rows older than cutoffDays from src → dst
const STAGES: Array<{src: Resolution, dst: Resolution, cutoffDays: number}> = [
  { src: '1',   dst: '5',   cutoffDays: 30 },
  { src: '5',   dst: '15',  cutoffDays: 90 },
  { src: '15',  dst: '60',  cutoffDays: 180 },
  { src: '60',  dst: '240', cutoffDays: 365 },
  { src: '240', dst: '1D',  cutoffDays: 730 },
  { src: '1D',  dst: '1W',  cutoffDays: 1825 },
  { src: '1W',  dst: '1M',  cutoffDays: 3650 },
];

const MINUTES: Record<'1'|'5'|'15'|'60'|'240', number> = {
  '1':1,'5':5,'15':15,'60':60,'240':240
};

function resDir(base: string, symbol: string, res: Resolution) {
  return path.join(base, symbol, res.toLowerCase());
}

function ymd(ts: number) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function ym(ts: number) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}
function startOfDayUTC(ts: number) { const d = new Date(ts); d.setUTCHours(0,0,0,0); return d.getTime(); }
function startOfWeekUTC_Mon(ts: number) { const d = new Date(ts); d.setUTCHours(0,0,0,0); const dow = d.getUTCDay(); const delta = (dow===0?-6:1-dow); d.setUTCDate(d.getUTCDate()+delta); return d.getTime(); }
function startOfMonthUTC(ts: number) { const d = new Date(ts); d.setUTCDate(1); d.setUTCHours(0,0,0,0); return d.getTime(); }

async function append(destFile: string, c: Candle) {
  await fs.mkdir(path.dirname(destFile), { recursive: true });
  await fs.appendFile(destFile, JSON.stringify(c) + '\n', 'utf8');
}

async function readDayFile(fp: string): Promise<Candle[]> {
  try {
    const text = await fs.readFile(fp, 'utf8');
    if (!text) return [];
    return text.split('\n').filter(Boolean).map(ln => JSON.parse(ln) as Candle);
  } catch { return []; }
}

function aggregateTo(res: Resolution, base: Candle[]): Candle[] {
  if (!base.length) return [];
  base.sort((a,b) => a.t - b.t);
  const out: Candle[] = [];
  let cur = -1;
  let acc: Candle | null = null;
  for (const b of base) {
    const buck = bucketStart(res, b.t);
    if (buck !== cur) {
      if (acc) out.push(acc);
      cur = buck;
      acc = { t: buck, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
    } else {
      if (!acc) continue;
      if (b.h > acc.h) acc.h = b.h;
      if (b.l < acc.l) acc.l = b.l;
      acc.c = b.c;
      acc.v += b.v;
    }
  }
  if (acc) out.push(acc);
  return out;
}

// Compact minute/hour/day tiers where files are day-granular
async function compactDayTier(baseDir: string, symbol: string, src: '1'|'5'|'15'|'60'|'240'|'1D', dst: Resolution, cutoffMs: number) {
  const dir = resDir(baseDir, symbol, src);
  let files: string[] = [];
  try { files = (await fs.readdir(dir)).filter(n => n.endsWith('.ndjson')); } catch { return; }
  if (!files.length) return;

  for (const name of files) {
    const dayStr = name.replace('.ndjson',''); // YYYY-MM-DD
    const dayTs = Date.parse(dayStr + 'T00:00:00Z');
    const dayEnd = dayTs + DAY - 1;
    if (isNaN(dayTs)) continue;
    if (dayEnd >= cutoffMs) continue; // only process fully older days

    const fp = path.join(dir, name);
    const rows = await readDayFile(fp);
    if (!rows.length) { await fs.unlink(fp).catch(() => {}); continue; }

    const agg = aggregateTo(dst, rows);
    // Write each aggregated row to its destination file
    for (const c of agg) {
      const dfp =
        (dst === '1' || dst === '5' || dst === '15' || dst === '60' || dst === '240' || dst === '1D')
          ? path.join(resDir(baseDir, symbol, dst), `${ymd(c.t)}.ndjson`)
          : (dst === '1W')
            ? path.join(resDir(baseDir, symbol, '1W'), `wk_${ymd(startOfWeekUTC_Mon(c.t))}.ndjson`)
            : path.join(resDir(baseDir, symbol, '1M'), `${ym(c.t)}.ndjson`);
      await append(dfp, c);
    }

    // delete src day after success
    await fs.unlink(fp).catch(() => {});
  }
}

// Compact 1D → 1W (weeks), deleting source day files for processed weeks
async function compactDaysToWeeks(baseDir: string, symbol: string, cutoffMs: number) {
  const srcDir = resDir(baseDir, symbol, '1D');
  let files: string[] = [];
  try { files = (await fs.readdir(srcDir)).filter(n => n.endsWith('.ndjson')); } catch { return; }
  if (!files.length) return;

  // Group day files by week-start
  const bucket: Map<number, string[]> = new Map();
  for (const name of files) {
    const dayTs = Date.parse(name.replace('.ndjson','') + 'T00:00:00Z');
    if (isNaN(dayTs)) continue;
    const wk = startOfWeekUTC_Mon(dayTs);
    if (wk + 7*DAY - 1 >= cutoffMs) continue; // only full weeks older than cutoff
    const arr = bucket.get(wk) ?? [];
    arr.push(name);
    bucket.set(wk, arr);
  }

  for (const [wkStart, dayFiles] of bucket.entries()) {
    // Read all days in that week
    const rows: Candle[] = [];
    for (const name of dayFiles) {
      const fp = path.join(srcDir, name);
      rows.push(...await readDayFile(fp));
    }
    if (!rows.length) continue;

    const weekBar = aggregateTo('1W', rows);
    for (const c of weekBar) {
      const dfp = path.join(resDir(baseDir, symbol, '1W'), `wk_${ymd(wkStart)}.ndjson`);
      await append(dfp, c);
    }

    // delete those source day files
    for (const name of dayFiles) {
      await fs.unlink(path.join(srcDir, name)).catch(() => {});
    }
  }
}

// Compact 1W → 1M (weekly files are per-week start); delete processed weeks
async function compactWeeksToMonths(baseDir: string, symbol: string, cutoffMs: number) {
  const srcDir = resDir(baseDir, symbol, '1W');
  let files: string[] = [];
  try { files = (await fs.readdir(srcDir)).filter(n => n.startsWith('wk_') && n.endsWith('.ndjson')); } catch { return; }
  if (!files.length) return;

  // Group week files by month (based on week-start)
  const groups: Map<string, string[]> = new Map(); // key = YYYY-MM
  for (const name of files) {
    const iso = name.slice(3, 3 + 'YYYY-MM-DD'.length); // wk_YYYY-MM-DD.ndjson
    const wkStart = Date.parse(iso + 'T00:00:00Z');
    if (isNaN(wkStart)) continue;
    if (wkStart + 7*DAY - 1 >= cutoffMs) continue; // only older weeks
    const monthKey = ym(wkStart);
    const arr = groups.get(monthKey) ?? [];
    arr.push(name);
    groups.set(monthKey, arr);
  }

  for (const [monthKey, wkFiles] of groups.entries()) {
    const rows: Candle[] = [];
    for (const name of wkFiles) {
      const fp = path.join(srcDir, name);
      rows.push(...await readDayFile(fp)); // weekly files contain 1 candle; still fine
    }
    if (!rows.length) continue;

    const monthBar = aggregateTo('1M', rows);
    for (const c of monthBar) {
      const dfp = path.join(resDir(baseDir, symbol, '1M'), `${monthKey}.ndjson`);
      await append(dfp, c);
    }

    // delete source week files
    for (const name of wkFiles) {
      await fs.unlink(path.join(srcDir, name)).catch(() => {});
    }
  }
}

export async function runNdjsonCompaction(baseDir: string, symbols: string[], now = Date.now()) {
  for (const symbol of symbols) {
    for (const stage of STAGES) {
      const cutoffMs = now - stage.cutoffDays * DAY;

      if (stage.src === '1D' && stage.dst === '1W') {
        await compactDaysToWeeks(baseDir, symbol, cutoffMs);
        continue;
      }
      if (stage.src === '1W' && stage.dst === '1M') {
        await compactWeeksToMonths(baseDir, symbol, cutoffMs);
        continue;
      }

      // minute/hour/day step where files are day-aligned
      await compactDayTier(baseDir, symbol, stage.src as any, stage.dst, cutoffMs);
    }
  }
}
