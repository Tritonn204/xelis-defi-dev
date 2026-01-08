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
  contentVersion: string | number;
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
  contentVersion
}) => {
  const registry = useTickerRegistry();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // REPLACED: map of segment handles instead of raw divs
  const segHandles = useRef<Map<number, SegHandle | null>>(new Map());

  const [renderSegs, setRenderSegs] = useState<Seg[]>([
    { id: 0, logical: 0, width: 0 },
  ]);

  const [hydrated, setHydrated] = useState(() => !persistId);
  const establishedSegs = useRef<Set<number>>(new Set());

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
  if (!hydrated) return;

  // content changed (loading -> real data, etc) => widths change => reflow
  establishedSegs.current.clear();
  widthRef.current = new Map();

  // trigger layout effect to re-measure + re-position
  setRenderSegs((prev) => [...prev]);

  // optional: second pass for async icon/font/layout settling
  const raf = requestAnimationFrame(() => {
    establishedSegs.current.clear();
    widthRef.current = new Map();
    setRenderSegs((prev) => [...prev]);
  });

  return () => cancelAnimationFrame(raf);
}, [hydrated, contentVersion]);

  useEffect(() => {
    segsRef.current = renderSegs;
  }, [renderSegs]);

  // sync transforms & cache widths after (re)render
  useLayoutEffect(() => {
    // First pass: measure and cache widths
    for (const seg of renderSegs) {
      const handle = segHandles.current.get(seg.id) || null;
      if (!handle) continue;
      // measure/cached width
      const w = handle.getWidth() || handle.measureWidth() || seg.width || 0;
      widthRef.current.set(seg.id, w);
    }

    // Second pass: fix position of NEW segments based on actual measured width
    const newSegs = renderSegs.filter(seg => !establishedSegs.current.has(seg.id));

    for (const newSeg of newSegs) {
      const newW = widthRef.current.get(newSeg.id) ?? 0;

      // Find the nearest established segment to properly space against
      let nearestEstablished = null;
      let nearestDistance = Infinity;

      for (const seg of renderSegs) {
        if (seg.id === newSeg.id || !establishedSegs.current.has(seg.id)) continue;

        const estX = posRef.current.get(seg.id) ?? 0;
        const newX = posRef.current.get(newSeg.id) ?? 0;
        const distance = Math.abs(estX - newX);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestEstablished = seg;
        }
      }

      // Adjust position based on actual width relative to nearest established segment
      if (nearestEstablished) {
        const estX = posRef.current.get(nearestEstablished.id) ?? 0;
        const estW = widthRef.current.get(nearestEstablished.id) ?? 0;
        const newX = posRef.current.get(newSeg.id) ?? 0;

        // If new segment is to the left of established
        if (newX < estX) {
          // Position it to be exactly loopGap to the left
          const correctX = estX - loopGap - newW;
          posRef.current.set(newSeg.id, correctX);
        }
        // If new segment is to the right of established
        else {
          // Position it to be exactly loopGap to the right
          const correctX = estX + estW + loopGap;
          posRef.current.set(newSeg.id, correctX);
        }
      }

      // Mark this segment as established
      establishedSegs.current.add(newSeg.id);
    }

    // Clean up removed segments from established set
    const currentIds = new Set(renderSegs.map(s => s.id));
    for (const id of establishedSegs.current) {
      if (!currentIds.has(id)) {
        establishedSegs.current.delete(id);
      }
    }

    // Third pass: apply transforms
    for (const seg of renderSegs) {
      const handle = segHandles.current.get(seg.id) || null;
      if (!handle) continue;
      const x = posRef.current.get(seg.id);
      if (x != null) {
        handle.setX(x);
      }
    }
  }, [renderSegs, loopGap]);

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
            const guessW = 200; // Estimate max element width
            const farRight = farLeft + farLeftWidth;

            // Spawn when right edge of leftmost element is about to enter viewport
            // This gives overlap correction time to position it off-screen
            if (farRight > -guessW) {
              shouldSpawn = true;
              // Position new element to the left with loopGap spacing
              spawnX = farLeft - loopGap - guessW;
            }
          }

          if (shouldSpawn) {
            // Allow 1 buffer element (logical -1) before beginning (logical 0) to prevent pop-in
            // API crash prevention handled in parent component via index < 0 check
            if (backwardRef.current < -1) {
              // Don't spawn - we've reached the buffer limit
            } else {
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

    const forceResync = () => {
      establishedSegs.current.clear();
      widthRef.current = new Map();
      setRenderSegs([...segsRef.current]);
    };

    const handleVis = () => {
      paused = document.hidden;
      if (paused) {
        saveSnapshot();
      } else {
        lastTime = null;

        // wait 1 frame so layout/paint is real again
        requestAnimationFrame(() => {
          forceResync();
        });
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
