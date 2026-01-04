import { useState, useEffect } from 'react'

const API_HTTP = import.meta.env.VITE_API_HTTP ?? window.location.origin

type MarketItem = {
  symbol: string
  a_hash: string
  b_hash: string
  close_price?: number
  current_price?: number  // ARP price for individual assets
  price_change_24h_pct: number
  volume_24h?: number
  total_volume?: number
  swap_count?: number
  isAsset?: boolean  // true for individual assets (gainers/losers), false/undefined for LPs
}

export type TickerSection = {
  type: 'header'
  label: string
} | {
  type: 'item'
  data: MarketItem
} | {
  type: 'divider'
}

export const useMarketData = () => {
  const [sections, setSections] = useState<TickerSection[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchMarketData = async () => {
      try {
        console.log('[useMarketData] Fetching from:', API_HTTP)

        // Fetch all data in parallel
        const [moversRes, trendingRes, newPairsRes] = await Promise.all([
          fetch(`${API_HTTP}/api/assets/movers?limit=25`),
          fetch(`${API_HTTP}/api/markets/trending?limit=25`),
          fetch(`${API_HTTP}/api/markets/new?hours=24&limit=25`)
        ])

        if (!moversRes.ok || !trendingRes.ok || !newPairsRes.ok) {
          throw new Error('Failed to fetch market data')
        }

        const movers = await moversRes.json()
        const trending = await trendingRes.json()
        const newPairs = await newPairsRes.json()

        console.log('[useMarketData] Data:', { movers, trending, newPairs })

        // Build sections array
        const tickerSections: TickerSection[] = []

        // New Pairs (if any) - show as LPs
        if (Array.isArray(newPairs) && newPairs.length > 0) {
          tickerSections.push({ type: 'header', label: 'NEW PAIRS' })
          newPairs.forEach((item: MarketItem) => {
            tickerSections.push({ type: 'item', data: { ...item, isAsset: false } })
          })
          tickerSections.push({ type: 'divider' })
        }

        // Trending - show as LPs
        if (Array.isArray(trending) && trending.length > 0) {
          tickerSections.push({ type: 'header', label: 'TRENDING' })
          trending.forEach((item: MarketItem) => {
            tickerSections.push({ type: 'item', data: { ...item, isAsset: false } })
          })
          tickerSections.push({ type: 'divider' })
        }

        // Gainers - show as individual assets
        if (movers.gainers && Array.isArray(movers.gainers) && movers.gainers.length > 0) {
          tickerSections.push({ type: 'header', label: 'GAINERS' })
          movers.gainers.forEach((item: MarketItem) => {
            tickerSections.push({ type: 'item', data: { ...item, isAsset: true } })
          })
          tickerSections.push({ type: 'divider' })
        }

        // Losers - show as individual assets
        if (movers.losers && Array.isArray(movers.losers) && movers.losers.length > 0) {
          tickerSections.push({ type: 'header', label: 'LOSERS' })
          movers.losers.forEach((item: MarketItem) => {
            tickerSections.push({ type: 'item', data: { ...item, isAsset: true } })
          })
          tickerSections.push({ type: 'divider' })
        }

        console.log('[useMarketData] Built sections:', tickerSections.length, tickerSections)
        setSections(tickerSections)
        setIsLoading(false)
        setError(null)
      } catch (err) {
        console.error('[useMarketData] Failed to fetch:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
        setIsLoading(false)
      }
    }

    fetchMarketData()
    const interval = setInterval(fetchMarketData, 60_000) // Refresh every minute

    return () => clearInterval(interval)
  }, [])

  return { sections, isLoading, error }
}
