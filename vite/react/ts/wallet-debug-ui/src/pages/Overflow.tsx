import { useState, useMemo, useEffect, useRef } from 'react'
import { NATIVE_ASSET_HASH, useNode } from '@/contexts/NodeContext'
import { useWallet } from '@/contexts/WalletContext'
import { entries } from '@/contracts/overflow/contract'
import { vmParam } from '@/utils/xvmSerializer'
import Button from '@/components/ui/Button'
import { useTransactionContext } from '@/contexts/TransactionContext'
import { useModuleContext } from '@/contexts/ModuleContext'
import TokenInput from '@/components/ui/TokenInput'
import { useAssets } from '@/contexts/AssetContext'
import TokenSelectModal from '@/components/modal/TokenSelectModal'
import Decimal from 'decimal.js'
import ContractOutputModal from '@/components/modal/ContractOutputModal'

const LOCAL_FAILURE_KEY = 'overflow_local_failures'

const saveFailuresToLocal = (failures: any[]) => {
  localStorage.setItem(LOCAL_FAILURE_KEY, JSON.stringify(failures))
}

const loadFailuresFromLocal = (): any[] => {
  try {
    const raw = localStorage.getItem(LOCAL_FAILURE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

const TxRecordItem = ({
  hash,
  amount,
  decimals,
  variant = 'success',
  onShowOutputs,
}: {
  hash: string
  amount: string
  decimals: number
  variant?: 'success' | 'fail'
  onShowOutputs?: () => void
}) => {
  const bgColor = variant === 'fail' ? 'border-red-500/40' : 'border-green-500/40'

  const handleCopy = () => {
    navigator.clipboard.writeText(hash)
    alert('TX hash copied to clipboard')
  }

  return (
    <li className={`bg-black/30 border ${bgColor} p-2 rounded`}>
      <div
        className="truncate cursor-pointer text-forge-orange hover:underline"
        onClick={handleCopy}
        title="Click to copy"
      >
        TX Hash: {hash}
      </div>
      <div>
        Amount:{' '}
        {new Decimal(amount)
          .div(new Decimal(10).pow(decimals || 8))
          .toFixed(decimals || 8)}
      </div>
      {onShowOutputs && (
        <button
          className="mt-2 text-sm text-blue-400 hover:text-blue-300 underline"
          onClick={onShowOutputs}
        >
          View Outputs
        </button>
      )}
    </li>
  )
}

const OverflowDebugger = () => {
  const { buildTransaction, submitTransaction, isConnected, connectWallet } = useWallet()
  const { getContractData, currentNode, getContractOutputs } = useNode()
  const { awaitContractInvocation } = useTransactionContext()
  const [amount, setAmount] = useState('')
  const [search, setSearch] = useState('')
  const [failures, setFailures] = useState<any[]>([])
  const [successes, setSuccesses] = useState<any[]>([])
  const { contractValues } = useModuleContext()
  const { assets } = useAssets()
  const [selectedToken, setSelectedToken] = useState(NATIVE_ASSET_HASH)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const isSwappingRef = useRef(false)

  const [isOutputModalOpen, setIsOutputModalOpen] = useState(false)
  const [selectedOutputs, setSelectedOutputs] = useState<any[]>([])

  const contract = contractValues['overflow']
  const decimals = assets[selectedToken]?.decimals

  console.log(contract)

  const parsedAmount = useMemo(() => {
    const num = parseFloat(amount)
    return isNaN(num) ? 0 : Math.floor(num * Math.pow(10, decimals))
  }, [amount])

  useEffect(() => {
  }, [assets, isConnected])

  useEffect(() => {
    fetchRecords()
  }, [currentNode])

  const handleRefund = async (safe: boolean) => {
    if (!isConnected) {
      connectWallet()
      return
    }

    if (!contract || !parsedAmount) {
      setError('Missing contract or amount')
      return
    }

    setIsSubmitting(true)
    setError('')
    isSwappingRef.current = true

    try {
      const txData = safe
        ? entries.createSafeRefund({ contract, asset: selectedToken, amount: parsedAmount })
        : entries.createUnsafeRefund({ contract, asset: selectedToken, amount: parsedAmount })

      const txBuilder = await buildTransaction(txData)

      await awaitContractInvocation(txBuilder.hash, contract, async (status, hash) => {
        if (status === 'executed') {
          setAmount('')
          await fetchRecords()
        } else {
          setError(`Transaction ${status}`)
          const txEntry = {
            value: [
              { key: { type: 'string', value: 'hash' }, value: txBuilder.hash },
              { key: { type: 'amount', value: 'amount' }, value: parsedAmount.toString() },
            ]
          }
          const updatedFailures = [txEntry, ...failures]
          setFailures(updatedFailures)
          saveFailuresToLocal(updatedFailures)
        }

        setIsSubmitting(false)
        isSwappingRef.current = false
      })

      console.log("Debug TX", txBuilder)
      await submitTransaction(txBuilder)
    } catch (err: any) {
      setError(`Transaction failed: ${err.message || err}`)
      setIsSubmitting(false)
      isSwappingRef.current = false
    }
  }

  const fetchRecords = async () => {
    if (!contract) return

    const failKey = vmParam.string('failures')
    const successKey = vmParam.string('safeTXRecords')

    const [failData, successData] = await Promise.all([
      getContractData({ contract, key: failKey }),
      getContractData({ contract, key: successKey })
    ])

    const localFails = loadFailuresFromLocal()
    setFailures([...(failData?.data.value || []), ...localFails])
    setSuccesses(successData?.data.value || [])
  }

  const filterRecords = (records: any[]) => {
    if (!search.trim()) return records
    return records.filter((r) => {
      console.log("record", r)
      return r.value[0].value.includes(search.trim())
    })
  }

  const filteredFails = useMemo(() => filterRecords(failures), [failures, search])
  const filteredSuccess = useMemo(() => filterRecords(successes), [successes, search])

  return (
    <div className="max-w-xl mx-auto p-6 text-white space-y-6">
      <h1 className="text-2xl font-semibold">Overflow Debugger</h1>

      {error && (
        <div className="text-red-400 text-sm mt-2">{error}</div>
      )}

      <div className="space-y-3">
        <TokenInput
          label="Amount"
          amount={amount}
          onChange={setAmount}
          tokenSymbol={assets[selectedToken]?.ticker || 'Select'}
          tokenName={assets[selectedToken]?.name}
          tokenHash={selectedToken}
          decimals={assets[selectedToken]?.decimals || decimals}
          onTokenSelect={() => setIsModalOpen(true)}
          showMaxHalf={true}
        />

        <div className="flex space-x-4">
          <Button
            onClick={() => handleRefund(false)}
            isLoading={isSubmitting}
            focusOnClick={false}
            className="
              flex-1 
              bg-red-600 
              hover:bg-red-700 
              text-xl 
              p-2 
              rounded-lg 
              transition-all 
              duration-200
              hover:scale-[1.015]
              active:scale-[0.98]
            "
          >
            Try Unsafe
          </Button>
          <Button
            onClick={() => handleRefund(true)}
            isLoading={isSubmitting}
            focusOnClick={false}
            className="
              flex-1 
              bg-green-600 
              hover:bg-green-700 
              text-xl 
              p-2 
              rounded-lg 
              transition-all 
              duration-200
              hover:scale-[1.015]
              active:scale-[0.98]
            "
          >
            Try Safe
          </Button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Search tx hash or topoheight
        </label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white focus:border-forge-orange focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h2 className="text-xl font-medium mb-2">Failures</h2>
          <ul className="space-y-2 max-h-[66vh] overflow-y-auto">
            {filteredFails.map((r, idx) => (
              <TxRecordItem
                key={`fail-${idx}`}
                hash={r.value[0].value}
                amount={r.value[1].value}
                decimals={decimals || 8}
                variant="fail"
                onShowOutputs={async () => {
                  const res = await getContractOutputs({ transaction: r.value[0].value })
                  setSelectedOutputs(Array.isArray(res) ? res : [])
                  setIsOutputModalOpen(true)
                }}
              />
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-medium mb-2">Successes</h2>
          <ul className="space-y-2 max-h-64 overflow-y-auto">
            {filteredSuccess.map((r, idx) => (
              <TxRecordItem
                key={`success-${idx}`}
                hash={r.value[0].value}
                amount={r.value[1].value}
                decimals={decimals || 8}
                variant="success"
                onShowOutputs={async () => {
                  const res = await getContractOutputs({ transaction: r.value[0].value })
                  setSelectedOutputs(Array.isArray(res) ? res : [])
                  setIsOutputModalOpen(true)
                }}
              />
            ))}
          </ul>
        </div>
      </div>
      <TokenSelectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSelect={(hash: string) => {
          setSelectedToken(hash)
          setIsModalOpen(false)
        }}
        currentToken={selectedToken}
        position="from"
      />
      <ContractOutputModal
        isOpen={isOutputModalOpen}
        onClose={() => setIsOutputModalOpen(false)}
        outputs={selectedOutputs}
      />
    </div>
  )
}

export default OverflowDebugger
