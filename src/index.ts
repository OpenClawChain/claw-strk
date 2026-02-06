#!/usr/bin/env node

import { Command } from 'commander';
import { RpcProvider, Account, Signer, uint256, CallData } from 'starknet';
import { parseUnits, formatUnits } from 'ethers';
import { getEnv } from './env.js';
import { SEPOLIA_TOKENS, parseTokenSymbol } from './tokens.js';
import { fetchQuotes, doSwap } from './avnu.js';
import { starknetId, constants, num } from 'starknet';
import { approveErc20, parseNetwork, signX402Payment, x402Request } from './x402.js';
import { loadLendConfig, saveLendConfig, voyagerContractUrl, voyagerTxUrl, DEMO_POOLS, findDemoPool } from './lend.js';
import { declareAndDeployToken, mintToken, TokenKind } from './token.js';
import { declareAndDeployNft, mintErc721, parseU256, getErc721Balance } from './nft.js';
import {
  DEFAULT_CLAWID_REGISTRY,
  declareAndDeployClawId,
  getClawRecord,
  nameOf,
  registerClawName,
  resolveClawName,
  setClawMetadata,
} from './clawid.js';
import fs from 'node:fs';

function tokenSymbolByAddress(addr: string): string {
  const a = addr.toLowerCase();
  for (const t of Object.values(SEPOLIA_TOKENS)) {
    if (t.address.toLowerCase() === a) return t.symbol;
  }
  return addr;
}

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

const jsonBigint = (_k: string, v: any) => (typeof v === 'bigint' ? v.toString() : v);

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
      .option(
        '--facilitator <url>',
        'Facilitator base URL (default for sepolia: https://stark-facilitator.openclawchain.org/api/facilitator). If set, calls /verify and /settle'
      )
      .action(async (opts) => {
        const account = makeAccount();
        const network = parseNetwork(String(opts.network));
        const method = String(opts.method).toUpperCase();
        const body = opts.data ? JSON.stringify(JSON.parse(String(opts.data))) : undefined;

        const defaultFacilitator = network === 'starknet-sepolia'
          ? 'https://stark-facilitator.openclawchain.org/api/facilitator'
          : undefined;

        const { response, settlement, requirements } = await x402Request(String(opts.url), {
          account,
          network,
          facilitatorUrl: opts.facilitator ? String(opts.facilitator) : defaultFacilitator,
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

function resolveLendTarget(args: {
  network: 'starknet-sepolia' | 'starknet-mainnet';
  cfg: any;
  poolId?: string;
  poolAddressOverride?: string;
}) {
  const poolId = String(args.poolId || args.cfg.poolId || 'strk-usdc');
  const demo = findDemoPool({ network: args.network, poolId });

  const poolAddress = String(args.poolAddressOverride || demo?.poolAddress || args.cfg.poolAddress || '');
  if (!poolAddress) {
    throw new Error('No pool configured. Use `claw-strk lend pools` then pass --pool-id, or use --pool <address>.');
  }

  const outCfg = { ...args.cfg };
  if (demo) {
    outCfg.poolId = demo.poolId;
    outCfg.poolAddress = demo.poolAddress;
    outCfg.collateralToken = demo.collateralToken;
    outCfg.borrowToken = demo.borrowToken;
    outCfg.collateralSymbol = demo.collateralSymbol;
    outCfg.borrowSymbol = demo.borrowSymbol;
    outCfg.wbtcDecimals = demo.collateralDecimals === 8 ? 8 : outCfg.wbtcDecimals;
    outCfg.usdcDecimals = demo.borrowDecimals === 6 ? 6 : outCfg.usdcDecimals;
  }

  return { cfg: outCfg, poolAddress, poolId, demo };
}

program
  .command('lend')
  .description('Lending pool demo tools (Sepolia)')
  .addCommand(
    new Command('pools')
      .description('List built-in demo pools shipped with the CLI')
      .option('--network <network>', 'starknet-sepolia | starknet-mainnet', 'starknet-sepolia')
      .action(async (opts) => {
        const network = parseNetwork(String(opts.network)) as any;
        const pools = DEMO_POOLS.filter((p) => p.network === network).map((p) => ({
          poolId: p.poolId,
          poolAddress: p.poolAddress,
          collateral: p.collateralSymbol,
          borrow: p.borrowSymbol,
          collateralToken: p.collateralToken,
          borrowToken: p.borrowToken,
          explorer: voyagerContractUrl(network, p.poolAddress),
        }));
        console.log(JSON.stringify({ network, pools }, null, 2));
      })
  )
  .addCommand(
    new Command('init')
      .description('Deploy lending pool contracts (Registry + Pool) and save config (advanced)')
      .option('--network <network>', 'starknet-sepolia | starknet-mainnet', 'starknet-sepolia')
      .option('--price <price>', 'Initial price for 1 collateral in borrow token (default: 43000)', '43000')
      .option('--collateral <token>', 'Collateral token symbol or address (default from config)')
      .option('--borrow <token>', 'Borrow token symbol or address (default from config)')
      .option('--force', 'Overwrite existing saved lend config', false)
      .action(async (opts) => {
        try {
          const network = parseNetwork(String(opts.network)) as any;
          if (network !== 'starknet-sepolia' && network !== 'starknet-mainnet') {
            throw new Error(`Unsupported network: ${network}`);
          }

          const account = makeAccount();
          const cfg = loadLendConfig(network);
          if ((cfg.poolAddress || cfg.registryAddress) && !opts.force) {
            console.error('Already initialized. Use --force to overwrite.');
            console.error(JSON.stringify(cfg, null, 2));
            process.exit(2);
          }

          const collateralToken = opts.collateral
            ? (String(opts.collateral).startsWith('0x')
                ? String(opts.collateral)
                : SEPOLIA_TOKENS[parseTokenSymbol(String(opts.collateral))].address)
            : cfg.collateralToken;

          const borrowToken = opts.borrow
            ? (String(opts.borrow).startsWith('0x')
                ? String(opts.borrow)
                : SEPOLIA_TOKENS[parseTokenSymbol(String(opts.borrow))].address)
            : cfg.borrowToken;

        throw new Error(
          'lend init (deploy) was moved out of claw-strk. Use the pre-deployed demo pool via --pool-id (default: strk-usdc).'
        );
        } catch (e: any) {
          console.error('lend init failed');
          console.error(e?.message ?? String(e));
          if (e?.response) console.error('response:', e.response);
          if (e?.stack) console.error(e.stack);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('pool')
      .description('Show pool status (reserves + price)')
      .option('--network <network>', 'starknet-sepolia | starknet-mainnet', 'starknet-sepolia')
      .option('--pool-id <id>', 'Pool id (default: strk-usdc)', 'strk-usdc')
      .option('--pool <address>', 'Override pool address')
      .action(async (opts) => {
        const network = parseNetwork(String(opts.network)) as any;
        const provider = makeProvider();
        const baseCfg = loadLendConfig(network);
        const { cfg, poolAddress } = resolveLendTarget({
          network,
          cfg: baseCfg,
          poolId: String(opts.poolId || 'strk-usdc'),
          poolAddressOverride: String(opts.pool || ''),
        });

        const priceRes: any = await provider.callContract({
          contractAddress: poolAddress,
          entrypoint: 'get_price_wbtc_usdc',
          calldata: [],
        });
        const priceE6 = BigInt(priceRes[0]);

        const wbtcBal: any = await provider.callContract({
          contractAddress: cfg.collateralToken,
          entrypoint: 'balance_of',
          calldata: CallData.compile({ account: poolAddress }),
        });
        const usdcBal: any = await provider.callContract({
          contractAddress: cfg.borrowToken,
          entrypoint: 'balance_of',
          calldata: CallData.compile({ account: poolAddress }),
        });

        const wbtc = uint256.uint256ToBN({ low: wbtcBal[0], high: wbtcBal[1] });
        const usdc = uint256.uint256ToBN({ low: usdcBal[0], high: usdcBal[1] });

        console.log(
          JSON.stringify(
            {
              network,
              poolAddress,
              poolExplorer: voyagerContractUrl(network, poolAddress),
              registryAddress: cfg.registryAddress,
              collateralToken: cfg.collateralToken,
              borrowToken: cfg.borrowToken,
              priceWbtcUsdcE6: priceE6.toString(),
              reserves: {
                wbtc: wbtc.toString(),
                usdc: usdc.toString(),
              },
            },
            null,
            2
          )
        );
      })
  )
  .addCommand(
    new Command('account')
      .description('Show your lending position/health')
      .option('--network <network>', 'starknet-sepolia | starknet-mainnet', 'starknet-sepolia')
      .option('--pool-id <id>', 'Pool id (default: strk-usdc)', 'strk-usdc')
      .option('--pool <address>', 'Override pool address')
      .option('--address <address>', 'Override user address (default: your configured account)')
      .action(async (opts) => {
        const network = parseNetwork(String(opts.network)) as any;
        const provider = makeProvider();
        const env = getEnv();
        const baseCfg = loadLendConfig(network);
        const { cfg, poolAddress } = resolveLendTarget({
          network,
          cfg: baseCfg,
          poolId: String(opts.poolId || 'strk-usdc'),
          poolAddressOverride: String(opts.pool || ''),
        });
        const user = String(opts.address || env.STARKNET_ACCOUNT_ADDRESS);

        const cRes: any = await provider.callContract({
          contractAddress: poolAddress,
          entrypoint: 'collateral_of',
          calldata: CallData.compile({ user }),
        });
        const dRes: any = await provider.callContract({
          contractAddress: poolAddress,
          entrypoint: 'debt_of',
          calldata: CallData.compile({ user }),
        });
        const pRes: any = await provider.callContract({
          contractAddress: poolAddress,
          entrypoint: 'get_price_wbtc_usdc',
          calldata: [],
        });

        const collateral = uint256.uint256ToBN({ low: cRes[0], high: cRes[1] });
        const debt = uint256.uint256ToBN({ low: dRes[0], high: dRes[1] });
        const priceE6 = BigInt(pRes[0]);

        // Offchain health calc (WBTC 1e8, USDC 1e6)
        const collateralValueUsdcE6 = (BigInt(collateral.toString()) * priceE6) / 100000000n;
        const maxBorrowUsdcE6 = (collateralValueUsdcE6 * 6000n) / 10000n;
        const debtE6 = BigInt(debt.toString());
        const availableE6 = maxBorrowUsdcE6 > debtE6 ? maxBorrowUsdcE6 - debtE6 : 0n;

        console.log(
          JSON.stringify(
            {
              network,
              poolAddress,
              user,
              collateralWbtc_1e8: collateral.toString(),
              debtUsdc_1e6: debt.toString(),
              priceWbtcUsdcE6: priceE6.toString(),
              collateralValueUsdcE6: collateralValueUsdcE6.toString(),
              maxBorrowUsdcE6: maxBorrowUsdcE6.toString(),
              availableToBorrowUsdcE6: availableE6.toString(),
            },
            null,
            2
          )
        );
      })
  )
  .addCommand(
    new Command('deposit')
      .description('Deposit collateral into the pool (e.g. STRK)')
      .option('--network <network>', 'starknet-sepolia | starknet-mainnet', 'starknet-sepolia')
      .option('--pool-id <id>', 'Pool id (default: strk-usdc)', 'strk-usdc')
      .option('--pool <address>', 'Override pool address')
      .requiredOption('--amount <amount>', 'Amount in human units (e.g. 1 STRK)')
      .action(async (opts) => {
        const network = parseNetwork(String(opts.network)) as any;
        const baseCfg = loadLendConfig(network);
        const { cfg, poolAddress } = resolveLendTarget({
          network,
          cfg: baseCfg,
          poolId: String(opts.poolId || 'strk-usdc'),
          poolAddressOverride: String(opts.pool || ''),
        });

        const collateralSymbol = cfg.collateralSymbol ?? tokenSymbolByAddress(cfg.collateralToken);
        console.error(`pool: ${collateralSymbol}/${cfg.borrowSymbol ?? tokenSymbolByAddress(cfg.borrowToken)} (${cfg.poolId ?? 'unknown'})`);
        console.error(`depositing: ${opts.amount} ${collateralSymbol}`);

        const collateralDecimals =
          cfg.collateralToken.toLowerCase() === SEPOLIA_TOKENS.STRK.address.toLowerCase() ? 18 : (cfg.wbtcDecimals ?? 8);
        const amount = BigInt(parseUnits(String(opts.amount), collateralDecimals).toString());

        const account = makeAccount();

        const approveCall = {
          contractAddress: cfg.collateralToken,
          entrypoint: 'approve',
          calldata: CallData.compile({
            spender: poolAddress,
            amount: uint256.bnToUint256(amount),
          }),
        } as any;

        const depositCall = {
          contractAddress: poolAddress,
          entrypoint: 'deposit',
          calldata: CallData.compile({ amount: uint256.bnToUint256(amount) }),
        } as any;

        const res: any = await account.execute([approveCall, depositCall]);

        const tx = res.transaction_hash ?? res.transactionHash;
        console.log(JSON.stringify({ txHash: tx, explorerUrl: voyagerTxUrl(network, tx) }, null, 2));
      })
  )
  .addCommand(
    new Command('withdraw')
      .description('Withdraw collateral from the pool (e.g. STRK)')
      .option('--network <network>', 'starknet-sepolia | starknet-mainnet', 'starknet-sepolia')
      .option('--pool-id <id>', 'Pool id (default: strk-usdc)', 'strk-usdc')
      .option('--pool <address>', 'Override pool address')
      .requiredOption('--amount <amount>', 'Amount in human units (e.g. 1 STRK)')
      .action(async (opts) => {
        const network = parseNetwork(String(opts.network)) as any;
        const baseCfg = loadLendConfig(network);
        const { cfg, poolAddress } = resolveLendTarget({
          network,
          cfg: baseCfg,
          poolId: String(opts.poolId || 'strk-usdc'),
          poolAddressOverride: String(opts.pool || ''),
        });

        const collateralSymbol = cfg.collateralSymbol ?? tokenSymbolByAddress(cfg.collateralToken);
        console.error(`pool: ${collateralSymbol}/${cfg.borrowSymbol ?? tokenSymbolByAddress(cfg.borrowToken)} (${cfg.poolId ?? 'unknown'})`);
        console.error(`withdrawing: ${opts.amount} ${collateralSymbol}`);

        const collateralDecimals =
          cfg.collateralToken.toLowerCase() === SEPOLIA_TOKENS.STRK.address.toLowerCase() ? 18 : (cfg.wbtcDecimals ?? 8);
        const amount = BigInt(parseUnits(String(opts.amount), collateralDecimals).toString());
        const account = makeAccount();
        const res: any = await account.execute({
          contractAddress: poolAddress,
          entrypoint: 'withdraw',
          calldata: CallData.compile({ amount: uint256.bnToUint256(amount) }),
        });
        const tx = res.transaction_hash ?? res.transactionHash;
        console.log(JSON.stringify({ txHash: tx, explorerUrl: voyagerTxUrl(network, tx) }, null, 2));
      })
  )
  .addCommand(
    new Command('borrow')
      .description('Borrow USDC against collateral')
      .option('--network <network>', 'starknet-sepolia | starknet-mainnet', 'starknet-sepolia')
      .option('--pool-id <id>', 'Pool id (default: strk-usdc)', 'strk-usdc')
      .option('--pool <address>', 'Override pool address')
      .option('--amount <amount>', 'Amount in human units')
      .option('--max', 'Borrow a safe amount (min of LTV limit and pool liquidity)', false)
      .option('--cap <amount>', 'Cap amount in human units when using --max (default: 0.005)', '0.005')
      .action(async (opts) => {
        const network = parseNetwork(String(opts.network)) as any;
        const baseCfg = loadLendConfig(network);
        const { cfg, poolAddress } = resolveLendTarget({
          network,
          cfg: baseCfg,
          poolId: String(opts.poolId || 'strk-usdc'),
          poolAddressOverride: String(opts.pool || ''),
        });

        const provider = makeProvider();
        const env = getEnv();

        const collateralSymbol = cfg.collateralSymbol ?? tokenSymbolByAddress(cfg.collateralToken);
        const borrowSymbol = cfg.borrowSymbol ?? tokenSymbolByAddress(cfg.borrowToken);
        console.error(`pool: ${collateralSymbol}/${borrowSymbol} (${cfg.poolId ?? 'unknown'})`);
        if (opts.max) console.error(`borrowing: --max (cap ${opts.cap} ${borrowSymbol})`);
        else console.error(`borrowing: ${opts.amount} ${borrowSymbol}`);

        // pool USDC reserves
        const usdcBal: any = await provider.callContract({
          contractAddress: cfg.borrowToken,
          entrypoint: 'balance_of',
          calldata: CallData.compile({ account: poolAddress }),
        });
        const poolUsdc = BigInt(uint256.uint256ToBN({ low: usdcBal[0], high: usdcBal[1] }).toString());

        // user max borrow (offchain calc)
        const cRes: any = await provider.callContract({
          contractAddress: poolAddress,
          entrypoint: 'collateral_of',
          calldata: CallData.compile({ user: env.STARKNET_ACCOUNT_ADDRESS }),
        });
        const dRes: any = await provider.callContract({
          contractAddress: poolAddress,
          entrypoint: 'debt_of',
          calldata: CallData.compile({ user: env.STARKNET_ACCOUNT_ADDRESS }),
        });
        const pRes: any = await provider.callContract({
          contractAddress: poolAddress,
          entrypoint: 'get_price_wbtc_usdc',
          calldata: [],
        });

        const collateral = BigInt(uint256.uint256ToBN({ low: cRes[0], high: cRes[1] }).toString());
        const debt = BigInt(uint256.uint256ToBN({ low: dRes[0], high: dRes[1] }).toString());
        const priceE6 = BigInt(pRes[0]);

        // NOTE: contract assumes collateral has 1e8 decimals for value conversion.
        // For our demo STRK pool, we accept this approximation and keep borrow amounts tiny.
        const collateralValueUsdcE6 = (collateral * priceE6) / 100000000n;
        const maxBorrowUsdcE6 = (collateralValueUsdcE6 * 6000n) / 10000n;
        const availableByLtv = maxBorrowUsdcE6 > debt ? maxBorrowUsdcE6 - debt : 0n;

        const cap = BigInt(parseUnits(String(opts.cap ?? '0.01'), cfg.usdcDecimals ?? 6).toString());
        const maxSafe = availableByLtv < poolUsdc ? availableByLtv : poolUsdc;

        const desired = opts.max
          ? (cap > 0n && maxSafe > cap ? cap : maxSafe)
          : BigInt(parseUnits(String(opts.amount), cfg.usdcDecimals ?? 6).toString());

        if (desired <= 0n) {
          throw new Error(`Nothing available to borrow (poolUsdc=${poolUsdc}, availableByLtv=${availableByLtv})`);
        }

        if (desired > poolUsdc) {
          throw new Error(
            `Pool has insufficient borrow-token liquidity. pool=${tokenSymbolByAddress(cfg.collateralToken)}/${tokenSymbolByAddress(cfg.borrowToken)} poolUsdc_1e6=${poolUsdc}. Try a smaller amount or fund the pool.`
          );
        }

        const account = makeAccount();
        const res: any = await account.execute({
          contractAddress: poolAddress,
          entrypoint: 'borrow',
          calldata: CallData.compile({ amount: uint256.bnToUint256(desired) }),
        });
        const tx = res.transaction_hash ?? res.transactionHash;
        console.log(
          JSON.stringify(
            {
              borrowedUsdc_1e6: desired.toString(),
              poolUsdc_1e6: poolUsdc.toString(),
              availableByLtv_1e6: availableByLtv.toString(),
              txHash: tx,
              explorerUrl: voyagerTxUrl(network, tx),
            },
            null,
            2
          )
        );
      })
  )
  .addCommand(
    new Command('repay')
      .description('Repay USDC debt')
      .option('--network <network>', 'starknet-sepolia | starknet-mainnet', 'starknet-sepolia')
      .option('--pool-id <id>', 'Pool id (default: strk-usdc)', 'strk-usdc')
      .option('--pool <address>', 'Override pool address')
      .requiredOption('--amount <amount>', 'Amount in human units')
      .action(async (opts) => {
        const network = parseNetwork(String(opts.network)) as any;
        const baseCfg = loadLendConfig(network);
        const { cfg, poolAddress } = resolveLendTarget({
          network,
          cfg: baseCfg,
          poolId: String(opts.poolId || 'strk-usdc'),
          poolAddressOverride: String(opts.pool || ''),
        });

        const amount = BigInt(parseUnits(String(opts.amount), cfg.usdcDecimals ?? 6).toString());
        const account = makeAccount();

        const approveCall = {
          contractAddress: cfg.borrowToken,
          entrypoint: 'approve',
          calldata: CallData.compile({
            spender: poolAddress,
            amount: uint256.bnToUint256(amount),
          }),
        } as any;

        const repayCall = {
          contractAddress: poolAddress,
          entrypoint: 'repay',
          calldata: CallData.compile({ amount: uint256.bnToUint256(amount) }),
        } as any;

        const res: any = await account.execute([approveCall, repayCall]);
        const tx = res.transaction_hash ?? res.transactionHash;
        console.log(JSON.stringify({ txHash: tx, explorerUrl: voyagerTxUrl(network, tx) }, null, 2));
      })
  )
  .addCommand(
    new Command('fund')
      .description('Fund the pool with borrow token liquidity (e.g. USDC)')
      .option('--network <network>', 'starknet-sepolia | starknet-mainnet', 'starknet-sepolia')
      .option('--pool-id <id>', 'Pool id (default: strk-usdc)', 'strk-usdc')
      .option('--pool <address>', 'Override pool address')
      .requiredOption('--amount <amount>', 'Amount in human units (USDC)')
      .action(async (opts) => {
        const network = parseNetwork(String(opts.network)) as any;
        const baseCfg = loadLendConfig(network);
        const { cfg, poolAddress } = resolveLendTarget({
          network,
          cfg: baseCfg,
          poolId: String(opts.poolId || 'strk-usdc'),
          poolAddressOverride: String(opts.pool || ''),
        });

        const borrowSymbol = cfg.borrowSymbol ?? tokenSymbolByAddress(cfg.borrowToken);
        console.error(`pool: ${cfg.collateralSymbol ?? tokenSymbolByAddress(cfg.collateralToken)}/${borrowSymbol} (${cfg.poolId ?? 'unknown'})`);
        console.error(`funding: ${opts.amount} ${borrowSymbol}`);

        const amount = BigInt(parseUnits(String(opts.amount), cfg.usdcDecimals ?? 6).toString());
        const account = makeAccount();
        const res: any = await account.execute({
          contractAddress: cfg.borrowToken,
          entrypoint: 'transfer',
          calldata: CallData.compile({ recipient: poolAddress, amount: uint256.bnToUint256(amount) }),
        });
        const tx = res.transaction_hash ?? res.transactionHash;
        console.log(JSON.stringify({ txHash: tx, explorerUrl: voyagerTxUrl(network, tx) }, null, 2));
      })
  )
  .addCommand(
    new Command('demo')
      .description('Run a tiny end-to-end demo: deposit 1 STRK, borrow 0.005 USDC, repay 0.005 USDC')
      .option('--network <network>', 'starknet-sepolia | starknet-mainnet', 'starknet-sepolia')
      .option('--pool-id <id>', 'Pool id (default: strk-usdc)', 'strk-usdc')
      .option('--pool <address>', 'Override pool address')
      .action(async (opts) => {
        const network = parseNetwork(String(opts.network)) as any;
        const baseCfg = loadLendConfig(network);
        const { cfg, poolAddress } = resolveLendTarget({
          network,
          cfg: baseCfg,
          poolId: String(opts.poolId || 'strk-usdc'),
          poolAddressOverride: String(opts.pool || ''),
        });

        const depositAmount = '1';
        const borrowAmount = '0.005';

        const account = makeAccount();

        async function waitTx(txHash: string) {
          // best-effort wait; demo UX > perfect.
          await account.waitForTransaction(txHash);
        }

        // deposit 1 STRK (approve + deposit)
        console.error('Demo: deposit 1 STRK');
        const deposit = BigInt(parseUnits(depositAmount, 18).toString());
        const approveCollateral = {
          contractAddress: cfg.collateralToken,
          entrypoint: 'approve',
          calldata: CallData.compile({ spender: poolAddress, amount: uint256.bnToUint256(deposit) }),
        } as any;
        const depositCall = {
          contractAddress: poolAddress,
          entrypoint: 'deposit',
          calldata: CallData.compile({ amount: uint256.bnToUint256(deposit) }),
        } as any;
        const depRes: any = await account.execute([approveCollateral, depositCall]);
        const depTx = depRes.transaction_hash ?? depRes.transactionHash;
        await waitTx(depTx);

        // borrow a tiny amount of USDC (capped by pool liquidity)
        const provider = makeProvider();
        const poolUsdcBal: any = await provider.callContract({
          contractAddress: cfg.borrowToken,
          entrypoint: 'balance_of',
          calldata: CallData.compile({ account: poolAddress }),
        });
        const poolUsdc = BigInt(uint256.uint256ToBN({ low: poolUsdcBal[0], high: poolUsdcBal[1] }).toString());

        const requestedBorrow = BigInt(parseUnits(borrowAmount, cfg.usdcDecimals ?? 6).toString());
        const borrow = poolUsdc > requestedBorrow ? requestedBorrow : poolUsdc;

        if (borrow <= 0n) {
          console.error('Demo: pool has 0 borrow-token liquidity. Fund it first: claw-strk lend fund --amount 0.01');
          process.exit(2);
        }

        console.error(`Demo: borrow ${borrowAmount} ${cfg.borrowSymbol ?? tokenSymbolByAddress(cfg.borrowToken)} (actual raw=${borrow})`);
        const borRes: any = await account.execute({
          contractAddress: poolAddress,
          entrypoint: 'borrow',
          calldata: CallData.compile({ amount: uint256.bnToUint256(borrow) }),
        });
        const borTx = borRes.transaction_hash ?? borRes.transactionHash;
        await waitTx(borTx);

        // repay the borrowed amount (approve + repay)
        console.error(`Demo: repay ${borrowAmount} ${cfg.borrowSymbol ?? tokenSymbolByAddress(cfg.borrowToken)}`);
        const approveBorrow = {
          contractAddress: cfg.borrowToken,
          entrypoint: 'approve',
          calldata: CallData.compile({ spender: poolAddress, amount: uint256.bnToUint256(borrow) }),
        } as any;
        const repayCall = {
          contractAddress: poolAddress,
          entrypoint: 'repay',
          calldata: CallData.compile({ amount: uint256.bnToUint256(borrow) }),
        } as any;
        const repRes: any = await account.execute([approveBorrow, repayCall]);
        const repTx = repRes.transaction_hash ?? repRes.transactionHash;
        await waitTx(repTx);

        console.log(
          JSON.stringify(
            {
              network,
              poolAddress,
              actions: {
                depositTx: depTx,
                depositExplorer: voyagerTxUrl(network, depTx),
                borrowTx: borTx,
                borrowExplorer: voyagerTxUrl(network, borTx),
                repayTx: repTx,
                repayExplorer: voyagerTxUrl(network, repTx),
              },
            },
            null,
            2
          )
        );
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
  .command('token')
  .description('Deploy and manage demo ERC20 tokens (Sepolia)')
  .addCommand(
    new Command('create')
      .description('Deploy an ERC20 token to Sepolia (fixed supply or mintable)')
      .option('--kind <kind>', 'fixed | mintable (default: mintable)', 'mintable')
      .requiredOption('--name <name>', 'Token name, e.g. "Demo USD"')
      .requiredOption('--symbol <symbol>', 'Token symbol, e.g. DUSD')
      .option('--decimals <n>', 'Token decimals (default: 18)', '18')
      .option('--initial <amount>', 'Initial supply in human units (default: 0)', '0')
      .option('--to <address>', 'Recipient for initial supply (default: your account)')
      .option('--owner <address>', 'Owner/minter (mintable only; default: your account)')
      .action(async (opts) => {
        const kind = String(opts.kind).toLowerCase() as TokenKind;
        if (kind !== 'fixed' && kind !== 'mintable') throw new Error('Invalid --kind. Use fixed|mintable');

        const env = getEnv();
        const account = makeAccount();

        const decimals = Number(opts.decimals);
        if (!Number.isFinite(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid --decimals');

        const initialHuman = String(opts.initial ?? '0');
        const initialSupply = BigInt(parseUnits(initialHuman, decimals).toString());

        // Manual bounds (same style as lend) to avoid fee estimation instability.
        const resourceBounds = {
          l1_gas: { max_amount: 0n, max_price_per_unit: 0x63c16384338cn },
          l2_gas: { max_amount: 0x20000000n, max_price_per_unit: 0x2cb417800n },
          l1_data_gas: { max_amount: 0x2000n, max_price_per_unit: 0x65b4d84987n },
        };

        const res = await declareAndDeployToken({
          account,
          kind,
          name: String(opts.name),
          symbol: String(opts.symbol),
          decimals,
          initialSupply,
          recipient: String(opts.to || env.STARKNET_ACCOUNT_ADDRESS),
          owner: String(opts.owner || env.STARKNET_ACCOUNT_ADDRESS),
          resourceBounds,
        });

        console.log(
          JSON.stringify(
            {
              network: 'starknet-sepolia',
              kind,
              name: String(opts.name),
              symbol: String(opts.symbol),
              decimals,
              initialSupplyHuman: initialHuman,
              contractAddress: res.contractAddress,
              classHash: res.classHash,
              declareTx: res.declareTx,
              deployTx: res.deployTx,
              explorer: `https://sepolia.voyager.online/contract/${res.contractAddress}`,  // voyager
            },
            null,
            2
          )
        );
      })
  )
  .addCommand(
    new Command('mint')
      .description('Mint tokens on a mintable ERC20 (owner-only)')
      .requiredOption('--token <address>', 'Token contract address')
      .requiredOption('--to <address>', 'Recipient address')
      .requiredOption('--amount <amount>', 'Amount in human units')
      .option('--decimals <n>', 'Token decimals (default: 18)', '18')
      .action(async (opts) => {
        const account = makeAccount();
        const decimals = Number(opts.decimals);
        const amount = BigInt(parseUnits(String(opts.amount), decimals).toString());
        const res = await mintToken({
          account,
          tokenAddress: String(opts.token),
          to: String(opts.to),
          amount,
        });
        console.log(JSON.stringify({ txHash: res.txHash, explorerUrl: voyagerTxUrl('starknet-sepolia', res.txHash) }, null, 2));
      })
  );

program
  .command('claw')
  .description('Manage .claw name registry on Starknet')
  .addCommand(
    new Command('deploy')
      .description('Deploy the ClawIdRegistry contract')
      .option('--network <sepolia|mainnet>', 'Network (default: sepolia)', 'sepolia')
      .action(async (opts) => {
        const account = makeAccount();
        const network = parseNetwork(String(opts.network));

        const resourceBounds = {
          l1_gas: { max_amount: 0n, max_price_per_unit: 0x63c16384338cn },
          l2_gas: { max_amount: 0x20000000n, max_price_per_unit: 0x2cb417800n },
          l1_data_gas: { max_amount: 0x2000n, max_price_per_unit: 0x65b4d84987n },
        };

        const res = await declareAndDeployClawId({ account, resourceBounds });

        console.log(
          JSON.stringify(
            {
              network,
              contractAddress: res.contractAddress,
              classHash: res.classHash,
              declareTx: res.declareTx,
              deployTx: res.deployTx,
              explorer: voyagerContractUrl(network, res.contractAddress),
              declareExplorer: res.declareTx ? voyagerTxUrl(network, res.declareTx) : null,
              deployExplorer: voyagerTxUrl(network, res.deployTx),
            },
            jsonBigint,
            2
          )
        );
      })
  )
  .addCommand(
    new Command('register')
      .description('Register a .claw label (first-come-first-served)')
      .requiredOption('--name <label|label.claw>', 'Label to register')
      .option('--registry <address>', 'Registry contract address')
      .option('--to <address>', 'Address to set as resolver (default: your account)')
      .option('--metadata <string>', 'Metadata to store (default: empty)', '')
      .option('--network <sepolia|mainnet>', 'Network (default: sepolia)', 'sepolia')
      .action(async (opts) => {
        const env = getEnv();
        const account = makeAccount();
        const network = parseNetwork(String(opts.network));
        const registryAddress = String(opts.registry || DEFAULT_CLAWID_REGISTRY[network] || '');
        if (!registryAddress) throw new Error('Missing --registry (no default deployed registry for this network).');

        const to = String(opts.to || env.STARKNET_ACCOUNT_ADDRESS);
        const metadata = String(opts.metadata ?? '');

        const res = await registerClawName({
          account,
          registryAddress,
          label: String(opts.name),
          addr: to,
          metadata,
        });

        console.log(
          JSON.stringify(
            {
              network,
              registry: registryAddress,
              label: res.label,
              key: res.key,
              keyHex: num.toHex(res.key),
              owner: env.STARKNET_ACCOUNT_ADDRESS,
              addr: to,
              metadata,
              txHash: res.txHash,
              explorerUrl: voyagerTxUrl(network, res.txHash),
            },
            jsonBigint,
            2
          )
        );
      })
  )
  .addCommand(
    new Command('resolve')
      .description('Resolve a .claw label to an address')
      .requiredOption('--name <label|label.claw>', 'Label to resolve')
      .option('--registry <address>', 'Registry contract address')
      .option('--network <sepolia|mainnet>', 'Network (default: sepolia)', 'sepolia')
      .action(async (opts) => {
        const provider = makeProvider();
        const network = parseNetwork(String(opts.network));
        const registryAddress = String(opts.registry || DEFAULT_CLAWID_REGISTRY[network] || '');
        if (!registryAddress) throw new Error('Missing --registry (no default deployed registry for this network).');

        const res = await resolveClawName({
          provider,
          registryAddress,
          label: String(opts.name),
        });

        console.log(
          JSON.stringify(
            {
              network,
              registry: registryAddress,
              label: res.label,
              key: res.key,
              keyHex: num.toHex(res.key),
              addr: res.addr,
            },
            jsonBigint,
            2
          )
        );
      })
  )
  .addCommand(
    new Command('get')
      .description('Get a full .claw record')
      .requiredOption('--name <label|label.claw>', 'Label to look up')
      .option('--registry <address>', 'Registry contract address')
      .option('--network <sepolia|mainnet>', 'Network (default: sepolia)', 'sepolia')
      .action(async (opts) => {
        const provider = makeProvider();
        const network = parseNetwork(String(opts.network));
        const registryAddress = String(opts.registry || DEFAULT_CLAWID_REGISTRY[network] || '');
        if (!registryAddress) throw new Error('Missing --registry (no default deployed registry for this network).');

        const res = await getClawRecord({
          provider,
          registryAddress,
          label: String(opts.name),
        });

        console.log(
          JSON.stringify(
            {
              network,
              registry: registryAddress,
              label: res.label,
              key: res.key,
              keyHex: num.toHex(res.key),
              owner: res.owner,
              addr: res.addr,
              metadata: res.metadata,
            },
            jsonBigint,
            2
          )
        );
      })
  )
  .addCommand(
    new Command('set-metadata')
      .description('Update metadata for a .claw label (owner-only)')
      .requiredOption('--name <label|label.claw>', 'Label to update')
      .requiredOption('--metadata <string>', 'New metadata')
      .option('--registry <address>', 'Registry contract address')
      .option('--network <sepolia|mainnet>', 'Network (default: sepolia)', 'sepolia')
      .action(async (opts) => {
        const account = makeAccount();
        const network = parseNetwork(String(opts.network));
        const registryAddress = String(opts.registry || DEFAULT_CLAWID_REGISTRY[network] || '');
        if (!registryAddress) throw new Error('Missing --registry (no default deployed registry for this network).');

        const res = await setClawMetadata({
          account,
          registryAddress,
          label: String(opts.name),
          metadata: String(opts.metadata ?? ''),
        });

        console.log(
          JSON.stringify(
            {
              network,
              registry: registryAddress,
              label: res.label,
              key: res.key,
              keyHex: num.toHex(res.key),
              txHash: res.txHash,
              explorerUrl: voyagerTxUrl(network, res.txHash),
            },
            jsonBigint,
            2
          )
        );
      })
  )
  .addCommand(
    new Command('whoami')
      .description('Show your configured address and .claw name key')
      .option('--registry <address>', 'Registry contract address')
      .option('--network <sepolia|mainnet>', 'Network (default: sepolia)', 'sepolia')
      .action(async (opts) => {
        const env = getEnv();
        const provider = makeProvider();
        const network = parseNetwork(String(opts.network));
        const registryAddress = String(opts.registry || DEFAULT_CLAWID_REGISTRY[network] || '');
        if (!registryAddress) throw new Error('Missing --registry (no default deployed registry for this network).');

        const res = await nameOf({
          provider,
          registryAddress,
          ownerAddress: env.STARKNET_ACCOUNT_ADDRESS,
        });

        console.log(
          JSON.stringify(
            {
              network,
              registry: registryAddress,
              owner: env.STARKNET_ACCOUNT_ADDRESS,
              key: res.key,
              keyHex: num.toHex(res.key),
              hasName: res.key !== 0n,
              label: null,
              labelReversible: false,
            },
            jsonBigint,
            2
          )
        );
      })
  );

program
  .command('nft')
  .description('Deploy and manage demo ERC721 NFTs (Sepolia)')
  .addCommand(
    new Command('create')
      .description('Deploy a mintable ERC721 NFT collection')
      .requiredOption('--name <name>', 'Collection name, e.g. "Demo NFT"')
      .requiredOption('--symbol <symbol>', 'Collection symbol, e.g. DNFT')
      .option('--owner <address>', 'Owner/minter (default: your account)')
      .option('--network <sepolia|mainnet>', 'Network (default: sepolia)', 'sepolia')
      .action(async (opts) => {
        const env = getEnv();
        const account = makeAccount();
        const network = parseNetwork(String(opts.network));
        const owner = String(opts.owner || env.STARKNET_ACCOUNT_ADDRESS);

        const resourceBounds = {
          l1_gas: { max_amount: 0n, max_price_per_unit: 0x63c16384338cn },
          l2_gas: { max_amount: 0x20000000n, max_price_per_unit: 0x2cb417800n },
          l1_data_gas: { max_amount: 0x2000n, max_price_per_unit: 0x65b4d84987n },
        };

        const res = await declareAndDeployNft({
          account,
          name: String(opts.name),
          symbol: String(opts.symbol),
          owner,
          resourceBounds,
        });

        console.log(
          JSON.stringify(
            {
              network,
              name: String(opts.name),
              symbol: String(opts.symbol),
              owner,
              contractAddress: res.contractAddress,
              classHash: res.classHash,
              declareTx: res.declareTx,
              deployTx: res.deployTx,
              explorer: voyagerContractUrl(network, res.contractAddress),
            },
            null,
            2
          )
        );
      })
  )
  .addCommand(
    new Command('mint')
      .description('Mint an ERC721 token (owner-only)')
      .requiredOption('--contract <address>', 'ERC721 contract address')
      .requiredOption('--id <tokenId>', 'Token id (decimal or 0x...)')
      .option('--to <address>', 'Recipient address (default: your account)')
      .option('--entrypoint <name>', 'Entrypoint (default: mint)', 'mint')
      .option('--network <sepolia|mainnet>', 'Network (default: sepolia)', 'sepolia')
      .action(async (opts) => {
        const env = getEnv();
        const account = makeAccount();
        const network = parseNetwork(String(opts.network));
        const tokenIdParsed = parseU256(String(opts.id));
        const to = String(opts.to || env.STARKNET_ACCOUNT_ADDRESS);

        const res = await mintErc721({
          account,
          contractAddress: String(opts.contract),
          to,
          tokenId: tokenIdParsed.value,
          entrypoint: String(opts.entrypoint || 'mint'),
        });

        console.log(
          JSON.stringify(
            {
              network,
              contract: String(opts.contract),
              to,
              tokenId: tokenIdParsed.value.toString(),
              entrypoint: String(opts.entrypoint || 'mint'),
              txHash: res.txHash,
              explorerUrl: voyagerTxUrl(network, res.txHash),
            },
            null,
            2
          )
        );
      })
  )
  .addCommand(
    new Command('balance')
      .description('Check ERC721 balance_of for an owner (does not enumerate tokenIds)')
      .requiredOption('--contract <address>', 'ERC721 contract address')
      .option('--owner <address>', 'Owner address (default: your account)')
      .option('--entrypoint <name>', 'Entrypoint (default: balance_of)', 'balance_of')
      .option('--network <sepolia|mainnet>', 'Network (default: sepolia)', 'sepolia')
      .action(async (opts) => {
        const env = getEnv();
        const provider = makeProvider();
        const network = parseNetwork(String(opts.network));
        const owner = String(opts.owner || env.STARKNET_ACCOUNT_ADDRESS);

        const bal = await getErc721Balance({
          provider,
          contractAddress: String(opts.contract),
          owner,
          entrypoint: String(opts.entrypoint || 'balance_of'),
        });

        console.log(
          JSON.stringify(
            {
              network,
              contract: String(opts.contract),
              owner,
              balance: bal.toString(),
              hasAny: bal > 0n,
              entrypoint: String(opts.entrypoint || 'balance_of'),
            },
            null,
            2
          )
        );
      })
  );

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
