import { useState, useEffect, type FormEvent } from 'react'
import { useNode } from '@/contexts/NodeContext'
import { useModuleContext } from '@/contexts/ModuleContext'
import { X } from 'lucide-react'
import Button from '../ui/Button'

interface CustomNetworkModalProps {
  isOpen: boolean
  onClose: () => void
}

const LOCAL_STORAGE_KEY = 'customNetworkConfig'

const CustomNetworkModal = ({ isOpen, onClose }: CustomNetworkModalProps) => {
  const { connectToCustomNetwork } = useNode()
  const { getContracts, setContractAddress } = useModuleContext()

  const contractFields = Object.entries(getContracts()).flatMap(([_, fields]) => fields)

  const [formData, setFormData] = useState<{
    wsEndpoint: string
    contracts: Record<string, string>
  }>({
    wsEndpoint: '',
    contracts: {}
  })

  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load saved config from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY)
    const defaultContracts = contractFields.reduce((acc, { key }) => {
      acc[key] = ''
      return acc
    }, {} as Record<string, string>)

    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setFormData({
          ...parsed,
          contracts: {
            ...defaultContracts,
            ...parsed.contracts,
          }
        })
      } catch (err) {
        console.error('Failed to parse saved config:', err)
      }
    } else {
      setFormData({
        wsEndpoint: 'ws://127.0.0.1:8080/json_rpc',
        contracts: defaultContracts
      })
    }
  }, [])

  const handleChangeContract = (key: string, value: string) => {
    setFormData(prev => {
      const updated = {
        ...prev,
        contracts: {
          ...prev.contracts,
          [key]: value
        }
      }
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }

  const handleEndpointChange = (value: string) => {
    setFormData(prev => {
      const updated = {
        ...prev,
        wsEndpoint: value
      }
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated))
      return updated
    })
  }

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault()
    setConnecting(true)
    setError(null)

    try {
      const networkConfig = {
        name: 'Custom Debug Network',
        url: formData.wsEndpoint,
        contractAddresses: formData.contracts
      }

      await connectToCustomNetwork(networkConfig)

      Object.entries(formData.contracts).forEach(([key, value]) => {
        setContractAddress(key, value.trim())
      })
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(formData))
      onClose()
    } catch (err: any) {
      console.error('Failed to connect:', err)
      setError(err?.message || 'Connection failed')
    } finally {
      setConnecting(false)
    }
  }

  const handleClose = () => {
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-black/80 border border-white/10 backdrop-blur-sm rounded-lg p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">Connect Custom Network</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-md p-3 mb-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              WebSocket Endpoint *
            </label>
            <input
              type="text"
              value={formData.wsEndpoint}
              onChange={(e) => handleEndpointChange(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white focus:border-forge-orange focus:outline-none"
              placeholder="ws://127.0.0.1:8080/json_rpc"
              required
            />
          </div>

          {contractFields.map(({ key, label, required }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {label} {required ? '*' : ''}
              </label>
              <input
                type="text"
                value={formData.contracts[key] || ''}
                onChange={(e) => handleChangeContract(key, e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white focus:border-forge-orange focus:outline-none"
                placeholder="e.g. abc123..."
                required={required}
              />
            </div>
          ))}

          <div className="pt-4">
            <Button
              onClick={handleSubmit}
              isLoading={connecting}
              className="w-full bg-forge-orange text-white hover:bg-orange-600 py-2.5 rounded-md"
            >
              Connect
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CustomNetworkModal
