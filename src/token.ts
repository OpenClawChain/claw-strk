import fs from 'node:fs';
import path from 'node:path';
import { Account, CallData, uint256, byteArray } from 'starknet';

export type TokenKind = 'fixed' | 'mintable';

export function loadTokenArtifacts(kind: TokenKind) {
  const base = path.resolve(process.cwd(), 'assets', 'token');
  const name = kind === 'fixed' ? 'FixedERC20' : 'MintableERC20';
  const contract = JSON.parse(fs.readFileSync(path.join(base, `${name}.contract_class.json`), 'utf8'));
  const casm = JSON.parse(fs.readFileSync(path.join(base, `${name}.compiled_contract_class.json`), 'utf8'));
  return { contract, casm, name };
}

export async function declareAndDeployToken(args: {
  account: Account;
  kind: TokenKind;
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: bigint;
  recipient: string;
  owner?: string; // for mintable
  resourceBounds?: any;
  waitSeconds?: number;
}) {
  const { contract, casm, name: artifactName } = loadTokenArtifacts(args.kind);

  const waitSeconds = args.waitSeconds ?? 120;
  async function waitTx(txHash: string) {
    const timeout = new Promise((_r, rej) =>
      setTimeout(() => rej(new Error(`Timeout waiting for tx ${txHash}`)), waitSeconds * 1000)
    );
    return Promise.race([args.account.waitForTransaction(txHash), timeout]);
  }

  // declare
  const declare: any = await (args.account as any).declareIfNot({ contract, casm }, { resourceBounds: args.resourceBounds } as any);
  const declareTx = declare.transaction_hash;
  const classHash = declare.class_hash;
  if (declareTx && declareTx !== '0x0' && declareTx !== '') await waitTx(declareTx);

  const common = {
    // ByteArray serialization for Cairo
    name: byteArray.byteArrayFromString(args.name),
    symbol: byteArray.byteArrayFromString(args.symbol),
    decimals: args.decimals,
  };

  const constructorCalldata = args.kind === 'mintable'
    ? CallData.compile({ ...common, owner: args.owner ?? args.account.address })
    : CallData.compile({
        ...common,
        fixed_supply: uint256.bnToUint256(args.initialSupply),
        recipient: args.recipient,
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

export async function mintToken(args: {
  account: Account;
  tokenAddress: string;
  to: string;
  amount: bigint;
}) {
  // MintableERC20 mint(recipient, amount)
  const res: any = await args.account.execute({
    contractAddress: args.tokenAddress,
    entrypoint: 'mint',
    calldata: CallData.compile({ recipient: args.to, amount: uint256.bnToUint256(args.amount) }),
  } as any);
  return { txHash: res.transaction_hash ?? res.transactionHash };
}
