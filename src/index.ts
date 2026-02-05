#!/usr/bin/env node

import { Command } from 'commander';
import { RpcProvider, Account, Signer } from 'starknet';
import { parseUnits, formatUnits } from 'ethers';
import { getEnv } from './env.js';
import { SEPOLIA_TOKENS, parseTokenSymbol } from './tokens.js';
import { fetchQuotes, doSwap } from './avnu.js';

function makeProvider() {
  const env = getEnv();
  return new RpcProvider({ nodeUrl: env.STARKNET_RPC_URL });
}

function makeAccount() {
  const env = getEnv();
  const provider = makeProvider();
  const signer = new Signer(env.STARKNET_PRIVATE_KEY);
  return new Account({ provider, address: env.STARKNET_ACCOUNT_ADDRESS, signer });
}

const program = new Command();
program
  .name('claw-strk')
  .description('Starknet Sepolia swap CLI (AVNU)')
  .version('0.1.0');

program
  .command('tokens')
  .description('List supported Starknet Sepolia token symbols and addresses')
  .action(() => {
    console.log('Supported tokens (Sepolia):');
    for (const t of Object.values(SEPOLIA_TOKENS)) {
      console.log(`${t.symbol.padEnd(6)} ${t.address} (decimals=${t.decimals})`);
    }
  });

program
  .command('quote')
  .description('Get a swap quote from AVNU (Sepolia)')
  .requiredOption('--sell <symbol>', 'Sell token symbol (e.g. WBTC)')
  .requiredOption('--buy <symbol>', 'Buy token symbol (e.g. USDC)')
  .requiredOption('--amount <amount>', 'Sell amount in human units (e.g. 0.001)')
  .option('--slippage <pct>', 'Slippage % used for display only (default 0.5)', '0.5')
  .option('--size <n>', 'Number of quotes to fetch (default 1)', '1')
  .action(async (opts) => {
    const sell = SEPOLIA_TOKENS[parseTokenSymbol(opts.sell)];
    const buy = SEPOLIA_TOKENS[parseTokenSymbol(opts.buy)];
    const env = getEnv();

    const sellAmount = BigInt(parseUnits(String(opts.amount), sell.decimals));
    const size = Number(opts.size || 1);

    const quotes = await fetchQuotes({
      sellTokenAddress: sell.address,
      buyTokenAddress: buy.address,
      sellAmount,
      takerAddress: env.STARKNET_ACCOUNT_ADDRESS,
      size,
    });

    if (!quotes.length) {
      console.log('No quotes returned');
      process.exit(2);
    }

    const q = quotes[0] as any;
    const buyAmount = BigInt(q.buyAmount);

    console.log(JSON.stringify({
      sell: sell.symbol,
      buy: buy.symbol,
      sellAmount: sellAmount.toString(),
      buyAmount: buyAmount.toString(),
      sellAmountHuman: formatUnits(sellAmount, sell.decimals),
      buyAmountHuman: formatUnits(buyAmount, buy.decimals),
      quoteId: q.quoteId,
      chainId: q.chainId,
      routes: q.routes,
      gasFees: q.gasFees,
    }, null, 2));
  });

program
  .command('swap')
  .description('Execute a swap on Starknet Sepolia via AVNU')
  .requiredOption('--sell <symbol>', 'Sell token symbol')
  .requiredOption('--buy <symbol>', 'Buy token symbol')
  .requiredOption('--amount <amount>', 'Sell amount in human units')
  .option('--slippage <pct>', 'Slippage % (default 0.5)', '0.5')
  .option('--dry-run', 'Only print best quote, do not execute', false)
  .action(async (opts) => {
    const sell = SEPOLIA_TOKENS[parseTokenSymbol(opts.sell)];
    const buy = SEPOLIA_TOKENS[parseTokenSymbol(opts.buy)];
    const env = getEnv();

    const sellAmount = BigInt(parseUnits(String(opts.amount), sell.decimals));
    const slippagePct = Number(opts.slippage);
    const slippage = slippagePct / 100;

    const quotes = await fetchQuotes({
      sellTokenAddress: sell.address,
      buyTokenAddress: buy.address,
      sellAmount,
      takerAddress: env.STARKNET_ACCOUNT_ADDRESS,
      size: 1,
    });
    if (!quotes.length) throw new Error('No quotes returned');

    const q: any = quotes[0];

    console.log('Best quote:');
    console.log(`  quoteId: ${q.quoteId}`);
    console.log(`  sell: ${sell.symbol} ${formatUnits(sellAmount, sell.decimals)}`);
    console.log(`  buy (est): ${buy.symbol} ${formatUnits(BigInt(q.buyAmount), buy.decimals)}`);

    if (opts.dryRun) return;

    const account = makeAccount();
    const res = await doSwap({ account, quote: q, slippage });
    console.log('txHash:', (res as any).transactionHash);
  });

program
  .command('status')
  .description('Check transaction status/receipt on Starknet Sepolia')
  .requiredOption('--tx <hash>', 'Transaction hash (0x...)')
  .action(async (opts) => {
    const provider = makeProvider();
    const txHash = String(opts.tx);

    try {
      const receipt: any = await provider.getTransactionReceipt(txHash);
      console.log(JSON.stringify(receipt, null, 2));
    } catch (e: any) {
      console.error(String(e?.message || e));
      process.exit(2);
    }
  });

program.parseAsync(process.argv);
