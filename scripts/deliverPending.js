const path = require("path");

const envPath = path.resolve(__dirname, "..", "..", "Atomic Barter", ".env");
require("dotenv").config({ path: envPath });

const { ethers } = require("ethers");

const MAILBOX = "0x8A10d8157D299eA5eA58A330fD13337e996158eA";
const RPC = "https://base-sepolia-rpc.publicnode.com";
const EMITTER = "000000000000000000000000069b0fafdf96b765263a8d2a7e0aa7c53124c536";
const ABI = ["function deliver(bytes encodedVaa)"];

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
  if (!chosen || chosen.balance === 0n) throw new Error("No funded account on Base Sepolia");
  return chosen;
}

async function signedVaa() {
  const response = await fetch(`https://api.testnet.wormholescan.io/api/v1/vaas/10002/${EMITTER}/0`);
  if (!response.ok) throw new Error(`Wormholescan returned ${response.status}`);
  const body = await response.json();
  const encoded = body?.data?.vaa;
  if (!encoded) throw new Error("Signed message is missing");
  return `0x${Buffer.from(encoded, "base64").toString("hex")}`;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, 84532, { staticNetwork: true });
  const { wallet, balance } = await fundedWallet(provider);
  const vaa = await signedVaa();
  const mailbox = new ethers.Contract(MAILBOX, ABI, wallet);
  try {
    await mailbox.deliver.staticCall(vaa);
  } catch (error) {
    const text = safe(error);
    if (/AlreadyDelivered|already delivered/i.test(text)) {
      console.log("already delivered");
      return;
    }
    throw new Error(text);
  }
  const gas = (await mailbox.deliver.estimateGas(vaa)) * 3n / 2n;
  const fee = await provider.getFeeData();
  const gasPrice = fee.gasPrice ?? fee.maxFeePerGas ?? 20_000_000n;
  if (balance < gas * gasPrice) throw new Error("Funded account cannot cover the delivery gas");
  console.log("from", wallet.address);
  const sent = await mailbox.deliver(vaa, { gasLimit: gas, gasPrice });
  console.log("tx", sent.hash);
  const receipt = await sent.wait();
  console.log("status", Number(receipt.status), "block", receipt.blockNumber);
}

main().catch((error) => {
  console.error(safe(error));
  process.exit(1);
});
