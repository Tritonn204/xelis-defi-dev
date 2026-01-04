import React, {
  useRef,
  useState,
  useLayoutEffect,
  useEffect,
} from "react";
import { useTickerRegistry } from "@/contexts/TickerContext";
import SegView, { SegHandle } from "./SegView";

type TickerProps = {
  /** px/s. + = move LEFT, - = move RIGHT */
  speed: number;
  height?: number | string;
  loopGap?: number;
  fillBuffer?: number;
  children: (index: number) => React.ReactNode;
  persistId?: string;
};

type Seg = {
  id: number;
  logical: number;
  width: number;
};

const Ticker: React.FC<TickerProps> = ({
  speed,
  height = "3rem",
  loopGap = 40,
  fillBuffer = 140,
  children,
  persistId,
}) => {
  const registry = useTickerRegistry();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // REPLACED: map of segment handles instead of raw divs
  const segHandles = useRef<Map<number, SegHandle | null>>(new Map());

  const [renderSegs, setRenderSegs] = useState<Seg[]>([
    { id: 0, logical: 0, width: 0 },
  ]);

  const [hydrated, setHydrated] = useState(() => !persistId);

  const segsRef = useRef<Seg[]>(renderSegs);
  const posRef = useRef<Map<number, number>>(new Map());
  const widthRef = useRef<Map<number, number>>(new Map());

  const forwardRef = useRef(1);
  const backwardRef = useRef(-1);
  const nextIdRef = useRef(1);

  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const prevDirRef = useRef<1 | -1>(speed >= 0 ? 1 : -1);

  useEffect(() => {
    if (!persistId) {
      setHydrated(true);
      return;
    }
    if (!registry) {
      setHydrated(true);
      return;
    }

    const snap = registry.getSnapshot(persistId);
    if (snap) {
      setRenderSegs(snap.segs);
      segsRef.current = snap.segs;
      posRef.current = new Map(
        Object.entries(snap.pos).map(([k, v]) => [Number(k), v as number])
      );
      widthRef.current = new Map(
        Object.entries(snap.widths).map(([k, v]) => [Number(k), v as number])
      );
      nextIdRef.current = snap.nextId;
      forwardRef.current = snap.forward;
      backwardRef.current = snap.backward;
    }

    setHydrated(true);
  }, [persistId]);

  useEffect(() => {
    segsRef.current = renderSegs;
  }, [renderSegs]);

  // sync transforms & cache widths after (re)render
  useLayoutEffect(() => {
    for (const seg of renderSegs) {
      const handle = segHandles.current.get(seg.id) || null;
      if (!handle) continue;
      // measure/cached width
      const w = handle.getWidth() || handle.measureWidth() || seg.width || 0;
      widthRef.current.set(seg.id, w);
      // apply current transform if known
      const x = posRef.current.get(seg.id);
      if (x != null) {
        handle.setX(x);
      }
    }
  }, [renderSegs]);

  const saveSnapshot = () => {
    if (!persistId || !registry) return;
    registry.setSnapshot(persistId, {
      segs: segsRef.current,
      pos: Object.fromEntries(posRef.current),
      widths: Object.fromEntries(widthRef.current),
      nextId: nextIdRef.current,
      forward: forwardRef.current,
      backward: backwardRef.current,
      root: forwardRef.current,
    });
  };

  useEffect(() => {
    if (!hydrated) return;

    const container = containerRef.current;
    if (!container) return;

    const MAX_FPS = 144;
    const MIN_FRAME_TIME = 1000 / MAX_FPS; // ~11.1ms

    let lastTime: number | null = null;
    let lastFrameTime = 0;
    let raf: number | null = null;
    let paused = document.hidden;

    const tick = (time: number) => {
      if (paused) {
        raf = requestAnimationFrame(tick);
        return;
      }

      // Cap at 90fps, but allow lower
      if (time - lastFrameTime < MIN_FRAME_TIME) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastFrameTime = time;

      if (lastTime == null) {
        lastTime = time;
        const cw = container.offsetWidth;
        const first = segsRef.current[0];
        const v0 = speedRef.current;
        const dir0: 1 | -1 = v0 >= 0 ? 1 : -1;
        if (first) {
          const w =
            widthRef.current.get(first.id) ??
            segHandles.current.get(first.id)?.getWidth() ??
            seg.width ??
            0;
          if (!posRef.current.has(first.id)) {
            if (dir0 === 1) {
              posRef.current.set(first.id, cw + fillBuffer);
            } else {
              posRef.current.set(first.id, -fillBuffer - w);
            }
          }
        }
        raf = requestAnimationFrame(tick);
        return;
      }

      const dt = (time - lastTime) / 1000;
      lastTime = time;

      const cw = container.offsetWidth;
      const v = speedRef.current;
      const dir: 1 | -1 = v >= 0 ? 1 : -1;
      const OFF = loopGap * 2;
      const RIGHT_SPAWN = cw + fillBuffer;
      const LEFT_SPAWN = -fillBuffer - cw;

      // Update positions
      const vdt = v * dt;
      for (const seg of segsRef.current) {
        const handle = segHandles.current.get(seg.id);
        const oldX = posRef.current.get(seg.id) ?? 0;
        const newX = oldX - vdt;
        posRef.current.set(seg.id, newX);
        if (handle) handle.setX(newX);
      }

      // direction change bookkeeping (unchanged)
      if (dir !== prevDirRef.current) {
        let maxLogical = -Infinity;
        let minLogical = Infinity;
        for (const seg of segsRef.current) {
          if (seg.logical > maxLogical) maxLogical = seg.logical;
          if (seg.logical < minLogical) minLogical = seg.logical;
        }
        if (dir === 1) {
          forwardRef.current =
            maxLogical === -Infinity ? 0 : maxLogical + 1;
        } else {
          backwardRef.current =
            minLogical === Infinity ? -1 : minLogical - 1;
        }
        prevDirRef.current = dir;
      }

      let needsSync = false;
      for (let pass = 0; pass < 2; pass++) { // your 2-pass recycle
        const list = segsRef.current;
        const toRemove: number[] = [];

        if (dir === 1) {
          let farRight = -Infinity;
          const posMap = posRef.current;
          const widthMap = widthRef.current;

          for (const seg of list) {
            const x = posMap.get(seg.id) ?? 0;
            const w =
              widthMap.get(seg.id) ??
              segHandles.current.get(seg.id)?.getWidth() ??
              seg.width ??
              loopGap;

            if (x + w < -OFF) {
              toRemove.push(seg.id);
            } else {
              const edge = x + w;
              if (edge > farRight) farRight = edge;
            }
          }

          if (toRemove.length) {
            segsRef.current = segsRef.current.filter(
              (s) => !toRemove.includes(s.id)
            );
            for (const id of toRemove) {
              posRef.current.delete(id);
              widthRef.current.delete(id);
            }
            needsSync = true;
          }

          let shouldSpawn = false;
          let spawnX = 0;
          if (segsRef.current.length === 0) {
            shouldSpawn = true;
            spawnX = RIGHT_SPAWN;
          } else if (farRight + loopGap < RIGHT_SPAWN) {
            shouldSpawn = true;
            spawnX = Math.max(farRight + loopGap, RIGHT_SPAWN);
          }

          if (shouldSpawn) {
            const id = nextIdRef.current++;
            const logical = forwardRef.current++;
            posRef.current.set(id, spawnX);
            widthRef.current.set(id, loopGap);
            segsRef.current = [
              ...segsRef.current,
              { id, logical, width: 0 },
            ];
            needsSync = true;
          }
        } else {
          let farLeft = Infinity;
          let farLeftWidth = 0;
          const posMap = posRef.current;
          const widthMap = widthRef.current;

          for (const seg of list) {
            const x = posMap.get(seg.id) ?? 0;
            const w =
              widthMap.get(seg.id) ??
              segHandles.current.get(seg.id)?.getWidth() ??
              seg.width ??
              loopGap;

            if (x > cw + OFF) {
              toRemove.push(seg.id);
            } else {
              if (x < farLeft) {
                farLeft = x;
                farLeftWidth = w;
              }
            }
          }

          if (toRemove.length) {
            segsRef.current = segsRef.current.filter(
              (s) => !toRemove.includes(s.id)
            );
            for (const id of toRemove) {
              posRef.current.delete(id);
              widthRef.current.delete(id);
            }
            needsSync = true;
          }

          let shouldSpawn = false;
          let spawnX = 0;
          if (segsRef.current.length === 0) {
            const guessW = loopGap;
            shouldSpawn = true;
            spawnX = -(fillBuffer + guessW);
          } else {
            const guessW = farLeftWidth || loopGap;
            if (farLeft - guessW - loopGap > -fillBuffer - guessW) {
              shouldSpawn = true;
              const candidate = farLeft - loopGap - guessW;
              const minOff = -(fillBuffer + guessW);
              spawnX = Math.min(candidate, minOff);
            }
          }

          if (shouldSpawn) {
            const id = nextIdRef.current++;
            const logical = backwardRef.current--;
            posRef.current.set(id, spawnX);
            widthRef.current.set(id, loopGap);
            segsRef.current = [
              ...segsRef.current,
              { id, logical, width: 0 },
            ];
            needsSync = true;
          }
        }

        if (!needsSync) break;
      }

      if (needsSync) {
        setRenderSegs(segsRef.current);
        saveSnapshot();
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    const handleVis = () => {
      paused = document.hidden;
      if (paused) {
        saveSnapshot();
      } else {
        lastTime = null;
      }
    };

    document.addEventListener("visibilitychange", handleVis);

    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVis);
      saveSnapshot();
    };
  }, [hydrated, loopGap, fillBuffer, persistId]);

  const heightCss = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      ref={containerRef}
      style={{
        overflow: "hidden",
        whiteSpace: "nowrap",
        position: "relative",
        height: heightCss,
        width: "100%",
        contain: "layout style paint",
        willChange: "contents",
      }}
    >
      {renderSegs.map((seg) => (
        <SegView
          key={seg.id}
          id={seg.id}
          logical={seg.logical}
          heightCss={heightCss}
          render={children}
          ref={(h) => {
            if (h) segHandles.current.set(seg.id, h);
            else segHandles.current.delete(seg.id);
          }}
        />
      ))}
    </div>
  );
};

export default Ticker;
