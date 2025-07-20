import { createContext, useContext, useReducer, type ReactNode } from 'react'

interface Token {
  symbol: string
  name: string
  balance: string
  price: number
  logo: string
}

interface TokenState {
  tokens: Record<string, Token>
  selectedTokens: {
    from: string
    to: string
  }
  swapAmounts: {
    from: string
    to: string
  }
  slippage: number
  priceImpact: number
  loading: boolean
  error: string | null
}

interface TokenContextType extends TokenState {
  setTokenBalance: (symbol: string, balance: string) => void
  selectToken: (position: 'from' | 'to', symbol: string) => void
  swapTokens: () => void
  setAmount: (position: 'from' | 'to', amount: string) => void
  setSlippage: (slippage: number) => void
  setPriceImpact: (impact: number) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

const TokenContext = createContext<TokenContextType | undefined>(undefined)

const initialState: TokenState = {
  tokens: {
    XEL: {
      symbol: 'XET',
      name: 'XELIS',
      balance: '0',
      price: 1.79,
      logo: '/path/to/xel-logo.png'
    },
    SUGG: {
      symbol: 'SUGG',
      name: 'suggs93',
      balance: '0',
      price: 1.79,
      logo: '/path/to/sugg-logo.png'
    }
  },
  selectedTokens: {
    from: 'XEL',
    to: 'SUGG'
  },
  swapAmounts: {
    from: '',
    to: ''
  },
  slippage: 0.5,
  priceImpact: 0,
  loading: false,
  error: null
}

type TokenAction =
  | { type: 'SET_TOKEN_BALANCE'; payload: { symbol: string; balance: string } }
  | { type: 'SELECT_TOKEN'; payload: { position: 'from' | 'to'; symbol: string } }
  | { type: 'SWAP_TOKENS' }
  | { type: 'SET_AMOUNT'; payload: { position: 'from' | 'to'; amount: string } }
  | { type: 'SET_SLIPPAGE'; payload: number }
  | { type: 'SET_PRICE_IMPACT'; payload: number }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }

const tokenReducer = (state: TokenState, action: TokenAction): TokenState => {
  switch (action.type) {
    case 'SET_TOKEN_BALANCE':
      return {
        ...state,
        tokens: {
          ...state.tokens,
          [action.payload.symbol]: {
            ...state.tokens[action.payload.symbol],
            balance: action.payload.balance
          }
        }
      }
    case 'SELECT_TOKEN':
      return {
        ...state,
        selectedTokens: {
          ...state.selectedTokens,
          [action.payload.position]: action.payload.symbol
        }
      }
    case 'SWAP_TOKENS':
      return {
        ...state,
        selectedTokens: {
          from: state.selectedTokens.to,
          to: state.selectedTokens.from
        },
        swapAmounts: {
          from: state.swapAmounts.to,
          to: state.swapAmounts.from
        }
      }
    case 'SET_AMOUNT':
      return {
        ...state,
        swapAmounts: {
          ...state.swapAmounts,
          [action.payload.position]: action.payload.amount
        }
      }
    case 'SET_SLIPPAGE':
      return {
        ...state,
        slippage: action.payload
      }
    case 'SET_PRICE_IMPACT':
      return {
        ...state,
        priceImpact: action.payload
      }
    case 'SET_LOADING':
      return {
        ...state,
        loading: action.payload
      }
    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
        loading: false
      }
    default:
      return state
  }
}

export const TokenProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(tokenReducer, initialState)

  const setTokenBalance = (symbol, balance) => {
    dispatch({ type: 'SET_TOKEN_BALANCE', payload: { symbol, balance } })
  }

  const selectToken = (position, symbol) => {
    dispatch({ type: 'SELECT_TOKEN', payload: { position, symbol } })
  }

  const swapTokens = () => {
    dispatch({ type: 'SWAP_TOKENS' })
  }

  const setAmount = (position, amount) => {
    dispatch({ type: 'SET_AMOUNT', payload: { position, amount } })
  }

  const setSlippage = (slippage) => {
    dispatch({ type: 'SET_SLIPPAGE', payload: slippage })
  }

  const setPriceImpact = (impact) => {
    dispatch({ type: 'SET_PRICE_IMPACT', payload: impact })
  }

  const setLoading = (loading) => {
    dispatch({ type: 'SET_LOADING', payload: loading })
  }

  const setError = (error) => {
    dispatch({ type: 'SET_ERROR', payload: error })
  }

  return (
    <TokenContext.Provider value={{
      ...state,
      setTokenBalance,
      selectToken,
      swapTokens,
      setAmount,
      setSlippage,
      setPriceImpact,
      setLoading,
      setError
    }}>
      {children}
    </TokenContext.Provider>
  )
}

export const useTokens = (): TokenContextType => {
  const context = useContext(TokenContext)
  if (!context) {
    throw new Error('useTokens must be used within a TokenProvider')
  }
  return context
}