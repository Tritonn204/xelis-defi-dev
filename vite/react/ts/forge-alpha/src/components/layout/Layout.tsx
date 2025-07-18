import { Link, useLocation } from 'react-router-dom'
import { useWallet } from '../../contexts/WalletContext'
import { Settings } from 'lucide-react'
import Button from '../ui/Button'

import bannerImage from '../../assets/banner.png'
import bgImage from '../../assets/bg.png'

const Layout = ({ children }) => {
  const location = useLocation()
  const { isConnected, address, connectWallet } = useWallet()

  const navigation = [
    { name: 'TRADE', path: '/trade' },
    { name: 'POOLS', path: '/pools' },
    { name: 'TOOLS', path: '/tools' },
    { name: 'BRIDGE', path: '/bridge' }
  ]

  const isActive = (path) => {
    return location.pathname === path || (path === '/trade' && location.pathname === '/')
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
      {/* Fixed header at top */}
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-l">
        <div className="w-full px-5">
          <div className="relative flex items-center justify-between h-20">
            {/* Logo - Left */}
            <div className="flex items-center z-10">
              <Link to="/" className="flex items-center">
                <img src={bannerImage} alt="FORGE" className="h-13 w-auto" />
              </Link>
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
                <div className="bg-black/75 px-3 py-1 rounded-lg">
                  <span className="text-sm text-gray-300">
                    {address?.slice(0, 10)}...{address?.slice(-4)}
                  </span>
                </div>
              ) : (
                <Button
                  onClick={connectWallet}
                  className="
                    bg-forge-orange
                    hover:bg-orange-600 
                    text-white 
                    px-2.5 py-0 
                    rounded-md
                    text-2xl 
                    font-normal 
                    transition-all duration-200
                    hover:ring-1
                    hover:scale-[1.02]
                  "
                >
                  Connect
                </Button>
              )}
              <Button className="text-gray-300 hover:text-white rounded-full">
                <Settings className="w-8 h-8" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content with top padding to account for fixed header */}
      <main className="pt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  )
}

export default Layout