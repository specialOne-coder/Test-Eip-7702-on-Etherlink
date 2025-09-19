#!/usr/bin/env -S node --enable-source-maps
import "dotenv/config";
import { JsonRpcProvider, Wallet, Interface, hexlify, toBeArray, keccak256, SigningKey } from "ethers";
import RLP from "rlp";

type Authorization = { chainId: bigint; address: string; nonce: bigint; yParity: 0|1; r: string; s: string };

function serialize(
  chainId: bigint,
  nonce: bigint,
  maxPriority: bigint,
  maxFee: bigint,
  gas: bigint,
  to: string|null,
  value: bigint,
  data: string,
  auth: Authorization,
  outerSig: { yParity: 0|1, r: string, s: string }
): string {
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
  const rpc = process.env.ETH_RPC_URL || process.env.RPC_URL;
  const key = process.env.PRIV_KEY_1 || "";
  const delegate = process.env.DELEGATE_CONTRACT || ""; // TokenManager
  const token = process.env.TOKEN || "";
  const recipient = process.env.RECIPIENT || "";
  const amountStr = process.env.AMOUNT || "1000000000000000"; // 0.001
  const gasStr = process.env.GAS || "1200000";
  const maxFeeStr = process.env.MAX_FEE || "1500000000";
  const maxPriorityStr = process.env.MAX_PRIORITY || "100000000";
  if (!rpc || !key || !delegate || !token || !recipient) throw new Error("Missing ETH_RPC_URL/PRIV_KEY_1/DELEGATE_CONTRACT/TOKEN/RECIPIENT");

  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(key, provider);
  const net = await provider.getNetwork();
  const chainId = BigInt(net.chainId.toString());

  const erc20 = new Interface([
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
  ]);

  async function balanceOf(addr: string) {
    const data = erc20.encodeFunctionData("balanceOf", [addr]);
    const res: string = await provider.call({ to: token, data });
    return BigInt(res);
  }

  const beforeSender = await balanceOf(wallet.address);
  const beforeRcpt = await balanceOf(recipient);
  console.log("Balances before:", { sender: beforeSender.toString(), recipient: beforeRcpt.toString() });

  // Control: normal transfer tx (no 7702) to verify token + indexer
  try {
    const tx1 = await wallet.sendTransaction({ to: token, data: erc20.encodeFunctionData("transfer", [recipient, BigInt(amountStr)]), gasLimit: BigInt(gasStr) });
    const r1 = await tx1.wait();
    console.log("Control transfer tx:", r1?.hash, "status:", r1?.status);
  } catch (e) {
    console.log("Control transfer failed (ok if token prevents direct calls)");
  }

  // Etherlink 7702: to=EOA, auth.address=delegate, auth.nonce=tx.nonce (offset 0)
  const nonceNum = await provider.getTransactionCount(wallet.address, "pending");
  const offset = BigInt(process.env.AUTH_NONCE_OFFSET || "0");
  const authNonce = BigInt(nonceNum) + offset;
  const dataDelegated = new Interface(["function manageTokens(address,address,address,uint256)"]).encodeFunctionData(
    "manageTokens",
    [token, wallet.address, recipient, BigInt(amountStr)]
  );
  const authMsg = RLP.encode([hexlify(toBeArray(chainId)), delegate, hexlify(toBeArray(authNonce))] as any);
  const authDigest = keccak256(Buffer.concat([Buffer.from([0x05]), Buffer.from(authMsg)]));
  const sk = new SigningKey(wallet.privateKey);
  const asig = sk.sign(authDigest);
  const ay: 0|1 = (asig.v === 27 ? 0 : 1);
  const auth: Authorization = { chainId, address: delegate, nonce: authNonce, yParity: ay, r: asig.r, s: asig.s };

  const signingFields = [
    hexlify(toBeArray(chainId)), hexlify(toBeArray(BigInt(nonceNum))), hexlify(toBeArray(BigInt(maxPriorityStr))), hexlify(toBeArray(BigInt(maxFeeStr))), hexlify(toBeArray(BigInt(gasStr))), wallet.address, hexlify(toBeArray(0n)), dataDelegated, [], [
      [hexlify(toBeArray(auth.chainId)), auth.address, hexlify(toBeArray(auth.nonce)), auth.yParity === 0 ? "0x" : "0x01", auth.r, auth.s]
    ]
  ] as any;
  const txDigest = keccak256(Buffer.concat([Buffer.from([0x04]), Buffer.from(RLP.encode(signingFields))]));
  const osig = sk.sign(txDigest);
  const oy: 0|1 = (osig.v === 27 ? 0 : 1);
  const raw = serialize(chainId, BigInt(nonceNum), BigInt(maxPriorityStr), BigInt(maxFeeStr), BigInt(gasStr), wallet.address, 0n, dataDelegated, auth, { yParity: oy, r: osig.r, s: osig.s });
  console.log("Raw 0x04:", raw.slice(0, 100), "...");
  const hash: string = await provider.send("eth_sendRawTransaction", [raw]);
  console.log("7702 tx:", hash);
  const rec = await provider.getTransactionReceipt(hash);
  console.log("7702 receipt status:", rec?.status, "logs:", rec?.logs?.length);

  const afterSender = await balanceOf(wallet.address);
  const afterRcpt = await balanceOf(recipient);
  console.log("Balances after:", { sender: afterSender.toString(), recipient: afterRcpt.toString() });

  const senderDelta = beforeSender - afterSender;
  const rcptDelta = afterRcpt - beforeRcpt;
  const ok = senderDelta === BigInt(amountStr) && rcptDelta === BigInt(amountStr) && (rec?.logs?.length ?? 0) > 0;
  console.log(ok ? "RESULT: PASS (delegation executed)" : "RESULT: FAIL (no effect: Etherlink 7702 delegation likely not executed)");
}

main().catch((e) => { console.error(e); process.exit(1); });


