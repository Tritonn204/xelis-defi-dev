import React, { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { getExitCodeFromOutputs } from '../utils/contracts'
import { useNode } from './NodeContext'

export type TransactionStatus = 'pending' | 'executed' | 'reverted' | 'failed'

type TxCallback = (status: TransactionStatus, hash: string) => void

interface TrackedTx {
  hash: string
  status: TransactionStatus
  callback?: TxCallback
}

interface TransactionContextType {
  transactions: TrackedTx[]
  awaitContractInvocation: (hash: string, contract: string, callback?: TxCallback) => void
  updateTransaction: (hash: string, status: TransactionStatus) => void
}

const TransactionContext = createContext<TransactionContextType | undefined>(undefined)

export const useTransactionContext = () => {
  const ctx = useContext(TransactionContext)
  if (!ctx) throw new Error('useTransactionContext must be used inside TransactionProvider')
  return ctx
}

export const TransactionProvider = ({ children }: { children: ReactNode }) => {
  const [transactions, setTransactions] = useState<TrackedTx[]>([])
  const txCallbacksRef = useRef<Map<string, TxCallback>>(new Map())

  const { getContractOutputs, awaitTx } = useNode()

  const awaitContractInvocation = (txHash: string, contract: string, callback?: TxCallback) => {
    if (callback) {
      txCallbacksRef.current.set(txHash, callback)
    }

    updateTransaction(txHash, 'pending')

    awaitTx(txHash, async () => {
      const out = await getContractOutputs({ transaction: txHash, contract })
      const exitCode = getExitCodeFromOutputs(out)

      console.log("contract outputs", out)
      const status: TransactionStatus = exitCode === 0 ? 'executed' : 'reverted'
      updateTransaction(txHash, status)

      const cb = txCallbacksRef.current.get(txHash)
      if (cb) cb(status, txHash)
    })
  }

  const updateTransaction = (hash: string, status: TransactionStatus) => {
    setTransactions(prev => {
      return prev.map(tx =>
        tx.hash === hash ? { ...tx, status } : tx
      )
    })

    const tx = transactions.find(t => t.hash === hash)
    if (tx?.callback) {
      tx.callback(status, hash)
    }
  }

  return (
    <TransactionContext.Provider value={{ transactions, awaitContractInvocation, updateTransaction }}>
      {children}
    </TransactionContext.Provider>
  )
}
