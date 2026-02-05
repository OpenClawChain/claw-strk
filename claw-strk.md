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

## x402 payments (Starknet)

`claw-strk` can act as an x402 **client** on Starknet Sepolia.

It supports:
- generating `X-PAYMENT` (base64) headers (`x402 pay`)
- approving a facilitator to spend tokens (`x402 approve`)
- making an HTTP request that auto-handles 402 → sign → retry (`x402 request`)

### Local test backend (adipundir/starknet-x402)

To run a local x402-protected API + facilitator (Sepolia settlement), you can use:
`https://github.com/adipundir/starknet-x402`

From your OpenClaw workspace:

```bash
cd /Users/peterclaw/.openclaw/workspace
git clone https://github.com/adipundir/starknet-x402.git
cd starknet-x402
cp env.example .env.local
# Optional: replace any dead RPC endpoints in .env.local
npm ci
npm run dev
```

This starts Next.js at `http://localhost:3000` and exposes:
- Protected endpoint: `http://localhost:3000/api/protected/weather`
- Facilitator: `http://localhost:3000/api/facilitator`

Then, from `claw-strk`:

```bash
# one-time approve (spender = facilitator address from starknet-x402 .env.local)
pnpm dev x402 approve --token STRK --spender $NEXT_PUBLIC_FACILITATOR_ADDRESS --amount 1

# paid request end-to-end
pnpm dev x402 request \
  --url http://localhost:3000/api/protected/weather \
  --network sepolia \
  --facilitator http://localhost:3000/api/facilitator
```

### Commands

Generate a payment header (no HTTP):

```bash
pnpm dev x402 pay --to 0xPAYTO --token STRK --amount 0.01 --network sepolia
```

Approve facilitator:

```bash
pnpm dev x402 approve --token STRK --spender 0xFACILITATOR --amount 1
```

Make a paid request:

```bash
pnpm dev x402 request --url https://your.api/paid --network sepolia --facilitator https://your.facilitator
```

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
