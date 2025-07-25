import { Link, useLocation } from 'react-router-dom'
import { useWallet } from '@/contexts/WalletContext'
import { useNode } from '@/contexts/NodeContext'
import { useAssets } from '@/contexts/AssetContext'
import { useEffect, useState } from 'react'
import { ModuleContractField, useModuleContext } from '@/contexts/ModuleContext'

import { ChevronDown, Globe, RefreshCw, Settings } from 'lucide-react'

import Button from '../ui/Button'
import CustomNetworkModal from '@/components/modal/CustomNetworkModal'
import Tooltip from '../ui/Tooltip'

import bannerImage from '@/assets/banner.png'
import bgImage from '@/assets/bg.png'

const Layout = ({ children }) => {
  const location = useLocation()
  const { isConnected, address, connectWallet, connecting } = useWallet()
  const {
    currentNode,
    networkMismatch,
    connectToCustomNetwork,
    isConnected: nodeConnected
  } = useNode()
  const { error: assetError, loading: assetsLoading, refreshAssets } = useAssets()
  const { registerModule } = useModuleContext()

  const [showNetworkDropdown, setShowNetworkDropdown] = useState(false)
  const [showCustomModal, setShowCustomModal] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    registerModule('overflow', [
      { key: 'overflow', label: 'Overflow Module Address', required: true, default: '0cde643f30e0e4b1dad569acae3e1687ee5b58f53a41a58c25609f0423b82fe2' }
    ])
  }, [])


  const { getContracts } = useModuleContext()
  const [contractFields, setContractFields] = useState<ModuleContractField[]>([])

  useEffect(() => {
    const fields = Object.entries(getContracts()).flatMap(([_, fields]) => fields)
    setContractFields(fields)
  }, [getContracts])

  
  const handleRefreshAssets = async () => {
    setIsRefreshing(true)
    await refreshAssets()
    setTimeout(() => setIsRefreshing(false), 500)
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 bottom-0"
      style={{
        backgroundImage: `url(${bgImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-sm">
        <div className="w-full px-5">
          <div className="relative flex items-center justify-between h-20">
            
            {/* Left: Debug Modules Dropdown */}
            <div className="relative z-10">
              <Button
                onClick={() => setShowNetworkDropdown(!showNetworkDropdown)}
                className="flex items-center space-x-2 bg-black/60 text-white px-4 py-2 rounded-md hover:bg-black/80 transition-colors"
                focusOnClick={false}
              >
                <span className="text-md">☰ Debug Modules</span>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </Button>

              {showNetworkDropdown && (
                <div className="absolute top-full mt-2 left-0 bg-black/80 border border-white/10 rounded-md z-50 min-w-[180px]">
                  <Link
                    to="/overflow"
                    className="block px-4 py-2 text-white hover:bg-black/60 transition"
                    onClick={() => setShowNetworkDropdown(false)}
                  >
                    Overflow
                  </Link>
                  {/* Add more modules here */}
                </div>
              )}
            </div>

            {/* Right: Wallet, Node, Settings */}
            <div className="flex items-center space-x-3">
              {/* Refresh + Error */}
              {isConnected && (
                <div className="flex items-center space-x-2">
                  {assetError && (
                    <span className="text-forge-orange text-sm">
                      Failed to load assets
                    </span>
                  )}
                  <Tooltip
                    content="Refresh Data"
                    bgColor="bg-black/50"
                    fontSize="sm"
                    position="bottom"
                    delay={1000}
                  >
                    <Button
                      onClick={handleRefreshAssets}
                      className="text-gray-300 hover:text-white p-1.5 rounded-md hover:bg-black/50 transition-all duration-200"
                      disabled={assetsLoading || isRefreshing}
                      focusOnClick={false}
                    >
                      <RefreshCw
                        className={`w-5 h-5 ${
                          assetsLoading || isRefreshing ? 'animate-spin' : ''
                        }`}
                      />
                    </Button>
                  </Tooltip>
                </div>
              )}

              {/* Wallet Address or Connect */}
              {isConnected ? (
                <div className="bg-black/70 px-4 py-2 rounded-md">
                  <span className="text-[1rem] text-white font-light">
                    {address?.slice(0, 10)}...{address?.slice(-4)}
                  </span>
                </div>
              ) : (
                <Button
                  onClick={connectWallet}
                  className="bg-white text-black px-2.5 py-1 rounded-md text-[1.3rem] font-light transition-all duration-200 ring-forge-orange hover:ring-2 hover:scale-[1.02]"
                  isLoading={connecting}
                  focusOnClick={false}
                  staticSize={true}
                >
                  Connect
                </Button>
              )}

              {/* Node Connection Button */}
              <Button
                onClick={() => setShowCustomModal(true)}
                className="flex items-center space-x-2 bg-transparent px-3 py-2 rounded-md hover:bg-black/70 transition-colors"
                focusOnClick={false}
              >
                <Globe className={`w-5 h-5 ${nodeConnected ? 'text-white' : 'text-red-800'}`} />
                <span className="text-white font-normal text-md">
                  {nodeConnected ? currentNode?.url : 'No Daemon'}
                </span>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </Button>

              {/* Settings Icon (optional future use) */}
              <Button className="text-gray-300 hover:text-white rounded-full" onClick={() => {}}>
                <Settings className="w-8 h-8" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="overflow-y-auto h-full pt-20 scrollbar scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>

      {/* Node Config Modal */}
      <CustomNetworkModal
        isOpen={showCustomModal}
        onClose={() => setShowCustomModal(false)}
      />
    </div>
  )
}

export default Layout
