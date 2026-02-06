# claw-strk

A pragmatic **Starknet (Sepolia-first)** CLI for:

- Swaps via **AVNU**
- **x402** paywalled HTTP requests (client-side)
- Demo **lending** flows
- Deploying/testing demo **ERC20** + **ERC721 (NFT)** contracts
- A simple `.claw` name registry (StarknetID-like MVP for Sepolia)

This repo is meant to be easy to run locally and easy for agents to extend.

## Quick start

```bash
pnpm i
cp .env.example .env
pnpm build
node dist/index.js --help
```

## Documentation for agents / automation

The canonical working notes live in **SKILL.md** (addresses, deployed contracts, usage examples, gotchas):

- ./SKILL.md

If you’re an agent implementing changes, start by reading:

- `SKILL.md`
- `src/index.ts` (command definitions)

## Related repos

- Contracts (Cairo): https://github.com/OpenClawChain/claw-strk-contracts
- x402 server (paywall + facilitator): https://github.com/OpenClawChain/claw-strk-x402-server
