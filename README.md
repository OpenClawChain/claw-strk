# claw-strk (Starknet Sepolia prototype)

`claw-strk` is a **Sepolia-first** Starknet CLI for quickly testing:

- Swaps via **AVNU**
- Demo **lending** pool flows
- **x402** paywalled HTTP requests (client-side)
- Deploy/test demo **ERC20** + **ERC721 (NFT)** contracts
- A simple `.claw` name registry (StarknetID-like MVP for Sepolia)

> This is prototype tooling for **Starknet Sepolia**.

---

## 1) Install

Once published:

```bash
pnpm add -g @openclawchain/claw-strk
# or
npm i -g @openclawchain/claw-strk
```

Run:

```bash
claw-strk --help
```

---

## 2) Configure (.env)

The CLI loads env in this order:

1) `--env <path>`
2) `./.env`
3) `~/.claw-strk/.env`

Minimum required:

```env
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...
STARKNET_RPC_URL=https://starknet-sepolia.g.alchemy.com/v2/<key>
```

Create a template:

```bash
claw-strk init
```

---

## 3) CLI examples (mandatory features)

### A) Swap (AVNU)

Quote:
```bash
claw-strk quote --sell STRK --buy USDC --amount 1
```

Swap:
```bash
claw-strk swap --sell STRK --buy USDC --amount 1 --slippage 5
```

### B) Lending

List demo pools:
```bash
claw-strk lend pools
```

Run the demo (deposit/borrow/repay/withdraw):
```bash
claw-strk lend demo
```

### C) x402 payment (paywalled HTTP)

Paywall endpoint example:
```bash
claw-strk x402 request \
  --url https://stark-facilitator.openclawchain.org/api/protected/chainstatus \
  --network sepolia \
  --auto-approve
```

Notes:
- `--auto-approve` will approve **exactly** `maxAmountRequired` to the spender (one-time per amount).
- Override spender/facilitator if needed:

```bash
claw-strk x402 request \
  --url <resource-url> \
  --facilitator <facilitator-base-url> \
  --spender <spender-address> \
  --auto-approve
```

### D) `.claw` domain

Register:
```bash
claw-strk claw register --name bobio.claw --metadata '{"owner":"bobio"}' --network sepolia
```

Resolve:
```bash
claw-strk claw resolve --name bobio.claw --network sepolia
```

Get full record:
```bash
claw-strk claw get --name bobio.claw --network sepolia
```

### E) ERC20 demo token

Create:
```bash
claw-strk token create --kind mintable --name "Mint Token" --symbol MNT --decimals 6 --initial 0
```

Mint (owner-only):
```bash
claw-strk token mint --token <address> --to <address> --amount 100 --decimals 6
```

### F) NFT (ERC721)

Create collection:
```bash
claw-strk nft create --name "OpenClawMinion" --symbol "CLAW" --network sepolia
```

Mint:
```bash
claw-strk nft mint --contract <address> --id 1 --network sepolia
```

Check ownership (ERC721 `balance_of`):
```bash
claw-strk nft balance --contract <address>
```

---

## 4) References

### 4.1 Supported tokens (swap)

Starknet Sepolia bridged token addresses:

- STRK: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
- ETH:  `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7`
- USDC: `0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080`
- USDT: `0x02ab8758891e84b968ff11361789070c6b1af2df618d6d2f4a78b0757573c6eb`
- WBTC: `0x00452bd5c0512a61df7c7be8cfea5e4f893cb40e126bdc40aee6054db955129e`
- wstETH: `0x030de54c07e57818ae4a1210f2a3018a0b9521b8f8ae5206605684741650ac25`
- EKUBO: `0x01fad7c03b2ea7fbef306764e20977f8d4eae6191b3a54e4514cc5fc9d19e569`

### 4.2 x402 default server (Sepolia)

- Facilitator base: `https://stark-facilitator.openclawchain.org/api/facilitator`
- Paywalled base: `https://stark-facilitator.openclawchain.org/api/protected`
- Example resource: `GET /chainstatus`
- Default spender (facilitator account):
  - `0x04dA15eb06D6D01C4907eb4876Cc29BdeF21A84bD71fB34d0369c83b8744D104`

### 4.3 Lending demo pool (Sepolia)

Pool id: `strk-usdc`

- Registry: `0x183ca728ea9432536ce728416dcb3126373f18a2e5cd46327a90dc2f1f93e15`
- Pool: `0x04bdad5b68e73eaa8784a488f02b6ead417a4e5c0472566027908149f115979b`

### 4.4 Deployed contracts (Sepolia)

| Feature | Contract | Address |
|---|---|---|
| NFT collection (OpenClawMinion / CLAWSTRK) | MintableERC721 | `0x49782e9d0ce5eb2b1122fdb6de8498a6717389a8ce73768d69c3995c72d1ecd` |
| `.claw` registry | ClawIdRegistry | `0x18fe5d665fe78d1e9032d85c5e3fd6f99492a608d197f4cb048a2246f7d68eb` |

Repo references:
- Contracts source (Cairo): https://github.com/OpenClawChain/claw-strk-contracts
- x402 server: https://github.com/OpenClawChain/claw-strk-x402-server
