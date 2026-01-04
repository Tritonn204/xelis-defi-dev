// src/candles/scheduleCompaction.ts
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { runNdjsonCompaction } from '../candles/ndjsonCompactor';
import { getAllSymbols, ChainLike } from '../candles/discoverSymbols';

const LOCK = (baseDir: string) => path.join(baseDir, '.compaction.lock');

async function withLock<T>(baseDir: string, fn: () => Promise<T>): Promise<T | null> {
  const lock = LOCK(baseDir);
  let fd: any;
  try {
    fd = await fs.open(lock, 'wx'); // exclusive
  } catch {
    return null; // someone else (or a previous run) holds the lock
  }
  try {
    return await fn();
  } finally {
    try { await fd.close(); } catch {}
    try { await fs.unlink(lock); } catch {}
  }
}

function msUntilNextUtc(hour = 3, minute = 5) {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0
  ));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export function startDailyCompaction(baseDir: string, chain: ChainLike, hour = 3, minute = 5) {
  const schedule = async () => {
    await withLock(baseDir, async () => {
      // Re-discover symbols right before compaction
      const symbols = await getAllSymbols(baseDir, chain);
      if (!symbols.length) {
        console.log('[compaction] no symbols discovered — skipping');
        return;
      }
      console.log(`[compaction] symbols (${symbols.length}):`, symbols.slice(0, 12).join(', '), symbols.length > 12 ? '...' : '');
      await runNdjsonCompaction(baseDir, symbols, Date.now());
      console.log('[compaction] done');
    });
    setTimeout(schedule, msUntilNextUtc(hour, minute));
  };
  setTimeout(schedule, msUntilNextUtc(hour, minute));
}
