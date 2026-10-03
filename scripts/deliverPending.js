const path = require("path");

const envPath = process.env.ENV_FILE
  ? path.resolve(process.env.ENV_FILE)
  : path.resolve(__dirname, "..", ".env");
require("dotenv").config({ path: envPath });

const { ethers } = require("ethers");

const ABI = [
  "function deliver(bytes encodedVaa)",
  "error AlreadyDelivered()",
  "error InvalidVaa(string reason)",
  "error UntrustedEmitter()",
  "error UnexpectedTarget()",
  "error WrongTargetChain()"
];

const LEGS = [
  {
    name: "Sepolia to Base",
    rpc: "https://base-sepolia-rpc.publicnode.com",
    chainId: 84532,
    mailbox: "0x8A10d8157D299eA5eA58A330fD13337e996158eA",
    vaaChain: 10002,
    emitter: "000000000000000000000000069b0fafdf96b765263a8d2a7e0aa7c53124c536",
    sequence: 0
  },
  {
    name: "Base to Sepolia",
    rpc: "https://ethereum-sepolia-rpc.publicnode.com",
    chainId: 11155111,
    mailbox: "0x069b0fAFDf96b765263a8d2A7E0Aa7C53124C536",
    vaaChain: 10004,
    emitter: "0000000000000000000000008a10d8157d299ea5ea58a330fd13337e996158ea",
    sequence: 0
  }
];

function safe(error) {
  let text = error?.shortMessage || error?.message || String(error);
  for (const secret of [process.env.TEST_PRIVATE_KEY1, process.env.TEST_PRIVATE_KEY2]) {
    if (!secret) continue;
    text = text.split(secret).join("[redacted]");
    const bare = secret.replace(/^0x/i, "");
    if (bare) text = text.split(bare).join("[redacted]");
  }
  return text;
}

async function fundedWallet(provider) {
  const keys = [process.env.TEST_PRIVATE_KEY1, process.env.TEST_PRIVATE_KEY2].filter(Boolean);
  if (keys.length === 0) throw new Error("No test key in the env file");
  let chosen = null;
  for (const key of keys) {
    const wallet = new ethers.Wallet(key, provider);
    const balance = await provider.getBalance(wallet.address);
    if (!chosen || balance > chosen.balance) chosen = { wallet, balance };
  }
  if (!chosen || chosen.balance === 0n) throw new Error("No funded account on this chain");
  return chosen;
}

async function signedVaa(leg) {
  const response = await fetch(`https://api.testnet.wormholescan.io/api/v1/vaas/${leg.vaaChain}/${leg.emitter}/${leg.sequence}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Wormholescan returned ${response.status} for ${leg.name}`);
  const body = await response.json();
  const encoded = body?.data?.vaa;
  if (!encoded) return null;
  return `0x${Buffer.from(encoded, "base64").toString("hex")}`;
}

async function deliverLeg(leg) {
  const provider = new ethers.JsonRpcProvider(leg.rpc, leg.chainId, { staticNetwork: true });
  const vaa = await signedVaa(leg);
  if (!vaa) {
    console.log(leg.name, "not signed yet");
    return;
  }
  const { wallet, balance } = await fundedWallet(provider);
  const mailbox = new ethers.Contract(leg.mailbox, ABI, wallet);
  try {
    await mailbox.deliver.staticCall(vaa);
  } catch (error) {
    const data = error?.data;
    let name = null;
    if (typeof data === "string" && data.startsWith("0x")) {
      try {
        name = mailbox.interface.parseError(data)?.name || null;
      } catch {
        name = null;
      }
    }
    if (name === "AlreadyDelivered") {
      console.log(leg.name, "already delivered");
      return;
    }
    throw new Error(`${leg.name}: ${name || safe(error)}`);
  }
  const gas = (await mailbox.deliver.estimateGas(vaa)) * 3n / 2n;
  const fee = await provider.getFeeData();
  const gasPrice = fee.gasPrice ?? fee.maxFeePerGas ?? 20_000_000n;
  if (balance < gas * gasPrice) throw new Error(`${leg.name}: funded account cannot cover the delivery gas`);
  console.log(leg.name, "from", wallet.address);
  const sent = await mailbox.deliver(vaa, { gasLimit: gas, gasPrice });
  console.log(leg.name, "tx", sent.hash);
  const receipt = await sent.wait();
  console.log(leg.name, "status", Number(receipt.status), "block", receipt.blockNumber);
}

async function main() {
  for (const leg of LEGS) {
    await deliverLeg(leg);
  }
}

main().catch((error) => {
  console.error(safe(error));
  process.exit(1);
});
