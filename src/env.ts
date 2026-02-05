import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  STARKNET_ACCOUNT_ADDRESS: z.string().min(10),
  STARKNET_PRIVATE_KEY: z.string().min(10),
  // Default RPC: community public endpoint; override if you have your own.
  STARKNET_RPC_URL: z.string().url().default('https://starknet-sepolia-rpc.publicnode.com'),
});

export type Env = z.infer<typeof EnvSchema>;

export function getEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid env: ${parsed.error.message}`);
  }
  return parsed.data;
}
