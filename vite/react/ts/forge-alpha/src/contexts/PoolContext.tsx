// contexts/PoolContext.tsx
import React, { createContext, useContext, useState } from 'react';
import type { PoolData } from '../components/pools/PoolList';

interface PoolContextType {
  activePools: Map<string, PoolData>;
  setActivePools: React.Dispatch<React.SetStateAction<Map<string, PoolData>>>;
}

const PoolContext = createContext<PoolContextType | undefined>(undefined);

export const PoolProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activePools, setActivePools] = useState<Map<string, PoolData>>(new Map());

  return (
    <PoolContext.Provider value={{ activePools, setActivePools }}>
      {children}
    </PoolContext.Provider>
  );
};

export const usePools = () => {
  const context = useContext(PoolContext);
  if (!context) {
    throw new Error('usePools must be used within a PoolProvider');
  }
  return context;
};
