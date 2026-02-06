# claw-strk — Starknet Sepolia CLI (swap + x402 + lending)

This file documents the **hardcoded addresses** and the **deployed contract addresses** currently used by the `claw-strk` CLI so other agents can reproduce testing.

> Network focus: **Starknet Sepolia** (`starknet-sepolia`)

---

## 0) Safety / operational notes

- **Do not share private keys**.
- The CLI reads `STARKNET_ACCOUNT_ADDRESS`, `STARKNET_PRIVATE_KEY`, and `STARKNET_RPC_URL` from env (see below).
- On Sepolia, liquidity can be thin; swaps may fail with `Insufficient tokens received`. Increase `--slippage` if needed.

---

## 1) Env + RPC

### Env file locations
The CLI loads env in this order:
1) `--env <path>`
2) `./.env` (current working directory)
3) `~/.claw-strk/.env`

### RPC URLs used
- Primary (worked for deploy + swaps):
  - `https://starknet-sepolia.g.alchemy.com/v2/a0CQ0YnVGtptgWQBGvSXW`
- Alternate (suggested fallback):
  - `https://starknet-sepolia.drpc.org`

---

## 2) Test account (Sepolia)

Account used during testing/deploys:
- `0x36b94de808696639aa4cb95b2670fa41b5381ed4e77da94d61e5923bcac1ca7`

---

## 3) Token addresses (Starknet Sepolia)

These are the **bridged token addresses** used in the CLI (`src/tokens.ts`).

### 3.1 Known working swap pairs (observed)

Observed working swaps via `claw-strk quote`/`claw-strk swap` (AVNU, Sepolia):

- ✅ `STRK → USDC` (works, but output is tiny; may require higher `--slippage`)
- ✅ `STRK → ETH`
- ✅ `STRK → EKUBO` (worked in earlier Sepolia testing)

Observed non-working / no-route (during testing):

- ❌ `STRK → WBTC` ("No quotes returned")
- ❌ `ETH → WBTC` ("No quotes returned")

Notes:
- Common failure mode: `Insufficient tokens received` on swap simulation. Fix: increase `--slippage` (we used 5–8%).

- **STRK**
  - `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
- **ETH**
  - `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7`
- **USDC**
  - `0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080`
- **WBTC**
  - `0x00452bd5c0512a61df7c7be8cfea5e4f893cb40e126bdc40aee6054db955129e`
- **USDT**
  - `0x02ab8758891e84b968ff11361789070c6b1af2df618d6d2f4a78b0757573c6eb`
- **wstETH**
  - `0x030de54c07e57818ae4a1210f2a3018a0b9521b8f8ae5206605684741650ac25`
- **EKUBO**
  - `0x01fad7c03b2ea7fbef306764e20977f8d4eae6191b3a54e4514cc5fc9d19e569`

---

## 4) Lending contracts (deployed on Starknet Sepolia)

> Contracts source code has been split out to: https://github.com/OpenClawChain/claw-strk-contracts

### Public demo pool (recommended)

The CLI ships with a built-in default demo pool id:
- **poolId:** `strk-usdc`

List pools:
- `claw-strk lend pools`

Use a pool explicitly:
- `claw-strk lend pool --pool-id strk-usdc`
- `claw-strk lend demo --pool-id strk-usdc`

The lending MVP has two contracts:
- `ClawLendRegistry` — registry of pools
- `ClawLendPool` — simple pool with:
  - collateral token
  - borrow token
  - fixed 60% LTV
  - owner-set price (`price_e6`)

### 4.1 STRK collateral / USDC borrow (recommended test pool)
This is the currently active pool saved in:
- `~/.claw-strk/lend.starknet-sepolia.json`

Addresses:
- Registry: `0x183ca728ea9432536ce728416dcb3126373f18a2e5cd46327a90dc2f1f93e15`
  - deploy tx: `0x59f7d9d7d06b871d1ec6cfe7b7f29bc9b055006af5be0c74bfecb5d2be6fbfb`
- Pool: `0x04bdad5b68e73eaa8784a488f02b6ead417a4e5c0472566027908149f115979b`
  - deploy tx: `0x6bb3b5a4c3f3914a6915933c8148e7404bd0e01ef6f2042c028a128984ea094`
- Registry add_pool tx: `0x41f067e60d720333fbe45432e7d4e1e7082c210990dd3b0be453f56971d8ace`

Voyager:
- Pool: https://sepolia.voyager.online/contract/0x4bdad5b68e73eaa8784a488f02b6ead417a4e5c0472566027908149f115979b
- Registry: https://sepolia.voyager.online/contract/0x183ca728ea9432536ce728416dcb3126373f18a2e5cd46327a90dc2f1f93e15

Initial price used for testing:
- `price_e6 = 1_000_000` (interpreted as **1 borrow token per 1 collateral**, purely for demo math)

### 4.2 WBTC collateral / USDC borrow (earlier deployed pool)
Addresses:
- Registry: `0x71a9079d3deb6a684a0fbfb22cc751ccca69b0626d448d4d5484484b8afa844`
  - deploy tx: `0x1bdb7d17b997db2edd84401a41d8d748bbc2d736f924b596281066d4de19e69`
- Pool: `0x033157d8713a792fbe6828c85021f8dbb5d5c2da714a411ce962319c95b01f32`
  - deploy tx: `0x6a6fea472b704ee75aa3c163655ecc872fe1f6a28c0225f5bffb11fb42a29d2`
- Registry add_pool tx: `0x1f530adc04086ad095463c88b787de8adc6bfe5b9edd4d61f43c70bbeba3a37`

Voyager:
- Pool: https://sepolia.voyager.online/contract/0x33157d8713a792fbe6828c85021f8dbb5d5c2da714a411ce962319c95b01f32
- Registry: https://sepolia.voyager.online/contract/0x71a9079d3deb6a684a0fbfb22cc751ccca69b0626d448d4d5484484b8afa844

Initial price used:
- `price_e6 = 43_000 * 1e6` (i.e. 43,000 USDC per 1 WBTC)

---

## 5) NFT contracts (deployed on Starknet Sepolia)

### OpenClawMinion (CLAWSTRK)
- Contract: `0x49782e9d0ce5eb2b1122fdb6de8498a6717389a8ce73768d69c3995c72d1ecd`
- Class hash: `0x419394bce0dbc1d5c5d465add3bc5f3be06c7f7dc46923c6b12b726f5e96903`
- Deploy tx: `0x191cca18b85ea97ce811ac0b46aa429b86475fa6c5b5c590af33fffb24ba4f5`
- Explorer: https://sepolia.voyager.online/contract/0x49782e9d0ce5eb2b1122fdb6de8498a6717389a8ce73768d69c3995c72d1ecd

Mint test (tokenId=1) → test account:
- Mint tx: `0x1b5dff6aa01e073d4b2cfbf4a6a0a2e2162ad5211f6cc9caa1d470a53d568fb`
- Explorer: https://sepolia.voyager.online/tx/0x1b5dff6aa01e073d4b2cfbf4a6a0a2e2162ad5211f6cc9caa1d470a53d568fb

Commands:
- Create collection:
  - `claw-strk nft create --name "OpenClawMinion" --symbol "CLAWSTRK" --network sepolia`
- Mint:
  - `claw-strk nft mint --contract 0x49782e9d0ce5eb2b1122fdb6de8498a6717389a8ce73768d69c3995c72d1ecd --id 1 --network sepolia`
- Check ownership (balance_of):
  - `claw-strk nft balance --contract 0x49782e9d0ce5eb2b1122fdb6de8498a6717389a8ce73768d69c3995c72d1ecd`
  - or for another address:
    - `claw-strk nft balance --contract 0x49782e9d0ce5eb2b1122fdb6de8498a6717389a8ce73768d69c3995c72d1ecd --owner 0x...`

---

## 6) .claw registry (ClawIdRegistry)

### Sepolia deployment (active)
- Registry contract: `0x18fe5d665fe78d1e9032d85c5e3fd6f99492a608d197f4cb048a2246f7d68eb`
- Class hash: `0x35bd1d6ef69482c6c3c7a6eaafa8d0de60b1dcce486392329763fec584ea3cc`
- Declare tx: `0x798fd0f400b2c5780d3071106a4e28a317cf66dde4feb3a5587a0c565177292`
- Deploy tx: `0x14d89e36ada0bef935b8870b8b6e78853f07d04ddec23c3d900c343970e47a1`
- Explorer: https://sepolia.voyager.online/contract/0x18fe5d665fe78d1e9032d85c5e3fd6f99492a608d197f4cb048a2246f7d68eb

Default registry constant was updated in:
- `src/clawid.ts` → `DEFAULT_CLAWID_REGISTRY['starknet-sepolia']`

### Test claim
Claimed `openclawchain.claw` → test account:
- Register tx: `0x23f4c8714372347abde8a14cd9bd28d870031effabc58d16196d3dba4099dff`
- Explorer: https://sepolia.voyager.online/tx/0x23f4c8714372347abde8a14cd9bd28d870031effabc58d16196d3dba4099dff

Commands:
- Deploy (only needed if redeploying):
  - `claw-strk claw deploy --network sepolia`
- Register:
  - `claw-strk claw register --name openclawchain.claw --metadata '{"name":"OpenClawChain"}' --network sepolia`
- Resolve:
  - `claw-strk claw resolve --name openclawchain --network sepolia`
- Get full record:
  - `claw-strk claw get --name openclawchain --network sepolia`
- Whoami:
  - `claw-strk claw whoami --network sepolia`
- Set metadata (owner-only):
  - `claw-strk claw set-metadata --name openclawchain --metadata '{"hello":"world"}' --network sepolia`

---

## 7) CLI commands (concise usage)

### Demo token commands (Sepolia ERC20)

Create a token (choose `fixed` or `mintable`):
- `claw-strk token create --kind fixed --name "Fixed Token" --symbol FIX --decimals 6 --initial 1000`
- `claw-strk token create --kind mintable --name "Mint Token" --symbol MNT --decimals 6 --initial 0`

Mint more (mintable only; owner-only):
- `claw-strk token mint --token <address> --to <address> --amount 1000 --decimals 6`

Notes:
- `fixed` tokens have no `mint()` entrypoint (supply is set at deploy).
- `mintable` tokens expose `mint(recipient, amount)` restricted to `owner`.


### Swap (AVNU)
- Quote:
  - `claw-strk quote --sell <SYMBOL> --buy <SYMBOL> --amount <HUMAN>`
- Swap:
  - `claw-strk swap --sell <SYMBOL> --buy <SYMBOL> --amount <HUMAN> [--slippage <pct>]`

Examples:
- Quote 50 STRK → USDC:
  - `claw-strk quote --sell STRK --buy USDC --amount 50`
- Swap 50 STRK → USDC (5% slippage):
  - `claw-strk swap --sell STRK --buy USDC --amount 50 --slippage 5`

### Lending (public demo pool)

List available built-in demo pools:
- `claw-strk lend pools`

Use the canonical demo pool id explicitly (optional; default is `strk-usdc`):
- `--pool-id strk-usdc`

Core commands:
- Show pool (reserves + price):
  - `claw-strk lend pool [--pool-id strk-usdc]`
- Show account position:
  - `claw-strk lend account [--pool-id strk-usdc]`
- Deposit collateral (STRK):
  - `claw-strk lend deposit --amount 1 [--pool-id strk-usdc]`
- Borrow USDC:
  - `claw-strk lend borrow --amount 0.005 [--pool-id strk-usdc]`
  - or safe borrow:
    - `claw-strk lend borrow --max --cap 0.005 [--pool-id strk-usdc]`
- Repay USDC:
  - `claw-strk lend repay --amount 0.005 [--pool-id strk-usdc]`
- Withdraw collateral (STRK):
  - `claw-strk lend withdraw --amount 1 [--pool-id strk-usdc]`

Demo command (recommended for new users):
- `claw-strk lend demo [--pool-id strk-usdc]`

Maintainer command (to keep pool liquid):
- Fund pool with borrow token (USDC):
  - `claw-strk lend fund --amount 0.01 [--pool-id strk-usdc]`

Advanced (optional): deploy your own pool:
- `claw-strk lend init --network starknet-sepolia --force`
- `claw-strk lend init --network starknet-sepolia --collateral STRK --borrow USDC --price 1 --force`

---

## 6) Example runs (Sepolia)

### Swap examples
- Swap 50 STRK → USDC:
  - tx: `0x21291efd1ee8f9502799d30eb20e6ec4194fab32c108659936007900e7ffc1d`
- Swap 100 STRK → USDC:
  - tx: `0x3d175bd655dad51fb16ac3062a1b30ba8a9d8f463fef216b42b9e060d871d6f`

### Lending examples (STRK collateral / USDC borrow pool)
Pool:
- `0x04bdad5b68e73eaa8784a488f02b6ead417a4e5c0472566027908149f115979b`

Actions:
- Fund pool with 0.06 USDC:
  - tx: `0x184faec234dae92fb192a6736ca1e2f0ad845496877861e4abd2e7947ffb30e`
- Deposit 10 STRK:
  - tx: `0x2a14a0e7228ba0419ce63a91848e93d7c00d73f763514a134369be3e10378be`
- Borrow 0.02 USDC:
  - tx: `0x24ccd4c2c17bd3ac63cc17a30cfc3fe27381d047f21fdda065bcc4f68975ba1`
- Repay 0.02 USDC:
  - tx: `0x2edf9ea8dca09748c19485422d33bc5190243f04ead95f9180d9988425f6e0c`
- Withdraw 1 STRK:
  - tx: `0x1684c0832ae9cb506a1cc4f9047a1f135166ad54425dd1903873d22e9355714`

### Tiny demo (recommended for new users)
- Deposit 1 STRK
- Borrow 0.005 USDC
- Repay 0.005 USDC

Commands:
- `claw-strk lend deposit --amount 1`
- `claw-strk lend borrow --amount 0.005`
- `claw-strk lend repay --amount 0.005`

Or use:
- `claw-strk lend demo`

(Use `claw-strk status --tx <hash>` and Voyager links to inspect receipts.)

---

## 7) x402 (paywalled HTTP + facilitator)

The CLI has a command group for x402 client-side payments:

- `claw-strk x402 pay`
- `claw-strk x402 approve`
- `claw-strk x402 request`

### Default facilitator endpoint (Sepolia)

As of PR #3, `claw-strk x402 request` defaults to using the hosted facilitator for Sepolia:

- Facilitator base: `https://stark-facilitator.openclawchain.org/api/facilitator`

You can override it per call:

- `--facilitator <url>`

### Hosted paywall resource server

The same host also serves the paywalled resource endpoints:

- Paywalled base: `https://stark-facilitator.openclawchain.org/api/protected`
- Example paywalled route: `GET https://stark-facilitator.openclawchain.org/api/protected/chainstatus`

### Example usage

One-time: approve the facilitator/spender to settle ERC20 transfers on your behalf (pick token + amount):

- `claw-strk x402 approve --token USDC --spender <FACILITATOR_SPENDER_ADDRESS> --amount 1`

Then request a paywalled resource (auto-pay on 402):

- `claw-strk x402 request --url https://stark-facilitator.openclawchain.org/api/protected/chainstatus --network sepolia`

If you want to use a custom facilitator:

- `claw-strk x402 request --url <resource-url> --facilitator <facilitator-base-url> --network sepolia`

---

## 8) Known gotchas

- **WBTC swaps on Sepolia**: AVNU returned **no quotes** into WBTC during testing, so WBTC collateral testing was blocked.
- **USDC on Sepolia**: swap outputs can be extremely small; you may need to fund the pool with small amounts and keep borrow tests tiny.
- **Decimals**:
  - STRK uses **18 decimals**; USDC uses **6 decimals**.
  - Older CLI output labels still say `collateralWbtc_1e8` in some places; interpret as raw collateral amount (will be cleaned up).
