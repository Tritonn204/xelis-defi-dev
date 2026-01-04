import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import Decimal from 'decimal.js';

export type CanonRes = { A: string; B: string; t: number };

export class ReservesStore {
  private file: string;
  private last: Record<string, CanonRes> = {};

  constructor(dir: string, filename = 'reserves.json') {
    this.file = path.join(dir, filename);
  }

  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true }); // ensure dir
    try { this.last = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch { this.last = {}; await fs.writeFile(this.file, '{}', 'utf8'); }
  }

  getLast(key: string) {
    const rec = this.last[key];
    return rec ? { A: new Decimal(rec.A), B: new Decimal(rec.B), t: rec.t } : undefined;
  }

  async put(key: string, A: Decimal, B: Decimal, t: number) {
    this.last[key] = { A: A.toString(), B: B.toString(), t };
    await fs.writeFile(this.file, JSON.stringify(this.last), 'utf8');
  }
}