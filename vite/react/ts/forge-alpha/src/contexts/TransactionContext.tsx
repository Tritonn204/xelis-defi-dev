import React, { createContext, useContext, useRef, useState, useEffect, type ReactNode } from 'react'
import { getExitCodeFromOutputs } from '../utils/contracts'
import { useNode } from './NodeContext'
import { showSuccessToast, showErrorToast } from '@/utils/toast'
import { getExplorerUrlForNetwork } from '@/utils/contractConfig'

export type TransactionStatus = 'pending' | 'executed' | 'reverted' | 'failed'

type TxCallback = (status: TransactionStatus, hash: string) => void

interface TrackedTx {
  hash: string
  status: TransactionStatus
  callback?: TxCallback
}

interface TransactionContextType {
  transactions: TrackedTx[]
  awaitContractInvocation: (hash: string, contract: string, options?: {
    successMessage?: string
    callback?: TxCallback
  }) => void
  updateTransaction: (hash: string, status: TransactionStatus) => void
}

const TransactionContext = createContext<TransactionContextType | undefined>(undefined)

export const useTransactionContext = () => {
  const ctx = useContext(TransactionContext)
  if (!ctx) throw new Error('useTransactionContext must be used inside TransactionProvider')
  return ctx
}

export const TransactionProvider = ({ children }: { children: ReactNode }) => {
  const [transactions, setTransactions] = useState<TrackedTx[]>([]);
  const [explorerUrl, setExplorerUrl] = useState<string>('https://explorer.xelis.io'); // Default fallback
  const txCallbacksRef = useRef<Map<string, TxCallback>>(new Map());

  const { getContractLogs, awaitTx, currentNetwork } = useNode();

  // Fetch explorer URL when network changes
  useEffect(() => {
    if (currentNetwork === 'mainnet' || currentNetwork === 'testnet') {
      getExplorerUrlForNetwork(currentNetwork).then(setExplorerUrl);
    }
  }, [currentNetwork]);

  const awaitContractInvocation = (txHash: string, contract: string, options?: {
    successMessage?: string
    callback?: TxCallback
  }) => {
    const { successMessage, callback } = options || {}

    if (callback) {
      txCallbacksRef.current.set(txHash, callback);
    }

    updateTransaction(txHash, 'pending');

    awaitTx(txHash, async (result) => {
      if (!result.success) {
        // Transaction failed to execute or timed out
        const errorMsg = result.error?.message || 'Transaction failed'
        showErrorToast(errorMsg, {
          duration: 6000,
          txHash: txHash,
          explorerUrl: explorerUrl
        })
        updateTransaction(txHash, 'failed')
        const cb = txCallbacksRef.current.get(txHash)
        if (cb) cb('failed', txHash)
        txCallbacksRef.current.delete(txHash)
        return
      }

      // Transaction executed - check contract logs for exit code
      const out = await getContractLogs({ caller: txHash });
      const exitCode = getExitCodeFromOutputs(out);

      console.log("contract logs", out);
      const status: TransactionStatus = exitCode === 0 ? 'executed' : 'reverted';
      updateTransaction(txHash, status);

      // Show centralized toast
      if (status === 'executed') {
        showSuccessToast(successMessage || 'Transaction successful!', {
          duration: 12000,
          txHash: txHash,
          explorerUrl: explorerUrl
        })
      } else {
        const errorMsg = out.length > 0
          ? `Transaction reverted (exit code: ${exitCode})`
          : 'Transaction reverted'
        showErrorToast(errorMsg, {
          duration: 6000,
          txHash: txHash,
          explorerUrl: explorerUrl
        })
      }

      // Call optional callback
      const cb = txCallbacksRef.current.get(txHash);
      if (cb) cb(status, txHash);
      txCallbacksRef.current.delete(txHash)
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
