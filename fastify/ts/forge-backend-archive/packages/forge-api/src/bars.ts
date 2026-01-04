import type { Bar } from '@forge-backend/shared/utils/types'; // ← reuse shared Bar

export function invertBar(b: Bar): Bar {
  const invO = 1 / b.o;
  const invC = 1 / b.c;
  const invH = 1 / b.l; // highs/lows swap when inverted
  const invL = 1 / b.h;
  return { t:b.t, o:invO, h:invH, l:invL, c:invC, v:b.v };
}

export function multiplyBars(a: Bar[], b: Bar[]): Bar[] {
  if (!a.length || !b.length) return [];
  const mb = new Map<number, Bar>(); for (const x of b) mb.set(x.t, x);
  const out: Bar[] = [];
  for (const x of a) {
    const y = mb.get(x.t);
    if (!y) continue;
    out.push({ t:x.t, o:x.o*y.o, h:x.h*y.h, l:x.l*y.l, c:x.c*y.c, v:x.v });
  }
  out.sort((p,q)=>p.t-q.t);
  return out;
}