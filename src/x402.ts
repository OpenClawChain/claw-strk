import { Account, typedData, RpcProvider, CallData, uint256, shortString } from 'starknet';
import { randomBytes } from 'node:crypto';

export type StarknetX402Network = 'starknet-sepolia' | 'starknet-mainnet';

export type PaymentRequirements = {
  scheme: 'exact' | string;
  network: StarknetX402Network | string;
  maxAmountRequired: string;
  asset: string;
  payTo: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  extra?: unknown;
};

export type PaymentRequiredResponse = {
  x402Version: number;
  accepts: PaymentRequirements[];
  error?: string;
};

export type X402PaymentPayload = {
  x402Version: 1;
  scheme: 'exact';
  network: StarknetX402Network;
  payload: {
    from: string;
    to: string;
    token: string;
    amount: string;
    nonce: string;
    deadline: number;
    signature: { r: string; s: string };
  };
};

function getChainId(network: StarknetX402Network): string {
  // values copied from starknet-x402 spec
  return network === 'starknet-mainnet'
    ? '0x534e5f4d41494e' // SN_MAIN
    : '0x534e5f5345504f4c4941'; // SN_SEPOLIA
}

// NOTE: Starknet felt252 fits ~251 bits; keep nonce <= 31 bytes to stay < field prime.
export function generateNonceHex(bytes = 31): string {
  return '0x' + randomBytes(bytes).toString('hex');
}

export function createPaymentTypedData(opts: {
  from: string;
  to: string;
  token: string;
  amount: string;
  nonce: string;
  deadline: number;
  network: StarknetX402Network;
}) {
  // On starknet.js v8, domain fields are felts; encode short strings explicitly.
  const domainName = shortString.encodeShortString('x402 Payment');
  const domainVersion = shortString.encodeShortString('1');

  return {
    types: {
      StarkNetDomain: [
        { name: 'name', type: 'felt' },
        { name: 'version', type: 'felt' },
        { name: 'chainId', type: 'felt' },
      ],
      Payment: [
        { name: 'from', type: 'felt' },
        { name: 'to', type: 'felt' },
        { name: 'token', type: 'felt' },
        { name: 'amount', type: 'felt' },
        { name: 'nonce', type: 'felt' },
        { name: 'deadline', type: 'felt' },
      ],
    },
    primaryType: 'Payment',
    domain: {
      name: domainName,
      version: domainVersion,
      chainId: getChainId(opts.network),
    },
    message: {
      from: opts.from,
      to: opts.to,
      token: opts.token,
      amount: opts.amount,
      nonce: opts.nonce,
      deadline: opts.deadline,
    },
  };
}

export async function signX402Payment(args: {
  account: Account;
  network: StarknetX402Network;
  to: string;
  token: string;
  amount: string;
  nonce?: string;
  deadline?: number; // unix seconds
}): Promise<{ payment: X402PaymentPayload; paymentHeader: string; typedDataMsg: any }> {
  const nonce = args.nonce ?? generateNonceHex(31);
  const deadline = args.deadline ?? Math.floor(Date.now() / 1000) + 300;

  const typed = createPaymentTypedData({
    from: args.account.address,
    to: args.to,
    token: args.token,
    amount: args.amount,
    nonce,
    deadline,
    network: args.network,
  });

  const sig = await args.account.signMessage(typed);
  const r = (sig as any)[0] ?? (sig as any).r;
  const s = (sig as any)[1] ?? (sig as any).s;

  const payment: X402PaymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: args.network,
    payload: {
      from: args.account.address,
      to: args.to,
      token: args.token,
      amount: args.amount,
      nonce,
      deadline,
      signature: {
        r: String(r),
        s: String(s),
      },
    },
  };

  const paymentHeader = Buffer.from(JSON.stringify(payment)).toString('base64');
  return { payment, paymentHeader, typedDataMsg: typed };
}

export async function x402Request(url: string, opts: {
  account: Account;
  network: StarknetX402Network;
  amountOverride?: string;
  facilitatorUrl?: string; // optional: call /verify + /settle like starknet-x402
  requestInit?: RequestInit;
}): Promise<{ response: Response; paymentHeader?: string; settlement?: any; requirements?: PaymentRequirements }> {
  const initial = await fetch(url, opts.requestInit);
  if (initial.status !== 402) return { response: initial };

  const pr = (await initial.json()) as PaymentRequiredResponse;
  const req = pr.accepts?.[0];
  if (!req) throw new Error('402 response missing accepts[0]');

  const amount = opts.amountOverride ?? req.maxAmountRequired;

  const { paymentHeader } = await signX402Payment({
    account: opts.account,
    network: opts.network,
    to: req.payTo,
    token: req.asset,
    amount,
  });

  // Optional facilitator: verify+settle before getting resource.
  // This matches adipundir/starknet-x402 middleware behavior.
  let settlement: any = undefined;
  if (opts.facilitatorUrl) {
    const verifyRes = await fetch(`${opts.facilitatorUrl}/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x402Version: 1, paymentHeader, paymentRequirements: req }),
    });
    const verifyJson = await verifyRes.json();
    if (!verifyJson?.isValid) {
      throw new Error(`facilitator verify failed: ${verifyJson?.invalidReason ?? 'unknown'}`);
    }

    const settleRes = await fetch(`${opts.facilitatorUrl}/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x402Version: 1, paymentHeader, paymentRequirements: req }),
    });
    settlement = await settleRes.json();
    if (!settlement?.success) {
      throw new Error(`facilitator settle failed: ${settlement?.error ?? 'unknown'}`);
    }
  }

  const paid = await fetch(url, {
    ...opts.requestInit,
    headers: {
      ...(opts.requestInit?.headers ?? {}),
      'X-PAYMENT': paymentHeader,
    },
  });

  return { response: paid, paymentHeader, settlement, requirements: req };
}

export async function approveErc20(args: {
  account: Account;
  tokenAddress: string;
  spender: string;
  amount: bigint;
}) {
  const call = {
    contractAddress: args.tokenAddress,
    entrypoint: 'approve',
    calldata: CallData.compile({
      spender: args.spender,
      amount: uint256.bnToUint256(args.amount),
    }),
  } as any;

  return args.account.execute(call);
}

export function parseNetwork(n: string): StarknetX402Network {
  const s = n.trim().toLowerCase();
  if (s === 'sepolia' || s === 'starknet-sepolia') return 'starknet-sepolia';
  if (s === 'mainnet' || s === 'starknet-mainnet') return 'starknet-mainnet';
  throw new Error(`Unsupported network '${n}'. Use sepolia|mainnet.`);
}
