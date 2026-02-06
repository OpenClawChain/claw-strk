import fs from 'node:fs';
import path from 'node:path';
import { Account, CallData, Contract, byteArray, hash, num } from 'starknet';

export type ClawIdNetwork = 'starknet-sepolia' | 'starknet-mainnet';

export const DEFAULT_CLAWID_REGISTRY: Record<ClawIdNetwork, string | null> = {
  // Deployed by OpenClaw on 2026-02-06
  'starknet-sepolia': '0x18fe5d665fe78d1e9032d85c5e3fd6f99492a608d197f4cb048a2246f7d68eb',
  'starknet-mainnet': null,
};

export function normalizeLabel(label: string): string {
  const raw = String(label ?? '').trim().toLowerCase();
  if (!raw) throw new Error('Name label is required');
  const s = raw.endsWith('.claw') ? raw.slice(0, -'.claw'.length) : raw;
  if (s.length < 1 || s.length > 32) throw new Error('Label must be 1..32 chars');
  if (!/^[a-z0-9-]+$/.test(s)) throw new Error('Label must match [a-z0-9-]');
  return s;
}

// Key derivation must match the Cairo contract: Pedersen hash over UTF-8 bytes.
export function nameKey(label: string): bigint {
  const normalized = normalizeLabel(label);
  const bytes = new TextEncoder().encode(normalized);
  let acc = 0n;
  for (const b of bytes) acc = num.toBigInt(hash.computePedersenHash(acc, BigInt(b)));
  return acc;
}

export function loadClawIdArtifacts() {
  const base = path.resolve(process.cwd(), 'assets', 'clawid');
  const contract = JSON.parse(fs.readFileSync(path.join(base, 'ClawIdRegistry.contract_class.json'), 'utf8'));
  const casm = JSON.parse(fs.readFileSync(path.join(base, 'ClawIdRegistry.compiled_contract_class.json'), 'utf8'));
  return { contract, casm, abi: contract.abi } as const;
}

export function getClawIdContract(args: {
  registryAddress: string;
  providerOrAccount: any;
}) {
  const { abi } = loadClawIdArtifacts();
  return new Contract({ abi, address: args.registryAddress, providerOrAccount: args.providerOrAccount });
}

export async function declareAndDeployClawId(args: {
  account: Account;
  resourceBounds?: any;
  waitSeconds?: number;
}) {
  const { contract, casm } = loadClawIdArtifacts();
  const waitSeconds = args.waitSeconds ?? 120;

  async function waitTx(txHash: string) {
    const timeout = new Promise((_r, rej) =>
      setTimeout(() => rej(new Error(`Timeout waiting for tx ${txHash}`)), waitSeconds * 1000)
    );
    return Promise.race([args.account.waitForTransaction(txHash), timeout]);
  }

  const declare: any = await (args.account as any).declareIfNot({ contract, casm }, { resourceBounds: args.resourceBounds } as any);
  const declareTx = declare.transaction_hash;
  const classHash = declare.class_hash;
  if (declareTx && declareTx !== '0x0' && declareTx !== '') await waitTx(declareTx);

  const deploy: any = await (args.account as any).deployContract(
    { classHash, constructorCalldata: [] },
    { resourceBounds: args.resourceBounds } as any,
  );

  const deployTx = deploy.transaction_hash ?? deploy.transactionHash;
  const contractAddress =
    deploy.contract_address ?? deploy.contractAddress ?? deploy.address ?? deploy.deployedContractAddress;

  if (!deployTx) throw new Error(`deployContract returned no tx hash: ${JSON.stringify(deploy)}`);
  if (!contractAddress) throw new Error(`deployContract returned no contract address: ${JSON.stringify(deploy)}`);

  await waitTx(deployTx);

  return { classHash, declareTx, deployTx, contractAddress };
}

export async function registerClawName(args: {
  account: Account;
  registryAddress: string;
  label: string;
  addr: string;
  metadata: string;
}) {
  const normalized = normalizeLabel(args.label);
  const calldata = CallData.compile({
    label: byteArray.byteArrayFromString(normalized),
    addr: args.addr,
    metadata: byteArray.byteArrayFromString(args.metadata ?? ''),
  });

  const res: any = await args.account.execute({
    contractAddress: args.registryAddress,
    entrypoint: 'register',
    calldata,
  } as any);

  return {
    txHash: res.transaction_hash ?? res.transactionHash,
    label: normalized,
    key: nameKey(normalized),
  };
}

export async function resolveClawName(args: {
  provider: any;
  registryAddress: string;
  label: string;
}) {
  const normalized = normalizeLabel(args.label);
  const contract = getClawIdContract({ registryAddress: args.registryAddress, providerOrAccount: args.provider });
  const calldata = CallData.compile({ label: byteArray.byteArrayFromString(normalized) });
  const result: any = await contract.call('resolve', calldata);

  const raw = result?.[0] ?? result?.addr ?? result?.address ?? result;
  const addr = raw == null ? null : num.toHex(num.toBigInt(raw));
  return { addr, label: normalized, key: nameKey(normalized) };
}

export async function getClawRecord(args: {
  provider: any;
  registryAddress: string;
  label: string;
}) {
  const normalized = normalizeLabel(args.label);
  const contract = getClawIdContract({ registryAddress: args.registryAddress, providerOrAccount: args.provider });
  const calldata = CallData.compile({ label: byteArray.byteArrayFromString(normalized) });
  const result: any = await contract.call('get_record', calldata);

  const ownerRaw = result?.owner ?? result?.[0];
  const addrRaw = result?.addr ?? result?.[1];
  const metadata = result?.metadata ?? result?.[2];

  const owner = ownerRaw == null ? null : num.toHex(num.toBigInt(ownerRaw));
  const addr = addrRaw == null ? null : num.toHex(num.toBigInt(addrRaw));

  return { owner, addr, metadata, label: normalized, key: nameKey(normalized) };
}

export async function setClawMetadata(args: {
  account: Account;
  registryAddress: string;
  label: string;
  metadata: string;
}) {
  const normalized = normalizeLabel(args.label);
  const calldata = CallData.compile({
    label: byteArray.byteArrayFromString(normalized),
    metadata: byteArray.byteArrayFromString(args.metadata ?? ''),
  });

  const res: any = await args.account.execute({
    contractAddress: args.registryAddress,
    entrypoint: 'set_metadata',
    calldata,
  } as any);

  return { txHash: res.transaction_hash ?? res.transactionHash, label: normalized, key: nameKey(normalized) };
}

export async function nameOf(args: {
  provider: any;
  registryAddress: string;
  ownerAddress: string;
}) {
  const contract = getClawIdContract({ registryAddress: args.registryAddress, providerOrAccount: args.provider });
  const result: any = await contract.call('name_of', [args.ownerAddress]);
  const key = typeof result === 'bigint' ? result : num.toBigInt(result);
  return { key };
}
