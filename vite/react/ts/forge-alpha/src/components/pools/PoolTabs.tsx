import React from 'react'

interface PoolTabsProps {
  activeTab: 'pools' | 'swap' | 'deposit'
  onChange: (tab: 'pools' | 'swap' | 'deposit') => void
}

const tabLabels: Record<PoolTabsProps['activeTab'], string> = {
  pools: 'Pools',
  swap: 'Swap',
  deposit: 'Deposit'
}

const PoolTabs = ({ activeTab, onChange }: PoolTabsProps) => {
  return (
    <div className="flex space-x-2 border-b border-white/20">
      {(Object.keys(tabLabels) as PoolTabsProps['activeTab'][]).map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`px-4 py-2 rounded-t text-sm font-semibold ${
            activeTab === tab
              ? 'bg-black text-forge-orange border border-white/20 border-b-0'
              : 'bg-black/40 text-white/50 hover:text-white'
          }`}
        >
          {tabLabels[tab]}
        </button>
      ))}
    </div>
  )
}

export default PoolTabs
