// src/App.tsx
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'

import { WalletProvider } from './contexts/WalletContext'
import { AssetProvider } from './contexts/AssetContext'
import { NodeProvider } from './contexts/NodeContext'
import { PoolProvider } from './contexts/PoolContext'
import { TransactionProvider } from './contexts/TransactionContext'
import { PriceProvider } from './contexts/PriceContext'
import { ViewStateProvider } from './contexts/ViewStateContext'
import { ForgeProvider } from './contexts/ForgeContext'
import { ChartProvider } from './contexts/ChartContext'

import Layout from './components/layout/Layout'
import './App.css'
import { TickerRegistryProvider } from './contexts/TickerContext'

// Lazy-load pages (route-level code splitting)
const Trade = lazy(() => import('./pages/Trade'))
const Pools = lazy(() => import('./pages/Pools'))
const Tools = lazy(() => import('./pages/Tools'))
// const Bridge = lazy(() => import('./pages/Bridge'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
      retry: 2,
    },
  },
})

function App() {
  return (
    <>
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          // Remove default styles to let custom toasts handle styling
          style: {},
          success: {
            iconTheme: {
              primary: '#ff6b35',
              secondary: '#fff',
            },
          },
          error: {
            duration: 6000,
          },
        }}
      />
      <QueryClientProvider client={queryClient}>
        <ViewStateProvider>
          <NodeProvider>
            <ForgeProvider>
              <WalletProvider>
                <TransactionProvider>
                  <PoolProvider>
                    <AssetProvider>
                      <PriceProvider>
                        <ChartProvider>
                          <TickerRegistryProvider>
                            <Router>
                              <Layout>
                                <Suspense fallback={null /* or a tiny skeleton loader */}>
                                  <Routes>
                                    <Route path="/" element={<Trade />} />
                                    <Route path="/trade" element={<Trade />} />
                                    <Route path="/pools" element={<Pools />} />
                                    <Route path="/forge" element={<Tools />} />
                                    {/* <Route path="/bridge" element={<Bridge />} /> */}
                                  </Routes>
                                </Suspense>
                              </Layout>
                            </Router>
                          </TickerRegistryProvider>
                        </ChartProvider>
                      </PriceProvider>
                    </AssetProvider>
                  </PoolProvider>
                </TransactionProvider>
              </WalletProvider>
            </ForgeProvider>
          </NodeProvider>
        </ViewStateProvider>
      </QueryClientProvider>
    </>
  )
}

export default App
