import { z } from 'zod';
import dotenv from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function getEnvArgvPath(): string | null {
  const argv = process.argv;
  const idx = argv.findIndex((a) => a === '--env');
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];

  const eq = argv.find((a) => a.startsWith('--env='));
  if (eq) return eq.slice('--env='.length);

  return null;
}

function loadDotEnvOnce() {
  // 1) explicit --env
  const explicit = getEnvArgvPath();
  if (explicit) {
    dotenv.config({ path: explicit });
    return;
  }

  // 2) local .env (dev convenience)
  const local = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(local)) {
    dotenv.config({ path: local });
    return;
  }

  // 3) global default for npm-installed CLI
  const global = path.join(os.homedir(), '.claw-strk', '.env');
  if (fs.existsSync(global)) {
    dotenv.config({ path: global });
    return;
  }
}

loadDotEnvOnce();

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
    throw new Error(
      `Invalid env: ${parsed.error.message}\n\n` +
        `Expected env file at one of:\n` +
        `  - --env <path>\n` +
        `  - ${path.resolve(process.cwd(), '.env')}\n` +
        `  - ${path.join(os.homedir(), '.claw-strk', '.env')}\n`
    );
  }
  return parsed.data;
}
