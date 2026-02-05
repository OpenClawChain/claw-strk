# claw-strk (skill)

Swap tokens on **Starknet Sepolia testnet** using **AVNU** routing via the `claw-strk` CLI.

This is a *single-repo* CLI project (not a monorepo).

---

## What this CLI does

- Fetches swap quotes from **AVNU Sepolia API**: `https://sepolia.api.avnu.fi`
- Executes swaps on **Starknet Sepolia** by signing transactions with your local key
- Can check transaction receipts
- Can print balances for supported tokens

---

## Requirements

- Node.js + pnpm
- A funded Starknet Sepolia account:
  - You need **Sepolia ETH on Starknet** for gas (and first-time account deployment)
  - You need some of the token you want to sell (e.g. STRK)

---

## Setup (one-time)

From the repo root:

```bash
pnpm install
pnpm build
```

Create `.env`:

```bash
cp .env.example .env
```

Fill in:

```bash
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...
# optional; defaults to a public Sepolia RPC
STARKNET_RPC_URL=https://starknet-sepolia-rpc.publicnode.com
```

Safety:
- `.env` is gitignored. **Do not paste private keys into chat.**

---

## List supported tokens

```bash
pnpm dev tokens
```

(Or after build/install globally: `claw-strk tokens`.)

---

## Starknet ID (StarknetID)

This CLI includes basic Starknet ID helpers so an agent can associate itself with a `.stark` name.

### Check your current Starknet ID name

```bash
pnpm dev starkid whoami
```

### Resolve a name to an address

```bash
pnpm dev starkid resolve --name someone.stark
```

### Register a name (onchain)

**Warning:** registering a `.stark` name costs gas and may require ETH payment/approval flows.

Start with a dry-run (no tx sent):

```bash
pnpm dev starkid register --name myagent.stark --days 365
```

To actually send the tx (spends gas):

```bash
pnpm dev starkid register --name myagent.stark --days 365 --send
```

## Check balances

Show balances for *all* supported tokens for your configured account:

```bash
pnpm dev balance
```

Show balances for specific tokens:

```bash
pnpm dev balance --token ETH STRK USDC USDT WBTC wstETH EKUBO
```

---

## Quote a swap

Example: quote **STRK → USDC** selling `1` STRK:

```bash
pnpm dev quote --sell STRK --buy USDC --amount 1
```

Example: quote **STRK → ETH**:

```bash
pnpm dev quote --sell STRK --buy ETH --amount 1
```

If you see `No quotes returned`, it usually means **no route/liquidity** is available on Sepolia for that pair.

---

## Execute a swap

Example: swap **STRK → USDC** (real tx):

```bash
pnpm dev swap --sell STRK --buy USDC --amount 1 --slippage 0.5
```

Dry-run (no transaction, just prints the best quote):

```bash
pnpm dev swap --sell STRK --buy USDC --amount 1 --slippage 0.5 --dry-run
```

Notes:
- `--slippage` is a percent (e.g. `0.5` = 0.5%).
- Each swap costs gas. Use small amounts on testnet.

---

## Check transaction status

```bash
pnpm dev status --tx 0xYOUR_TX_HASH
```

---

## Explorer (Voyager)

Starknet Sepolia Voyager:
- Account/contract: `https://sepolia.voyager.online/contract/<ACCOUNT_ADDRESS>`
- Tx: `https://sepolia.voyager.online/tx/<TX_HASH>`

---

## Troubleshooting

### RPC errors / provider down

If the default RPC is flaky, set your own:

```bash
STARKNET_RPC_URL=...your_rpc...
```

### “Contract not found” for your account

That usually means the account is **not deployed yet**. You must deploy the account contract once (costs ETH) before swaps can be executed.

### “No quotes returned”

No AVNU route exists on Sepolia for that pair right now.

---

## Security

- Private keys must remain local.
- Prefer creating a throwaway test account for demos.
- Never commit `.env`.
