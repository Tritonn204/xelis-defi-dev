import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback,
  useMemo,
} from "react";

export type TickerSnapshot = {
  segs: Array<{ id: number; logical: number; width: number }>;
  pos: Record<number, number>;
  widths: Record<number, number>;
  nextId: number;
  forward: number;
  backward: number;
  // optional: root logical index
  root?: number;
};

type Registry = Record<string, TickerSnapshot>;

type Ctx = {
  getSnapshot: (id: string) => TickerSnapshot | null;
  setSnapshot: (id: string, snap: TickerSnapshot) => void;
  removeSnapshot: (id: string) => void;
  getRoot: (id: string) => number | null;
  setRoot: (id: string, value: number) => void;
};

const TickerRegistryCtx = createContext<Ctx | null>(null);

export const TickerRegistryProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [registry, setRegistry] = useState<Registry>({});

  const getSnapshot = useCallback(
    (id: string) => registry[id] ?? null,
    [registry]
  );

  const setSnapshot = useCallback((id: string, snap: TickerSnapshot) => {
    setRegistry((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...snap },
    }));
  }, []);

  const removeSnapshot = useCallback((id: string) => {
    setRegistry((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const getRoot = useCallback(
    (id: string) => {
      const snap = registry[id];
      return snap?.root ?? null;
    },
    [registry]
  );

  const setRoot = useCallback((id: string, value: number) => {
    setRegistry((prev) => {
      const existing = prev[id] ?? ({} as TickerSnapshot);
      return {
        ...prev,
        [id]: { ...existing, root: value },
      };
    });
  }, []);

  // 👇 this is the important part: stable value
  const value = useMemo<Ctx>(
    () => ({
      getSnapshot,
      setSnapshot,
      removeSnapshot,
      getRoot,
      setRoot,
    }),
    [getSnapshot, setSnapshot, removeSnapshot, getRoot, setRoot]
  );

  return (
    <TickerRegistryCtx.Provider value={value}>
      {children}
    </TickerRegistryCtx.Provider>
  );
};

export const useTickerRegistry = () => {
  return useContext(TickerRegistryCtx);
};