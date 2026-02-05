#!/usr/bin/env node

import { Command } from 'commander';
import { RpcProvider, Account, Signer, uint256, CallData } from 'starknet';
import { parseUnits, formatUnits } from 'ethers';
import { getEnv } from './env.js';
import { SEPOLIA_TOKENS, parseTokenSymbol } from './tokens.js';
import { fetchQuotes, doSwap } from './avnu.js';
import { starknetId, constants, num } from 'starknet';
import { approveErc20, parseNetwork, signX402Payment, x402Request } from './x402.js';

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

// Starknet ID Sepolia contract addresses (from https://docs.starknet.id/devs/contracts)
const STARKID_SEPOLIA_NAMING =
  '0x0707f09bc576bd7cfee59694846291047e965f4184fe13dac62c56759b3b6fa7';
const STARKID_SEPOLIA_PRICING =
  '0x031a361e2fbdf71fd9a095f30ecddb160424e2dbfc4dd405a21c2f389b609e71';

function normalizeStarkDomain(input: string): string {
  const s = input.trim();
  return s.toLowerCase().endsWith('.stark') ? s.slice(0, -'.stark'.length) : s;
}

const program = new Command();
program
  .name('claw-strk')
  .description('Starknet Sepolia swap CLI (AVNU)')
  .version('0.1.0')
  // Used by env loader (src/env.ts) before commander parses options.
  .option('--env <path>', 'Path to env file (default: ./\.env or ~/.claw-strk/.env)');

program
  .command('init')
  .description('Create a default config env file at ~/.claw-strk/.env')
  .option('--force', 'Overwrite if the file already exists', false)
  .action(async (opts) => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');

    const dir = path.join(os.homedir(), '.claw-strk');
    const target = path.join(dir, '.env');

    if (fs.existsSync(target) && !opts.force) {
      console.log(`Already exists: ${target}`);
      console.log('Use --force to overwrite.');
      return;
    }

    fs.mkdirSync(dir, { recursive: true });

    const template = `# claw-strk config\n#\n# Required\nSTARKNET_ACCOUNT_ADDRESS=0x...\nSTARKNET_PRIVATE_KEY=0x...\n\n# Optional\nSTARKNET_RPC_URL=https://starknet-sepolia-rpc.publicnode.com\n`;

    fs.writeFileSync(target, template, { encoding: 'utf8' });
    console.log(`Wrote: ${target}`);
  });

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
  .command('balance')
  .description('Check ERC-20 balances for the configured account on Starknet Sepolia')
  .option('--token <symbol...>', 'Token symbol(s) to check (default: all supported tokens)')
  .action(async (opts) => {
    const env = getEnv();
    const provider = makeProvider();

    const symbols: string[] = Array.isArray(opts.token) && opts.token.length
      ? opts.token
      : Object.keys(SEPOLIA_TOKENS);

    for (const symRaw of symbols) {
      const sym = parseTokenSymbol(String(symRaw));
      const token = SEPOLIA_TOKENS[sym];

      // Most Sepolia tokens are OZ ERC-20 v0.7 with `balance_of`.
      const result: any = await provider.callContract({
        contractAddress: token.address,
        entrypoint: 'balance_of',
        calldata: CallData.compile([env.STARKNET_ACCOUNT_ADDRESS]),
      });

      // starknet.js returns a string[] like [low, high] for u256.
      const [low, high] = result as [string, string];
      const bn = uint256.uint256ToBN({ low, high });

      console.log(`${token.symbol.padEnd(6)} ${formatUnits(bn, token.decimals)} (raw=${bn.toString()})`);
    }
  });

program
  .command('x402')
  .description('x402 payments for Starknet (client-side)')
  .addCommand(
    new Command('pay')
      .description('Generate a base64 X-PAYMENT header for a Starknet x402 payment (exact scheme)')
      .requiredOption('--to <address>', 'Recipient address (payTo)')
      .requiredOption('--token <symbol|address>', 'Token symbol (e.g. STRK) or token address')
      .requiredOption('--amount <amount>', 'Amount in human units (e.g. 0.01)')
      .option('--network <sepolia|mainnet>', 'Network (default: sepolia)', 'sepolia')
      .option('--deadline <seconds>', 'Deadline seconds from now (default 300)', '300')
      .action(async (opts) => {
        const env = getEnv();
        const provider = makeProvider();
        const account = makeAccount();

        const network = parseNetwork(String(opts.network));
        const token = (() => {
          const s = String(opts.token);
          try {
            return SEPOLIA_TOKENS[parseTokenSymbol(s)].address;
          } catch {
            return s;
          }
        })();

        const tokenInfo = Object.values(SEPOLIA_TOKENS).find(t => num.toBigInt(t.address) === num.toBigInt(token));
        const decimals = tokenInfo?.decimals ?? 18;

        const sellAmount = BigInt(parseUnits(String(opts.amount), decimals));
        const deadline = Math.floor(Date.now() / 1000) + Number(opts.deadline);

        const { payment, paymentHeader } = await signX402Payment({
          account,
          network,
          to: String(opts.to),
          token,
          amount: sellAmount.toString(),
          deadline,
        });

        console.log(JSON.stringify({
          from: env.STARKNET_ACCOUNT_ADDRESS,
          network,
          payment,
          paymentHeader,
          headerName: 'X-PAYMENT',
        }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
      })
  )
  .addCommand(
    new Command('approve')
      .description('Approve a facilitator/spender to transfer_from your tokens (one-time setup for x402 settlement)')
      .requiredOption('--token <symbol|address>', 'Token symbol (e.g. STRK) or token address')
      .requiredOption('--spender <address>', 'Facilitator/spender address')
      .requiredOption('--amount <amount>', 'Amount in human units to approve')
      .action(async (opts) => {
        const provider = makeProvider();
        const account = makeAccount();

        const token = (() => {
          const s = String(opts.token);
          try {
            return SEPOLIA_TOKENS[parseTokenSymbol(s)].address;
          } catch {
            return s;
          }
        })();

        const tokenInfo = Object.values(SEPOLIA_TOKENS).find(t => num.toBigInt(t.address) === num.toBigInt(token));
        const decimals = tokenInfo?.decimals ?? 18;
        const amountWei = BigInt(parseUnits(String(opts.amount), decimals));

        const res = await approveErc20({
          account,
          tokenAddress: token,
          spender: String(opts.spender),
          amount: amountWei,
        });

        console.log(JSON.stringify({
          token,
          spender: String(opts.spender),
          amountWei: amountWei.toString(),
          transactionHash: (res as any).transaction_hash ?? (res as any).transactionHash,
        }, null, 2));
      })
  )
  .addCommand(
    new Command('request')
      .description('Make an HTTP request; if 402, auto-sign and retry with X-PAYMENT (optional facilitator verify/settle)')
      .requiredOption('--url <url>', 'Resource URL')
      .option('--method <method>', 'HTTP method (default GET)', 'GET')
      .option('--data <json>', 'JSON body (for POST/PUT)')
      .option('--network <sepolia|mainnet>', 'Network (default: sepolia)', 'sepolia')
      .option('--facilitator <url>', 'Facilitator base URL (if provided, calls /verify and /settle)')
      .action(async (opts) => {
        const account = makeAccount();
        const network = parseNetwork(String(opts.network));
        const method = String(opts.method).toUpperCase();
        const body = opts.data ? JSON.stringify(JSON.parse(String(opts.data))) : undefined;

        const { response, settlement, requirements } = await x402Request(String(opts.url), {
          account,
          network,
          facilitatorUrl: opts.facilitator ? String(opts.facilitator) : undefined,
          requestInit: {
            method,
            headers: body ? { 'content-type': 'application/json' } : undefined,
            body,
          },
        });

        const text = await response.text();

        const txHash = settlement?.txHash as string | undefined;
        const explorerBase = network === 'starknet-mainnet'
          ? 'https://voyager.online'
          : 'https://sepolia.voyager.online';
        const explorerUrl = txHash ? `${explorerBase}/tx/${txHash}` : null;

        console.log(JSON.stringify({
          status: response.status,
          ok: response.ok,
          requirements,
          settlement,
          txHash,
          explorerUrl,
          body: text,
        }, null, 2));
      })
  );

program
  .command('starkid')
  .description('Starknet ID helpers (Sepolia)')
  .addCommand(
    new Command('whoami')
      .description('Print the configured account address + its primary .stark name (if any)')
      .action(async () => {
        const env = getEnv();
        const provider = makeProvider();
        const chainId = constants.StarknetChainId.SN_SEPOLIA;
        const naming = STARKID_SEPOLIA_NAMING;

        let name: string | null = null;
        try {
          name = await provider.getStarkName(env.STARKNET_ACCOUNT_ADDRESS, naming);
        } catch {
          name = null;
        }

        console.log(JSON.stringify({
          chainId,
          namingContract: naming,
          address: env.STARKNET_ACCOUNT_ADDRESS,
          starkName: name,
        }, null, 2));
      })
  )
  .addCommand(
    new Command('resolve')
      .description('Resolve a .stark name to an address')
      .requiredOption('--name <name>', 'e.g. bobio.stark')
      .action(async (opts) => {
        const provider = makeProvider();
        const chainId = constants.StarknetChainId.SN_SEPOLIA;
        const naming = STARKID_SEPOLIA_NAMING;

        const name = normalizeStarkDomain(String(opts.name));
        const addr = await provider.getAddressFromStarkName(name, naming);

        console.log(JSON.stringify({ chainId, name: `${name}.stark`, address: addr }, null, 2));
      })
  )
  .addCommand(
    new Command('register')
      .description('Register a .stark domain (onchain). WARNING: costs gas and likely requires ETH payment/approvals.')
      .requiredOption('--name <name>', 'Domain to register, e.g. myagent.stark')
      .option('--days <n>', 'Registration length in days (default: 365)', '365')
      .option('--resolver <address>', 'Resolver contract address (default: your own account address)')
      .option('--sponsor <address>', 'Sponsor address (default: 0x0)', '0x0')
      .option('--discount-id <felt>', 'Discount id felt252 (default: 0x0)', '0x0')
      .option('--metadata <felt>', 'Metadata felt252 (default: 0x0)', '0x0')
      .option('--id <u128>', 'Identity id to associate (default: 0)', '0')
      .option('--dry-run', 'Print calldata only (default)', true)
      .option('--send', 'Actually send the transaction', false)
      .action(async (opts) => {
        const env = getEnv();
        const provider = makeProvider();
        const chainId = constants.StarknetChainId.SN_SEPOLIA;
        const naming = STARKID_SEPOLIA_NAMING;

        const decoded = normalizeStarkDomain(String(opts.name));
        const domainFelt = starknetId.useEncoded(decoded); // felt

        const days = Number(opts.days);
        const id = BigInt(opts.id);
        const resolver = String(opts.resolver || env.STARKNET_ACCOUNT_ADDRESS);

        const call = {
          contractAddress: naming,
          entrypoint: 'buy',
          calldata: CallData.compile({
            id: num.toHex(id),
            domain: num.toHex(domainFelt),
            days,
            resolver,
            sponsor: String(opts.sponsor),
            discount_id: String(opts.discountId ?? opts['discount-id'] ?? '0x0'),
            metadata: String(opts.metadata),
          }),
        } as any;

        if (!opts.send) {
          console.log('DRY RUN (no tx sent). To send, add --send');
          console.log(JSON.stringify({ chainId, naming, name: `${decoded}.stark`, call }, null, 2));
          return;
        }

        // --- SEND MODE ---
        // Starknet ID buy() expects payment (on Sepolia: ETH ERC-20) via transfer_from,
        // so we must approve the naming contract first.
        //
        // NOTE: we provide manual `resourceBounds` to avoid fee-estimation simulation issues
        // seen with some Starknet ID calls on some RPC providers.
        const pricingRes: any = await provider.callContract({
          contractAddress: STARKID_SEPOLIA_PRICING,
          entrypoint: 'compute_buy_price',
          calldata: CallData.compile({ domain_len: decoded.length, days }),
        });

        const [paymentToken, priceLow, priceHigh] = pricingRes as [string, string, string];
        const price = uint256.uint256ToBN({ low: priceLow, high: priceHigh });

        const ethToken = SEPOLIA_TOKENS.ETH.address;
        if (num.toBigInt(paymentToken) !== num.toBigInt(ethToken)) {
          throw new Error(`Unsupported payment token for Sepolia buy: ${paymentToken}. Expected ETH token ${ethToken}`);
        }

        const approveCall = {
          contractAddress: ethToken,
          entrypoint: 'approve',
          calldata: CallData.compile({
            spender: naming,
            amount: uint256.bnToUint256(price),
          }),
        } as any;

        const account = makeAccount();

        // Manual bounds (copied from a previously successful AVNU swap tx, with some headroom).
        // These act as a fee cap; if too low, the network will reject.
        const resourceBounds = {
          l1_gas: { max_amount: 0n, max_price_per_unit: 0x63c16384338cn },
          l2_gas: { max_amount: 0x2000000n, max_price_per_unit: 0x2cb417800n },
          l1_data_gas: { max_amount: 0x800n, max_price_per_unit: 0x65b4d84987n },
        };

        const res = await account.execute([approveCall, call], { resourceBounds } as any);

        const payload = {
          chainId,
          naming,
          name: `${decoded}.stark`,
          priceWei: price.toString(),
          resourceBounds,
          transactionHash: (res as any).transaction_hash ?? (res as any).transactionHash,
        };

        console.log(JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
      })
  );

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

    const gasFeesSafe = Array.isArray(q.gasFees)
      ? q.gasFees.map((g: any) => ({
          ...g,
          // AVNU SDK sometimes returns BigInt values; make JSON-safe.
          amount: typeof g.amount === 'bigint' ? g.amount.toString() : g.amount,
        }))
      : q.gasFees;

    const payload = {
      sell: sell.symbol,
      buy: buy.symbol,
      sellAmount: sellAmount.toString(),
      buyAmount: buyAmount.toString(),
      sellAmountHuman: formatUnits(sellAmount, sell.decimals),
      buyAmountHuman: formatUnits(buyAmount, buy.decimals),
      quoteId: q.quoteId,
      chainId: q.chainId,
      routes: q.routes,
      gasFees: gasFeesSafe,
    };

    // JSON-safe stringify (BigInt -> string anywhere)
    console.log(JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
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
