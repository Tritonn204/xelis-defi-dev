// src/components/ticker/SegView.tsx
import React, {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useMemo,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type SegHandle = {
  /** GPU position */
  setX: (x: number) => void;
  /** Update logical index + re-render local subtree */
  setLogical: (logical: number) => void;
  /** Current measured width (cached) */
  getWidth: () => number;
  /** Force a re-measure now */
  measureWidth: () => number;
};

type SegViewProps = {
  id: number;
  /** initial logical index; parent may also change this prop */
  logical: number;
  heightCss: string;
  render: (index: number) => React.ReactNode;
};

const SegView = forwardRef<SegHandle, SegViewProps>(function SegView(
  { id, logical, heightCss, render },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Local "logical" state drives what we render via the portal.
  // Parent can change it both via prop changes and imperatively via handle.
  const [localLogical, setLocalLogical] = useState<number>(logical);

  // Render the initial content for the first paint/SSR, before portal mounts.
  const initial = useMemo(() => render(logical), [render, logical]);

  // Track when our mount point exists so we can start portaling into it.
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => {
    setMounted(!!mountRef.current);
  }, []);

  // Keep local logical in sync if the parent changes the prop.
  useEffect(() => {
    if (localLogical !== logical) setLocalLogical(logical);
  }, [logical, localLogical]);

  // Cached width of the host (updated by RO or measureWidth()).
  const widthRef = useRef<number>(0);

  // Observe size to keep width cache fresh for getWidth().
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      widthRef.current = el.offsetWidth || 0;
    });
    ro.observe(el);
    // Prime the cache
    widthRef.current = el.offsetWidth || 0;

    return () => {
      ro.disconnect();
    };
  }, []);

  useImperativeHandle(ref, () => ({
    setX(x: number) {
      const el = hostRef.current;
      if (el) el.style.transform = `translate3d(${x}px,0,0)`;
    },
    setLogical(next: number) {
      setLocalLogical(next);
    },
    getWidth() {
      return widthRef.current;
    },
    measureWidth() {
      const el = hostRef.current;
      if (!el) return widthRef.current;
      widthRef.current = el.offsetWidth || 0;
      return widthRef.current;
    },
  }));

  return (
    <div
      ref={hostRef}
      data-seg-id={id}
      style={{
        position: "absolute",
        top: 0,
        height: heightCss,
        transform: "translate3d(0,0,0)",
        willChange: "transform",
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
      }}
    >
      {/* Local mount point for the portal */}
      <div ref={mountRef} style={{ height: "100%" }}>
        {/* SSR/first paint fallback (hidden/replaced once portal mounts) */}
        {!mounted && <div style={{ height: "100%" }}>{initial}</div>}

        {/* After mount, render via portal into the same node */}
        {mounted && mountRef.current
          ? createPortal(
              <div style={{ height: "100%" }}>{render(localLogical)}</div>,
              mountRef.current
            )
          : null}
      </div>
    </div>
  );
});

export default React.memo(SegView);
