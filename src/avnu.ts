import { getQuotes, executeSwap } from '@avnu/avnu-sdk';
import type { Quote } from '@avnu/avnu-sdk';

export const AVNU_SEPOLIA_BASE_URL = 'https://sepolia.api.avnu.fi';

export async function fetchQuotes(params: {
  sellTokenAddress: string;
  buyTokenAddress: string;
  sellAmount?: bigint;
  buyAmount?: bigint;
  takerAddress: string;
  size?: number;
}) {
  return getQuotes(
    {
      sellTokenAddress: params.sellTokenAddress,
      buyTokenAddress: params.buyTokenAddress,
      sellAmount: params.sellAmount,
      buyAmount: params.buyAmount,
      takerAddress: params.takerAddress,
      size: params.size ?? 1,
    },
    { baseUrl: AVNU_SEPOLIA_BASE_URL },
  );
}

export async function doSwap(params: {
  account: any; // starknet.js Account
  quote: Quote;
  slippage: number;
}) {
  return executeSwap(
    {
      provider: params.account,
      quote: params.quote,
      slippage: params.slippage,
    } as any,
    { baseUrl: AVNU_SEPOLIA_BASE_URL },
  );
}
