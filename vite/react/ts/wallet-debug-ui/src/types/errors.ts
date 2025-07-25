export interface AppTxError {
  type: 'NETWORK_DISCONNECT' | 'TIMEOUT' | 'FAILED_SUBMIT' | 'REORG' | 'UNKNOWN'
  message: string
  code?: number
}