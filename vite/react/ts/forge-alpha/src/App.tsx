import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WalletProvider } from './contexts/WalletContext'
import { TokenProvider } from './contexts/TokenContext'
import { NodeProvider } from './contexts/NodeContext'
import { PoolProvider } from './contexts/PoolContext'
import { TransactionProvider } from './contexts/TransactionContext'

import Layout from './components/layout/Layout'
import Trade from './pages/Trade'
import Pools from './pages/Pools'
// import Tools from './pages/Tools'
// import Bridge from './pages/Bridge'
import './App.css'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NodeProvider>
        <WalletProvider>
          <TransactionProvider>
            <PoolProvider>
              <TokenProvider>
                <Router>
                  <Layout>
                    <Routes>
                      <Route path="/" element={<Trade />} />
                      <Route path="/trade" element={<Trade />} />
                      <Route path="/pools" element={<Pools />} />
                      {/* 
                      <Route path="/tools" element={<Tools />} />
                      <Route path="/bridge" element={<Bridge />} /> */}
                    </Routes>
                  </Layout>
                </Router>
              </TokenProvider>
            </PoolProvider>
          </TransactionProvider>
        </WalletProvider>
      </NodeProvider>
    </QueryClientProvider>
  )
}

export default App