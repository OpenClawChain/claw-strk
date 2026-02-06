import fs from 'node:fs';
import path from 'node:path';
import { Account, CallData, uint256, byteArray, RpcProvider } from 'starknet';

export function loadNftArtifacts() {
  const base = path.resolve(process.cwd(), 'assets', 'nft');
  const name = 'MintableERC721';
  const contract = JSON.parse(fs.readFileSync(path.join(base, `${name}.contract_class.json`), 'utf8'));
  const casm = JSON.parse(fs.readFileSync(path.join(base, `${name}.compiled_contract_class.json`), 'utf8'));
  return { contract, casm, name };
}

export function parseU256(input: string) {
  const s = String(input).trim();
  const value = s.startsWith('0x') || s.startsWith('0X') ? BigInt(s) : BigInt(s);
  return { value, u256: uint256.bnToUint256(value) };
}

export async function declareAndDeployNft(args: {
  account: Account;
  name: string;
  symbol: string;
  owner: string;
  resourceBounds?: any;
  waitSeconds?: number;
}) {
  const { contract, casm, name: artifactName } = loadNftArtifacts();

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

  const constructorCalldata = CallData.compile({
    name: byteArray.byteArrayFromString(args.name),
    symbol: byteArray.byteArrayFromString(args.symbol),
    owner: args.owner,
  });

  const deploy: any = await (args.account as any).deployContract(
    { classHash, constructorCalldata },
    { resourceBounds: args.resourceBounds } as any,
  );

  const deployTx = deploy.transaction_hash ?? deploy.transactionHash;
  const contractAddress =
    deploy.contract_address ?? deploy.contractAddress ?? deploy.address ?? deploy.deployedContractAddress;

  if (!deployTx) throw new Error(`deployContract returned no tx hash: ${JSON.stringify(deploy)}`);
  if (!contractAddress) throw new Error(`deployContract returned no contract address: ${JSON.stringify(deploy)}`);

  await waitTx(deployTx);

  return { artifactName, classHash, declareTx, deployTx, contractAddress };
}

export async function mintErc721(args: {
  account: Account;
  contractAddress: string;
  to: string;
  tokenId: string | bigint;
  entrypoint?: string;
}) {
  const parsed = typeof args.tokenId === 'bigint'
    ? { value: args.tokenId, u256: uint256.bnToUint256(args.tokenId) }
    : parseU256(String(args.tokenId));

  const res: any = await args.account.execute({
    contractAddress: args.contractAddress,
    entrypoint: args.entrypoint ?? 'mint',
    calldata: CallData.compile({ recipient: args.to, token_id: parsed.u256 }),
  } as any);

  return { txHash: res.transaction_hash ?? res.transactionHash };
}

export async function getErc721Balance(args: {
  provider: RpcProvider;
  contractAddress: string;
  owner: string;
  entrypoint?: string; // default: balance_of
}) {
  const res: any = await args.provider.callContract({
    contractAddress: args.contractAddress,
    entrypoint: args.entrypoint ?? 'balance_of',
    calldata: CallData.compile({ account: args.owner }),
  });

  // u256 -> BigInt
  const [low, high] = res as [string, string];
  const bn = uint256.uint256ToBN({ low, high });
  return BigInt(bn.toString());
}
