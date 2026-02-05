export type TokenSymbol = 'ETH' | 'STRK' | 'USDC' | 'USDT' | 'WBTC' | 'wstETH';

export type TokenInfo = {
  symbol: TokenSymbol;
  name: string;
  address: string;
  decimals: number;
};

// Source: starknet-io/starknet-addresses (bridged_tokens/sepolia.json)
export const SEPOLIA_TOKENS: Record<TokenSymbol, TokenInfo> = {
  ETH: {
    symbol: 'ETH',
    name: 'Ether',
    address: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    decimals: 18,
  },
  STRK: {
    symbol: 'STRK',
    name: 'Starknet Token',
    address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    decimals: 18,
  },
  USDC: {
    symbol: 'USDC',
    name: 'USDC',
    address: '0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080',
    decimals: 6,
  },
  USDT: {
    symbol: 'USDT',
    name: 'USDT',
    address: '0x02ab8758891e84b968ff11361789070c6b1af2df618d6d2f4a78b0757573c6eb',
    decimals: 6,
  },
  WBTC: {
    symbol: 'WBTC',
    name: 'Wrapped BTC',
    address: '0x00452bd5c0512a61df7c7be8cfea5e4f893cb40e126bdc40aee6054db955129e',
    decimals: 8,
  },
  wstETH: {
    symbol: 'wstETH',
    name: 'Wrapped liquid staked Ether 2.0',
    address: '0x030de54c07e57818ae4a1210f2a3018a0b9521b8f8ae5206605684741650ac25',
    decimals: 18,
  },
};

export function parseTokenSymbol(s: string): TokenSymbol {
  const key = s.toUpperCase();
  if (key === 'WSTETH') return 'wstETH';
  if (key in SEPOLIA_TOKENS) return key as TokenSymbol;
  throw new Error(`Unsupported token '${s}'. Supported: ${Object.keys(SEPOLIA_TOKENS).join(', ')}`);
}
