### 7702 Prague/EIP-7702 Minimal Runner

This folder contains a minimal, shareable test harness to validate EIP-7702 (type 0x04) “borrowed code” transactions on any RPC.

What it does
- Crafts a correct 0x04 tx with: to = your EOA, and authorization list pointing to a delegate contract (e.g. TokenManager)
- Signs both the authorization tuple and the outer tx
- Prints a ready-to-run curl or broadcasts it directly

Files kept
- `scripts/send-7702.ts`: simple raw 0x04 builder/broadcaster (baseline)
- `scripts/send-7702-correct.ts`: production runner for borrowed-code flow (auth.address=delegate, to=EOA)

Prereqs
- Node 20+, pnpm
- Foundry (forge) if you want to deploy helper contracts from here

Install deps
```bash
pnpm install
```

Deploy helper contracts (example)
```bash
# Minimal ERC20 (mints to deployer)
~/.foundry/bin/forge create contracts/MinimalERC20.sol:MinimalERC20 \
  --rpc-url <RPC> \
  --private-key <PRIV_KEY> \
  --broadcast --gas-limit 10000000 \
  --constructor-args 1000000000000000000000000

# TokenManager (delegate)
~/.foundry/bin/forge create contracts/TokenManager.sol:TokenManager \
  --rpc-url <RPC> \
  --private-key <PRIV_KEY> \
  --broadcast --gas-limit 10000000
```

Run: borrowed-code (manageTokens)
Environment variables:
- ETH_RPC_URL: target RPC
- PRIV_KEY_1: hex private key of the sender EOA
- DELEGATE_CONTRACT: address of deployed TokenManager (delegate)
- FUNCTION: `manageTokens` or `simpleTransfer`
- TOKEN: ERC20 token address
- SPENDER: address to approve (only for manageTokens)
- RECIPIENT: receive address
- AMOUNT: uint256 amount (wei)
- GAS: gas limit (suggest 1,200,000 – 8,000,000)
- BROADCAST: `true` to send

Borrowed-code: Base Sepolia example (AUTH nonce = tx.nonce + 1)
```bash
ETH_RPC_URL="https://base-sepolia.drpc.org" \
PRIV_KEY_1=0x... \
DELEGATE_CONTRACT=0x<token_manager> \
FUNCTION=manageTokens \
TOKEN=0x<erc20> \
SPENDER=0x<your_eoa> \
RECIPIENT=0x<recipient> \
AMOUNT=1000000000000000000 \
GAS=1200000 \
BROADCAST=true \
pnpm run send:correct
```

Borrowed-code: Etherlink (VPS) example (AUTH nonce = tx.nonce)
```bash
ETH_RPC_URL="http://<etherlink-vps>/rpc/" \
PRIV_KEY_1=0x... \
DELEGATE_CONTRACT=0x<token_manager> \
FUNCTION=manageTokens \
TOKEN=0x<erc20> \
SPENDER=0x<your_eoa> \
RECIPIENT=0x<recipient> \
AMOUNT=1000000000000000000 \
GAS=8000000 \
BROADCAST=true \
pnpm run send:correct
```

Notes
- EIP-7702 semantics used here:
  - Authorization.address = delegate contract (TokenManager)
  - Transaction.to = sender EOA (VM runs delegate in EOA context)
  - Authorization.nonce: chain specific
    - Base Sepolia: tx.nonce + 1
    - Etherlink VPS: tx.nonce



### Example commands

Test eip 7702 0x04 tx on etherlink

```sh 
ETH_RPC_URL="http://vps-43b6dfcb.vps.ovh.net/rpc/" PRIV_KEY_1= TO=0x0000000000000000000000000000000000000000 VALUE=1 GAS=800000 MAX_FEE=1500000000 MAX_PRIORITY=100000000 BROADCAST=true pnpm ts-node scripts/send-7702.ts
```

Test eip 7702 complex delegate tx on base

```sh 
ETH_RPC_URL="https://base-sepolia.drpc.org" PRIV_KEY_1=YOUR_PRIVATE_KEY DELEGATE_CONTRACT=0x49cE468c8FA2b7B3c84c140Eccb9073889B2A7Ba FUNCTION=manageTokens TOKEN=0x2938ED7c02E4a48B10042842DaC90153A6a8C185 SPENDER=0x6432BF02a54975500EE3924Dfe504351E27b968B RECIPIENT=0x0000000000000000000000000000000000000001 AMOUNT=1000000000000000000 GAS=2000000 BROADCAST=true pnpm run send:correct
```
Transaction output on [etherscan](https://sepolia.basescan.org/tx/0x566bb6018fe42cc333ad46692311e521905fcf49aebb9d62c01a3582f29e27bb) or on [blockscout](https://base-sepolia.blockscout.com/tx/0x566bb6018fe42cc333ad46692311e521905fcf49aebb9d62c01a3582f29e27bb?tab=index)

Test eip 7702 complex delegate tx on etherlink rainbownet

```sh 
ETH_RPC_URL="http://vps-43b6dfcb.vps.ovh.net/rpc/" PRIV_KEY_1=YOUR_PRIVATE_KEY DELEGATE_CONTRACT=0x1341dF3bbAE96945575c2464e545366e4A49dCFB FUNCTION=manageTokens TOKEN=0x2c433ecB6d3cDE8F4Ba4B760cbc59FBaa1FB7d66 SPENDER=0x6432BF02a54975500EE3924Dfe504351E27b968B RECIPIENT=0x6ce4d79d4E77402e1ef3417Fdda433aA744C6e1c AMOUNT=20000000000000000000 GAS=8000000 BROADCAST=true pnpm run send:correct
```

Tx output on [blockscout](http://vps-43b6dfcb.vps.ovh.net/tx/0xa036898eaf05f2d124a9b9f7b88808a1c2413b1d042cc0b4ea09333cf26072a2)
