import React, { createContext, useContext, useState } from 'react';

type SortState = Record<string, any>;

interface SortContextType {
  getState: (key: string) => SortState;
  setState: (key: string, newState: Partial<SortState>) => void;
  resetState: (key: string) => void;
}

const SortContext = createContext<SortContextType | undefined>(undefined);

export const ViewStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [store, setStore] = useState<Record<string, SortState>>({});

  const getState = (key: string): SortState => {
    return store[key] ?? {};
  };

  const setState = (key: string, newState: Partial<SortState>) => {
    setStore(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...newState,
      },
    }));
  };

  const resetState = (key: string) => {
    setStore(prev => {
      const newStore = { ...prev };
      delete newStore[key];
      return newStore;
    });
  };

  return (
    <SortContext.Provider value={{ getState, setState, resetState }}>
      {children}
    </SortContext.Provider>
  );
};

export const useViewState = (): SortContextType => {
  const context = useContext(SortContext);
  if (!context) {
    throw new Error('useViewState must be used within a ViewStateProvider');
  }
  return context;
};
