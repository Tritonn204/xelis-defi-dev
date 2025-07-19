import { Link, useLocation } from 'react-router-dom'

import { useWallet } from '../../contexts/WalletContext'
import { useNode } from '../../contexts/NodeContext'
import { useState } from 'react'

import { Edit3, Settings, ChevronDown, Globe } from 'lucide-react'
import type { CustomNetworkConfig } from '../../contexts/NodeContext'

import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import CustomNetworkModal from '../modal/CustomNetworkModal'

import bannerImage from '../../assets/banner.png'
import bgImage from '../../assets/bg.png'

const Layout = ({ children }) => {
  const location = useLocation()
  const { isConnected, address, connectWallet, connecting } = useWallet()
  const { 
    currentNetwork, 
    currentNode,
    networkInfo, 
    networkMismatch, 
    connectToNetwork,
    connectToCustomNetwork,
    deleteCustomNetwork,
    getCustomNetworks,
    generateNetworkId,
    isConnected: nodeConnected 
  } = useNode()
  
  const [showNetworkDropdown, setShowNetworkDropdown] = useState(false)
  const [showCustomModal, setShowCustomModal] = useState(false)
  const [editingNetwork, setEditingNetwork] = useState<{ id: string, config: CustomNetworkConfig } | null>(null)

  const customNetworks = getCustomNetworks()

  const handleEditNetwork = (e: React.MouseEvent, networkId: string, config: CustomNetworkConfig) => {
    e.stopPropagation()
    setEditingNetwork({ id: networkId, config })
    setShowCustomModal(true)
    setShowNetworkDropdown(false)
  }

  const handleCloseModal = () => {
    setShowCustomModal(false)
    setEditingNetwork(null)
  }

  const handleCustomNetworkConnect = (config: CustomNetworkConfig) => {
    connectToCustomNetwork(config)
    setShowNetworkDropdown(false)
  }

  const navigation = [
    { name: 'TRADE', path: '/trade' },
    { name: 'POOLS', path: '/pools' },
    { name: 'TOOLS', path: '/tools' },
    { name: 'BRIDGE', path: '/bridge' }
  ]

  const isActive = (path: any) => {
    return location.pathname === path || (path === '/trade' && location.pathname === '/')
  }

  const getNetworkDisplayName = () => {
    if (!currentNetwork) return 'Select Network'
    if (currentNetwork === 'custom') return currentNode?.name
    return currentNetwork.charAt(0).toUpperCase() + currentNetwork.slice(1)
  }

  const getNetworkStatusColor = () => {
    if (!nodeConnected) return 'text-red-800'
    if (networkMismatch) return 'text-yellow-400'
    return 'text-white'
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
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-l">
        <div className="w-full px-5">
          <div className="relative flex items-center justify-between h-20">
            
            {/* Logo - Left */}
            <div className="flex items-center space-x-4 z-10">
              <Link to="/" className="flex items-center">
                <img src={bannerImage} alt="FORGE" className="h-13 w-auto" />
              </Link>
              
              {/* Network Selector */}
              <div className="relative">
                <Button
                  onClick={() => setShowNetworkDropdown(!showNetworkDropdown)}
                  className="flex items-center space-x-2 bg-transparent px-3 py-2 rounded-md hover:bg-black/70 transition-colors"
                  focusOnClick={false}
                >
                  <Globe className={`w-5 h-5 ${getNetworkStatusColor()}`} />
                  <span className="text-white font-normal text-md">
                    {getNetworkDisplayName()}
                  </span>
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                </Button>

                {/* Network Dropdown */}
                {showNetworkDropdown && (
                  <div className="absolute top-full mt-2 left-0 bg-black/40 border border-white/10 rounded-md min-w-49.5 z-50">
                    {/* Regular Networks */}
                    {['mainnet', 'testnet'].map((network) => (
                      <Button
                        key={network}
                        onClick={() => {
                          connectToNetwork(network as any)
                          setShowNetworkDropdown(false)
                        }}
                        className={`rounded-sm w-full text-left px-4 py-2 hover:bg-black/50 transition-colors ${
                          currentNetwork === network ? 'text-white' : 'text-white/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="capitalize">{network}</span>
                        </div>
                      </Button>
                    ))}
                    
                    {/* Custom Networks Section */}
                    {customNetworks.length > 0 && (
                      <>
                        <hr className="border-white/10" />
                        {/* <div className="px-4 py-1">
                          <span className="text-xs text-forge-orange uppercase tracking-wider">Custom Networks</span>
                        </div> */}
                        
                        {customNetworks.map((config, index) => {
                          const networkId = generateNetworkId(config)
                          const isActive = currentNetwork === 'custom' && currentNode?.name === config.name
                          
                          return (
                            <div
                              key={networkId}
                              className={`relative group hover:bg-black/50 transition-colors`}
                            >
                              <Button
                                onClick={() => handleCustomNetworkConnect(config)}
                                className={`rounded-sm w-full text-left px-4 py-2 pr-8 ${
                                  isActive ? 'text-white' : 'text-white/30 hover:text-white/80'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="truncate">{config.name}</span>
                                </div>
                              </Button>
                              
                              {/* Delete Button */}
                              <button
                                onClick={(e) => handleEditNetwork(e, networkId, config)}
                                className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 w-4 h-8 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-400"
                              >
                                <Edit3 className="absolute w-4 h-4 top-1/2 -translate-y-1/2 right-1/4" />
                              </button>
                            </div>
                          )
                        })}
                      </>
                    )}

                    <hr className="border-white/10" />
                    
                    <Button
                      onClick={() => {
                        setShowCustomModal(true)
                        setShowNetworkDropdown(false)
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-white/10 rounded-sm transition-colors text-white"
                    >
                      <div className="flex items-center space-x-2">
                        <Settings className="w-4 h-4" />
                        <span>Add Custom...</span>
                      </div>
                    </Button>
                  </div>
                )}
              </div>

              {/* Network Mismatch Warning */}
              {networkMismatch && (
                <div className="bg-yellow-500/20 border border-yellow-500/50 px-3 py-1 rounded-md">
                  <span className="text-yellow-400 text-xs font-light">
                    Network Mismatch
                  </span>
                </div>
              )}
            </div>

            {/* Navigation - Absolute Center */}
            <nav className="hidden md:flex items-center absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="flex space-x-8">
                {navigation.map((item) => (
                  <Link key={item.path} to={item.path}>
                    <span 
                      className={`text-2xl transition-colors ${
                        isActive(item.path)
                          ? 'font-regular text-white'
                          : 'font-light text-forge-orange hover:text-white'
                      }`}
                      style={{
                        fontWeight: isActive(item.path) ? 400 : 300,
                        transition: "font-weight 0.1s, color 0.2s"
                      }}
                    >
                      {item.name}
                    </span>
                  </Link>
                ))}
              </div>
            </nav>

            {/* Right side - Settings and Connect */}
            <div className="flex items-center space-x-4">
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
              <Button className="text-gray-300 hover:text-white rounded-full" onClick={()=>{}}>
                <Settings className="w-8 h-8" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="pt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>

      {/* Custom Network Modal */}
      <CustomNetworkModal 
        isOpen={showCustomModal}
        onClose={handleCloseModal}
        editingNetwork={editingNetwork}
      />
    </div>
  )
}

export default Layout