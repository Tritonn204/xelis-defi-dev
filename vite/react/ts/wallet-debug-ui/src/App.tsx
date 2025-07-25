import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ModuleProvider } from './contexts/ModuleContext'
import { NodeProvider } from './contexts/NodeContext'
import { WalletProvider } from './contexts/WalletContext'
import { TransactionProvider } from './contexts/TransactionContext'
import { AssetProvider } from './contexts/AssetContext'
import { PriceProvider } from './contexts/PriceContext'
import Layout from './components/layout/Layout'
import OverflowDebugger from './pages/Overflow'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NodeProvider>
        <ModuleProvider>
          <WalletProvider>
            <TransactionProvider>
              <AssetProvider>
                <Router>
                  <Layout>
                    <Routes>
                      <Route path="/" element={<OverflowDebugger />} />
                      <Route path="/overflow" element={<OverflowDebugger />} />
                      {/* 
                      <Route path="/trade" element={<Trade />} />
                      <Route path="/pools" element={<Pools />} />
                      <Route path="/tools" element={<Tools />} /> */}
                    </Routes>
                  </Layout>
                </Router>
              </AssetProvider>
            </TransactionProvider>
          </WalletProvider>
        </ModuleProvider>
      </NodeProvider>
    </QueryClientProvider>
  )
}

export default App
