# claw-strk (skill)

A minimal Starknet Sepolia swap skill for agents, backed by the `claw-strk` CLI.

## Setup (one-time)

1) Install deps / build:

```bash
pnpm install
pnpm build
```

2) Configure env:

```bash
cp .env.example .env
# edit .env with:
# STARKNET_ACCOUNT_ADDRESS=
# STARKNET_PRIVATE_KEY=
# (optional) STARKNET_RPC_URL=
```

## Supported tokens (Sepolia)

```bash
claw-strk tokens
```

## Quote a swap

Quote selling 0.001 WBTC for USDC:

```bash
claw-strk quote --sell WBTC --buy USDC --amount 0.001
```

## Execute a swap

```bash
claw-strk swap --sell WBTC --buy USDC --amount 0.001 --slippage 0.5
```

Dry-run (no transaction):

```bash
claw-strk swap --sell WBTC --buy USDC --amount 0.001 --dry-run
```

## Check transaction status

```bash
claw-strk status --tx 0xYOUR_TX_HASH
```

## Notes / Safety

- This CLI uses AVNU’s Sepolia API (`https://sepolia.api.avnu.fi`) to route swaps.
- Your private key stays local in `.env`. Do not commit it.
- If you see no quotes, it usually means the route has no liquidity on testnet right now.
