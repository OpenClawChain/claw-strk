import { z } from 'zod';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type StarknetLendNetwork = 'starknet-sepolia' | 'starknet-mainnet';

export const LendConfigSchema = z.object({
  network: z.enum(['starknet-sepolia', 'starknet-mainnet']).default('starknet-sepolia'),

  // Deployed contract addresses (filled after `claw-strk lend init`)
  registryAddress: z.string().optional(),
  poolAddress: z.string().optional(),

  // Assets
  collateralToken: z.string(),
  borrowToken: z.string(),

  // Optional cached metadata
  poolId: z.string().optional(),
  collateralSymbol: z.string().optional(),
  borrowSymbol: z.string().optional(),

  wbtcDecimals: z.number().int().positive().optional(),
  usdcDecimals: z.number().int().positive().optional(),
});

export type LendConfig = z.infer<typeof LendConfigSchema>;

export const DEFAULT_LEND_CONFIG: LendConfig = {
  network: 'starknet-sepolia',
  // Sepolia addresses (from starknet-addresses bridged_tokens/sepolia.json)
  collateralToken:
    '0x00452bd5c0512a61df7c7be8cfea5e4f893cb40e126bdc40aee6054db955129e', // WBTC
  borrowToken:
    '0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080', // USDC
  poolId: 'wbtc-usdc',
  collateralSymbol: 'WBTC',
  borrowSymbol: 'USDC',
  wbtcDecimals: 8,
  usdcDecimals: 6,
};

function configPathFor(network: StarknetLendNetwork) {
  return path.join(os.homedir(), '.claw-strk', `lend.${network}.json`);
}

export function loadLendConfig(network: StarknetLendNetwork): LendConfig {
  const p = configPathFor(network);
  if (!fs.existsSync(p)) return { ...DEFAULT_LEND_CONFIG, network };
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const parsed = LendConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid lend config at ${p}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function saveLendConfig(cfg: LendConfig) {
  const p = configPathFor(cfg.network);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
  return p;
}

export function voyagerTxUrl(network: StarknetLendNetwork, txHash: string) {
  const base = network === 'starknet-mainnet' ? 'https://voyager.online' : 'https://sepolia.voyager.online';
  return `${base}/tx/${txHash}`;
}

export function voyagerContractUrl(network: StarknetLendNetwork, addr: string) {
  const base = network === 'starknet-mainnet' ? 'https://voyager.online' : 'https://sepolia.voyager.online';
  return `${base}/contract/${addr}`;
}

export type DemoPool = {
  poolId: string;
  network: StarknetLendNetwork;
  poolAddress: string;
  registryAddress?: string;
  collateralSymbol: string;
  collateralToken: string;
  collateralDecimals: number;
  borrowSymbol: string;
  borrowToken: string;
  borrowDecimals: number;
};

// Canonical public demo pools that ship with the CLI.
export const DEMO_POOLS: DemoPool[] = [
  {
    poolId: 'strk-usdc',
    network: 'starknet-sepolia',
    // STRK collateral / USDC borrow pool (deployed during Feb 2026 testing)
    poolAddress: '0x04bdad5b68e73eaa8784a488f02b6ead417a4e5c0472566027908149f115979b',
    registryAddress: '0x183ca728ea9432536ce728416dcb3126373f18a2e5cd46327a90dc2f1f93e15',
    collateralSymbol: 'STRK',
    collateralToken: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    collateralDecimals: 18,
    borrowSymbol: 'USDC',
    borrowToken: '0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080',
    borrowDecimals: 6,
  },
];

export function findDemoPool(args: { network: StarknetLendNetwork; poolId: string }): DemoPool | null {
  const id = args.poolId.trim().toLowerCase();
  return (
    DEMO_POOLS.find((p) => p.network === args.network && p.poolId.toLowerCase() === id) ?? null
  );
}
