export interface ArpBar {
  t: number;
  price: number;
  confidence: number;
  hops?: number;
}

export interface ArpHistoryResponse {
  s: 'ok' | 'no_data';
  t: number[];          // timestamps
  p: number[];          // prices  
  confidence: number[]; // confidence scores
  hops?: number[];      // hop counts (optional)
  base_asset: { hash: string; ticker: string };
  quote: string;
  source: 'arp' | 'trades';
  updatedAt: number;
}