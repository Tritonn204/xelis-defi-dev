import React, { useRef, useState, useEffect } from "react";
import Ticker from "./Ticker";

type ScrollTickerProps = {
  speed: number; // base px/s, positive = left
  height?: number | string;
  loopGap?: number;
  children: (index: number) => React.ReactNode;
  /** forward to Ticker so it can persist X/logical state */
  persistId?: string;
};

type PointerSnap = { x: number; time: number };

const CAP = 2500;

const ScrollTicker: React.FC<ScrollTickerProps> = ({
  speed: baseSpeed,
  height = "3rem",
  loopGap = 40,
  children,
  persistId, // 👈 new
}) => {
  const [renderSpeed, setRenderSpeed] = useState(baseSpeed);

  const pointerRef = useRef<PointerSnap | null>(null);
  const velRef = useRef(baseSpeed);
  const targetRef = useRef(baseSpeed);
  const rafRef = useRef<number | null>(null);

  const start = (
    e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>
  ) => {
    if ("touches" in e) {
      const t = e.touches[0];
      pointerRef.current = { x: t.clientX, time: e.timeStamp };
    } else {
      pointerRef.current = { x: e.clientX, time: e.timeStamp };
    }
  };

  const end = () => {
    // keep direction of current velocity, fall back to base magnitude
    const v = velRef.current;
    const dir = v === 0 ? 1 : Math.sign(v);
    targetRef.current = dir * Math.abs(baseSpeed);
    pointerRef.current = null;
  };

  const updateFrom = (x: number, time: number) => {
    if (!pointerRef.current) return;
    const dx = x - pointerRef.current.x;
    const dt = time - pointerRef.current.time;
    if (dt > 0) {
      // pointer right → content right → NEGATIVE vel
      let v = ((dx * 1000) / dt) * -1;
      // light clamp just so it's not insane
      if (v > CAP) v = CAP;
      if (v < -CAP) v = -CAP;
      velRef.current = v;
      targetRef.current = v; // while dragging, follow pointer
    }
    pointerRef.current = { x, time };
  };

  const moveMouse = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pointerRef.current) return;
    updateFrom(e.clientX, e.timeStamp);
  };

  const moveTouch = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!pointerRef.current) return;
    const t = e.targetTouches[0];
    if (!t) return;
    updateFrom(t.clientX, e.timeStamp);
  };

  // little physics loop
  useEffect(() => {
    const step = () => {
      const dragging = !!pointerRef.current;
      const v = velRef.current;
      const tgt = targetRef.current;

      let nextV = v;
      if (!dragging) {
        const diff = tgt - v;
        if (Math.abs(diff) < 0.5) {
          nextV = tgt;
        } else {
          // smooth-ish falloff
          const step = Math.sign(diff) * Math.max(Math.abs(diff) * 0.0125, 8);
          nextV = v + step;
        }
      }

      velRef.current = nextV;

      // only re-render when needed
      if (Math.abs(nextV - renderSpeed) > 0.5) {
        setRenderSpeed(nextV);
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [renderSpeed, baseSpeed]);

  // if baseSpeed prop changes, adjust target for future easing
  useEffect(() => {
    const dir = Math.sign(velRef.current || 1);
    targetRef.current = dir * Math.abs(baseSpeed);
  }, [baseSpeed]);

  return (
    <div
      style={{ cursor: "pointer", height }}
      onMouseDown={start}
      onMouseUp={end}
      onMouseLeave={end}
      onMouseMove={moveMouse}
      onTouchStart={start}
      onTouchEnd={end}
      onTouchCancel={end}
      onTouchMove={moveTouch}
    >
      <Ticker
        speed={renderSpeed}
        height={height}
        loopGap={loopGap}
        persistId={persistId} // 👈 pass through
      >
        {children}
      </Ticker>
    </div>
  );
};

export default ScrollTicker;
