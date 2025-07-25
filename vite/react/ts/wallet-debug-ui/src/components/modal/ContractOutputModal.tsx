import React from 'react'
import { X } from 'lucide-react'

interface ContractOutputModalProps {
  isOpen: boolean
  onClose: () => void
  outputs: any[]
}

const ContractOutputModal = ({ isOpen, onClose, outputs }: ContractOutputModalProps) => {
  if (!isOpen) return null

  const renderOutput = (output: any, idx: number) => {
    const [key, value] = Object.entries(output)[0]

    switch (key) {
      case 'transfer':
        return (
          <div key={idx} className="border border-white/10 rounded p-3 bg-black/30 space-y-1">
            <div className="text-sm text-forge-orange font-semibold">Transfer</div>
            <div><strong>Amount:</strong> {value.amount}</div>
            <div><strong>Asset:</strong> {value.asset}</div>
            <div><strong>To:</strong> {value.destination}</div>
          </div>
        )
      case 'exit_code':
        return (
          <div key={idx} className="border border-white/10 rounded p-3 bg-black/30">
            <div className="text-sm text-forge-orange font-semibold">Exit Code</div>
            <div>{value ?? 'null'}</div>
          </div>
        )
      case 'refund_gas':
        return (
          <div key={idx} className="border border-white/10 rounded p-3 bg-black/30">
            <div className="text-sm text-forge-orange font-semibold">Refunded Gas</div>
            <div>{value.amount}</div>
          </div>
        )
      default:
        return (
          <div key={idx} className="border border-white/10 rounded p-3 bg-black/30">
            <div className="text-sm text-forge-orange font-semibold">{key}</div>
            <pre className="text-sm text-white whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
          </div>
        )
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-[#111] border border-white/10 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto relative text-white space-y-4">
        <button
          className="absolute top-3 right-3 text-gray-400 hover:text-white"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <h2 className="text-xl font-bold mb-4">Contract Outputs</h2>
        {outputs.length === 0 ? (
          <div className="text-sm text-gray-400">No output data found.</div>
        ) : (
          <div className="space-y-3">
            {outputs.map((entry, idx) => renderOutput(entry, idx))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ContractOutputModal
