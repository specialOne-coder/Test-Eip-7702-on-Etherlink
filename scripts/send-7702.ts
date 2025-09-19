#!/usr/bin/env -S node --enable-source-maps
// Minimal 0x04 tx builder. Use to sanity-check encoding + RPC.
import "dotenv/config";
import { z } from "zod";
import { Wallet, JsonRpcProvider, keccak256, SigningKey, toBeArray, hexlify } from "ethers";
import RLP from "rlp";

type Authorization = { chainId: bigint; address: string; nonce: bigint; yParity: 0|1; r: string; s: string };

// Basic inputs from env/CLI
const Args = z.object({
  rpc: z.string().default(process.env.ETH_RPC_URL || "http://localhost:8545"),
  key: z.string().default(process.env.PRIV_KEY_1 || ""),
  to: z.string().default("0x0000000000000000000000000000000000000000"),
  value: z.string().default("0"),
  gas: z.string().default("200000"),
  maxFee: z.string().default("1500000000"),
  maxPriority: z.string().default("100000000"),
  broadcast: z.string().default("false")
});

// Build a 0x04 RLP payload with outer signature placeholders
function serialize(chainId: bigint, nonce: bigint, maxPriority: bigint, maxFee: bigint, gas: bigint, to: string|null, value: bigint, data: string, auth: Authorization, outerSig: {yParity: 0|1, r: string, s: string}): string {
  const access: any[] = [];
  const toField = to === null ? "0x" : to;
  const auths = [
    [hexlify(toBeArray(auth.chainId)), auth.address, hexlify(toBeArray(auth.nonce)), auth.yParity === 0 ? "0x" : "0x01", auth.r, auth.s]
  ];
  const fields = [
    hexlify(toBeArray(chainId)), hexlify(toBeArray(nonce)), hexlify(toBeArray(maxPriority)), hexlify(toBeArray(maxFee)), hexlify(toBeArray(gas)), toField, hexlify(toBeArray(value)), data, access, auths
  ] as any;
  const encoded = RLP.encode([...fields, outerSig.yParity, outerSig.r, outerSig.s]);
  return "0x04" + Buffer.from(encoded).toString("hex");
}

async function main() {
  // Resolve args
  const a = Args.parse({
    rpc: process.env.ETH_RPC_URL, key: process.env.PRIV_KEY_1, to: process.env.TO, value: process.env.VALUE,
    gas: process.env.GAS || "200000", maxFee: process.env.MAX_FEE || "1500000000", maxPriority: process.env.MAX_PRIORITY || "100000000",
    broadcast: process.env.BROADCAST || "false"
  });
  const provider = new JsonRpcProvider(a.rpc);
  const wallet = new Wallet(a.key, provider);
  const net = await provider.getNetwork();
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  const chainId = BigInt(net.chainId.toString());

  // Sign a simple auth tuple (chainId, address, nonce) with 0x05 prefix
  const authMsg = RLP.encode([hexlify(toBeArray(chainId)), wallet.address, hexlify(toBeArray(BigInt(nonce))) ] as any);
  const authDigest = keccak256(Buffer.concat([Buffer.from([0x05]), Buffer.from(authMsg)]));
  const sk = new SigningKey(wallet.privateKey);
  const authSig = sk.sign(authDigest);
  const authY: 0|1 = (authSig.v === 27 ? 0 : 1);
  const auth: Authorization = { chainId, address: wallet.address, nonce: BigInt(nonce), yParity: authY, r: authSig.r, s: authSig.s };

  // Sign outer transaction body
  const access: any[] = [];
  const toField = a.to === null ? "0x" : a.to;
  const auths = [
    [hexlify(toBeArray(auth.chainId)), auth.address, hexlify(toBeArray(auth.nonce)), auth.yParity === 0 ? "0x" : "0x01", auth.r, auth.s]
  ];
  const signingFields = [
    hexlify(toBeArray(chainId)), hexlify(toBeArray(BigInt(nonce))), hexlify(toBeArray(BigInt(a.maxPriority))), hexlify(toBeArray(BigInt(a.maxFee))), hexlify(toBeArray(BigInt(a.gas))), toField, hexlify(toBeArray(BigInt(a.value))), "0x", access, auths
  ] as any;
  const txDigest = keccak256(Buffer.concat([Buffer.from([0x04]), Buffer.from(RLP.encode(signingFields))]));
  const outerSig = sk.sign(txDigest);
  const outerY: 0|1 = (outerSig.v === 27 ? 0 : 1);
  const outerSignature = { yParity: outerY, r: outerSig.r, s: outerSig.s };

  const raw = serialize(chainId, BigInt(nonce), BigInt(a.maxPriority), BigInt(a.maxFee), BigInt(a.gas), a.to, BigInt(a.value), "0x", auth, outerSignature);
  console.log("Raw 0x04 tx:", raw);
  console.log("Curl:");
  console.log(`curl -s -X POST ${a.rpc} -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":["${raw}"]}'`);
  if (a.broadcast === "true") {
    const hash: string = await provider.send("eth_sendRawTransaction", [raw]);
    console.log("Submitted:", hash);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

