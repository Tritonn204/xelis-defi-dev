import { useState, useEffect } from 'react'
import { useNode } from '../../contexts/NodeContext'
import { X, Trash2 } from 'lucide-react'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'

interface CustomNetworkModalProps {
  isOpen: boolean
  onClose: () => void
  editingNetwork?: { id: string, config: CustomNetworkConfig } | null
}

const CustomNetworkModal = ({ isOpen, onClose, editingNetwork }: CustomNetworkModalProps) => {
  const { connectToCustomNetwork, saveCustomNetwork, updateCustomNetwork, deleteCustomNetwork } = useNode()
  const [formData, setFormData] = useState({
    name: '',
    wsEndpoint: '',
    routerContract: '',
    factoryContract: ''
  })
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const isEditing = !!editingNetwork

  // Load data when editing
  useEffect(() => {
    if (editingNetwork) {
      setFormData({
        name: editingNetwork.config.name,
        wsEndpoint: editingNetwork.config.url,
        routerContract: editingNetwork.config.contractAddresses?.router || '',
        factoryContract: editingNetwork.config.contractAddresses?.factory || ''
      })
    } else {
      setFormData({
        name: '',
        wsEndpoint: '',
        routerContract: '',
        factoryContract: ''
      })
    }
    setError(null)
  }, [editingNetwork, isOpen])

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setConnecting(true)
    setError(null)
    
    try {
      const networkConfig = {
        name: formData.name,
        url: formData.wsEndpoint,
        contractAddresses: {
          ...(formData.routerContract && { router: formData.routerContract }),
          ...(formData.factoryContract && { factory: formData.factoryContract })
        }
      }

      if (isEditing) {
        updateCustomNetwork(editingNetwork.id, networkConfig)
        console.log("Network updated successfully")
      } else {
        await connectToCustomNetwork(networkConfig)
      }
      
      handleClose()
    } catch (error: any) {
      console.error('Failed to save/connect to custom network:', error)
      setError(error?.message || 'Failed to save network')
    } finally {
      setConnecting(false)
    }
  }

  const handleConnectToExisting = async () => {
    if (!isEditing) return
    
    setConnecting(true)
    setError(null)
    
    try {
      const networkConfig = {
        name: formData.name,
        url: formData.wsEndpoint,
        contractAddresses: {
          ...(formData.routerContract && { router: formData.routerContract }),
          ...(formData.factoryContract && { factory: formData.factoryContract })
        }
      }
      
      // Save changes first
      saveCustomNetwork(editingNetwork.id, networkConfig)
      
      // Then connect
      await connectToCustomNetwork(networkConfig)
      
      handleClose()
    } catch (error: any) {
      console.error('Failed to connect to network:', error)
      setError(error?.message || 'Failed to connect to network')
    } finally {
      setConnecting(false)
    }
  }

  const handleDelete = () => {
    if (!isEditing) return
    deleteCustomNetwork(editingNetwork.id)
    setShowDeleteConfirm(false)
    handleClose()
  }

  const handleClose = () => {
    setFormData({
      name: '',
      wsEndpoint: '',
      routerContract: '',
      factoryContract: ''
    })
    setError(null)
    setShowDeleteConfirm(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-black/80 border-1 border-forge-orange/10 backdrop-blur-sm rounded-lg p-6 w-full max-w-md mx-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">
              {isEditing ? 'Edit Custom Network' : 'Add Custom Network'}
            </h2>
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
                Network Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white focus:border-forge-orange focus:outline-none"
                placeholder="My Custom Network"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                WebSocket Endpoint *
              </label>
              <input
                type="text"
                value={formData.wsEndpoint}
                onChange={(e) => setFormData(prev => ({ ...prev, wsEndpoint: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white focus:border-forge-orange focus:outline-none"
                placeholder="ws://localhost:8080/ws"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                DEX/Router Contract *
              </label>
              <input
                type="text"
                value={formData.routerContract}
                onChange={(e) => setFormData(prev => ({ ...prev, routerContract: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white focus:border-forge-orange focus:outline-none"
                placeholder="12ab..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Asset Factory Contract *
              </label>
              <input
                type="text"
                value={formData.factoryContract}
                onChange={(e) => setFormData(prev => ({ ...prev, factoryContract: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white focus:border-forge-orange focus:outline-none"
                placeholder="34cd..."
              />
            </div>

            {/* Action Buttons */}
            <div className="flex space-x-3 pt-4">
              {isEditing ? (
                <>
                  {/* Delete Button */}
                  <Button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="bg-red-600/80 text-white hover:bg-red-600 py-2.5 px-3 rounded-md"
                    disabled={connecting}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                  
                  {/* Save Button */}
                  <Button
                    type="button"
                    onClick={handleSubmit}
                    className="flex-1 bg-gray-700 text-white hover:bg-gray-600 py-2.5 rounded-md"
                    isLoading={connecting && !showDeleteConfirm}
                    disabled={connecting}
                  >
                    Save Changes
                  </Button>
                  
                  {/* Connect Button */}
                  <Button
                    type="button"
                    onClick={handleConnectToExisting}
                    className="flex-1 bg-forge-orange text-white hover:bg-orange-600 py-2.5 rounded-md"
                    isLoading={connecting}
                  >
                    Connect
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    onClick={handleClose}
                    className="flex-1 bg-gray-700 text-white hover:bg-gray-600 py-2.5 rounded-md"
                    disabled={connecting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSubmit}
                    isLoading={connecting}
                    className="flex-1 bg-forge-orange text-white hover:bg-orange-600 py-2.5 rounded-md"
                  >
                    Add & Connect
                  </Button>
                </>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Custom Network"
        message={`Are you sure you want to delete "${formData.name}"? This action cannot be undone.`}
        confirmText="Delete"
        confirmClassName="bg-red-600 hover:bg-red-700"
      />
    </>
  )
}

export default CustomNetworkModal