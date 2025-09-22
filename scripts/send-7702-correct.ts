#!/usr/bin/env -S node --enable-source-maps
// What this script does (short):
// - Builds a correct EIP-7702 (type 0x04) transaction that lets your EOA
//   temporarily use a delegate contract's code (TokenManager) for a single tx.
// - We set tx.to = your EOA, and put the delegate in the authorization list.
// - The VM then executes the delegate code in your EOA context, so contracts
//   you call (like ERC20) see msg.sender = your EOA.
//
// Chain differences to be aware of:
// - Base Sepolia: authorization.nonce is tx.nonce + 1
// - Etherlink VPS: authorization.nonce is tx.nonce (same value)
//
// Notes:
// - We strip leading zeros from r/s so the signatures are canonically RLP-encoded.
// - We print a curl for manual submission. Set BROADCAST=true to auto-send.
import "dotenv/config";
import { JsonRpcProvider, Wallet, keccak256, SigningKey, toBeArray, hexlify, AbiCoder, toUtf8Bytes } from "ethers";
import RLP from "rlp";

type Authorization = { chainId: bigint; address: string; nonce: bigint; yParity: 0|1; r: string; s: string };

function toMinimal(hex: string): string {
  if (!hex || hex === "0x") return "0x";
  let h = hex.toLowerCase();
  if (h.startsWith("0x")) h = h.slice(2);
  while (h.startsWith("00")) h = h.slice(2);
  return h.length === 0 ? "0x" : ("0x" + h);
}

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

function buildFunctionCall(functionName: string, params: any[]): string {
  const selector = keccak256(toUtf8Bytes(functionName)).slice(0, 10);
  const data = selector + AbiCoder.defaultAbiCoder().encode(
    params.map(p => p.type),
    params.map(p => p.value)
  ).slice(2);
  return data;
}

async function main() {
  const rpc = process.env.ETH_RPC_URL || process.env.H_RPC_URL || process.env.RPC_URL;
  const key = process.env.PRIV_KEY_1 || "";
  const delegateContract = process.env.DELEGATE_CONTRACT || process.env.CONTRACT_ADDRESS || "";
  const functionName = process.env.FUNCTION || "simpleTransfer";
  const token = process.env.TOKEN || process.env.ERC20 || "";
  const spender = process.env.SPENDER || "";
  const recipient = process.env.RECIPIENT || process.env.TO || "";
  const amountStr = process.env.AMOUNT || "0";
  const gasStr = process.env.GAS || "300000";
  const maxFeeStr = process.env.MAX_FEE || "1500000000";
  const maxPriorityStr = process.env.MAX_PRIORITY || "100000000";
  const broadcast = (process.env.BROADCAST || "false").toLowerCase() === "true";
  
  if (!rpc) throw new Error("RPC URL missing. Set ETH_RPC_URL (or H_RPC_URL / RPC_URL)");
  if (!key) throw new Error("PRIV_KEY_1 missing");
  if (!delegateContract) throw new Error("DELEGATE_CONTRACT missing - deploy TokenManager first!");
  if (!token) throw new Error("TOKEN (ERC20 address) missing");
  if (!recipient) throw new Error("RECIPIENT missing");

  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(key, provider);
  const net = await provider.getNetwork();
  const nonceNum = await provider.getTransactionCount(wallet.address, "pending");
  const chainId = BigInt(net.chainId.toString());

  const amount = BigInt(amountStr);
  
  // Build function call data for the delegate contract
  let data: string;
  let description: string;
  
  switch (functionName) {
    case "simpleTransfer":
      data = buildFunctionCall("simpleTransfer(address,address,uint256)", [
        { type: "address", value: token },
        { type: "address", value: recipient },
        { type: "uint256", value: amount }
      ]);
      description = `simpleTransfer(token=${token}, recipient=${recipient}, amount=${amount})`;
      break;
      
    case "manageTokens":
      if (!spender) throw new Error("SPENDER required for manageTokens function");
      data = buildFunctionCall("manageTokens(address,address,address,uint256)", [
        { type: "address", value: token },
        { type: "address", value: spender },
        { type: "address", value: recipient },
        { type: "uint256", value: amount }
      ]);
      description = `manageTokens(token=${token}, spender=${spender}, recipient=${recipient}, amount=${amount})`;
      break;
      
    default:
      throw new Error(`Unknown function: ${functionName}. Use 'simpleTransfer' or 'manageTokens'`);
  }

  console.log("=== CORRECT EIP-7702: Your EOA Borrows Smart Contract Code ===");
  console.log("Your EOA:", wallet.address);
  console.log("Delegate Contract (TokenManager):", delegateContract);
  console.log("Transaction TO:", wallet.address, "(your EOA - so VM executes delegate code in your context)");
  console.log("Function:", description);
  console.log("");
  console.log("What happens:");
  console.log("1. Your EOA temporarily gets TokenManager's code installed");
  console.log("2. VM executes TokenManager code in your EOA context");
  console.log("3. Token sees msg.sender = your EOA (not TokenManager contract)");
  console.log("4. Your EOA's token balance is used for the transfer");
  console.log("5. After transaction, your EOA returns to normal");
  console.log("6. TRUE EIP-7702 code delegation!");
  console.log("");

  // Sign authorization list (chainId, delegate_contract_address, nonce+1)
  // Auth nonce must be sender nonce + 1 because nonce is incremented before processing auth list
  const authNonce = rpc.includes("http://vps-43b6dfcb.vps.ovh.net/rpc/") ? BigInt(nonceNum) : BigInt(nonceNum+1);
  console.log("The nonce is:", nonceNum);
  const authMsg = RLP.encode([hexlify(toBeArray(chainId)), delegateContract, hexlify(toBeArray(authNonce)) ] as any);
  const authDigest = keccak256(Buffer.concat([Buffer.from([0x05]), Buffer.from(authMsg)]));
  const sk = new SigningKey(wallet.privateKey);
  const authSig = sk.sign(authDigest);
  const authY: 0|1 = (authSig.v === 27 ? 0 : 1);
  const auth: Authorization = { chainId, address: delegateContract, nonce: authNonce, yParity: authY, r: toMinimal(authSig.r), s: toMinimal(authSig.s) };

  // Sign outer transaction
  // CRITICAL: to = your EOA address so VM executes delegate code in your EOA context
  const access: any[] = [];
  const signingFields = [
    hexlify(toBeArray(chainId)), hexlify(toBeArray(BigInt(nonceNum))), hexlify(toBeArray(BigInt(maxPriorityStr))), hexlify(toBeArray(BigInt(maxFeeStr))), hexlify(toBeArray(BigInt(gasStr))), wallet.address, hexlify(toBeArray(0n)), data, access, [
      [hexlify(toBeArray(auth.chainId)), auth.address, hexlify(toBeArray(auth.nonce)), auth.yParity === 0 ? "0x" : "0x01", auth.r, auth.s]
    ]
  ] as any;
  const txDigest = keccak256(Buffer.concat([Buffer.from([0x04]), Buffer.from(RLP.encode(signingFields))]));
  const outerSig = sk.sign(txDigest);
  const outerY: 0|1 = (outerSig.v === 27 ? 0 : 1);
  const raw = serialize(
    chainId, BigInt(nonceNum), BigInt(maxPriorityStr), BigInt(maxFeeStr), BigInt(gasStr), wallet.address, 0n, data,
    auth,
    { yParity: outerY, r: toMinimal(outerSig.r), s: toMinimal(outerSig.s) }
  );

  console.log("Raw 0x04 tx:", raw);
  console.log("Curl:");
  console.log(`curl -s -X POST ${rpc} -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":["${raw}"]}'`);
  if (broadcast) {
    try {
      const hash: string = await provider.send("eth_sendRawTransaction", [raw]);
      console.log("Submitted:", hash);
    } catch (e) {
      console.error("Broadcast failed (expected on pre-Prague or invalid inputs)");
      console.error(e);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
