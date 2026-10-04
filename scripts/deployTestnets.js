const fs = require("fs");
const path = require("path");

const envPath = path.resolve(__dirname, "..", "..", "Atomic Barter", ".env");
require("dotenv").config({ path: envPath });

const { ethers } = require("ethers");

const CHAINS = {
  sepolia: {
    key: "sepolia",
    chainId: 11155111,
    wormholeId: 10002,
    rpc: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
    core: "0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78",
    bridge: "0xfd0Bf71F60660E2f608ed56e1659C450eB113120"
  },
  base: {
    key: "base",
    chainId: 84532,
    wormholeId: 10004,
    rpc: process.env.BASE_SEPOLIA_RPC_URL || "https://base-sepolia-rpc.publicnode.com",
    core: "0x79A1027a6A159502049F10906D333EC57E95F083"
  }
};

const LIVE = path.join(__dirname, "..", "frontend", "src", "live.json");
const RECORD = path.join(__dirname, "..", "deployed_contracts.json");
const BRIDGE_VALUE = ethers.parseEther("0.05");
const RESERVE = ethers.parseEther("0.02");

function redact(error) {
  let text = (error && (error.shortMessage || error.message)) || String(error);
  for (const key of [process.env.TEST_PRIVATE_KEY1, process.env.TEST_PRIVATE_KEY2]) {
    if (key && key.length > 10) text = text.split(key).join("[redacted]");
  }
  return text;
}

function artifact(sol, name) {
  return require(path.join(__dirname, "..", "artifacts", "contracts", `${sol}.sol`, `${name}.json`));
}

function providerFor(chain) {
  return new ethers.JsonRpcProvider(chain.rpc, chain.chainId, { staticNetwork: true });
}

function readLive() {
  return JSON.parse(fs.readFileSync(LIVE, "utf8"));
}

function writeLive(live) {
  fs.writeFileSync(LIVE, `${JSON.stringify(live, null, 2)}\n`);
  const record = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  for (const key of ["sepolia", "base"]) {
    const item = live[key];
    if (!item) continue;
    record[key] = {
      contracts: {
        SchrodingerBox: item.box,
        FeeCollector: item.feeCollector,
        ParadoxToken: item.paradox,
        SchrodingerCatNFT: item.cat,
        WormholeMailbox: item.mailbox,
        WormholeCore: item.core
      }
    };
  }
  fs.writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`);
}

async function settledNonce(signer) {
  const latest = await signer.provider.getTransactionCount(signer.address, "latest");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pending = await signer.provider.getTransactionCount(signer.address, "pending");
    if (pending === latest) return latest;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return signer.provider.getTransactionCount(signer.address, "pending");
}

async function priced(signer) {
  const nonce = await settledNonce(signer);
  const fee = await signer.provider.getFeeData();
  const price = fee.gasPrice ?? fee.maxFeePerGas ?? 1_000_000_000n;
  const maxFeePerGas = (fee.maxFeePerGas ?? price) * 3n + 1_000_000n;
  let maxPriorityFeePerGas = (fee.maxPriorityFeePerGas ?? price / 10n) * 3n;
  if (maxPriorityFeePerGas > maxFeePerGas) maxPriorityFeePerGas = maxFeePerGas / 4n;
  return { nonce, maxFeePerGas, maxPriorityFeePerGas };
}

async function send(signer, label, submit) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    let tx;
    try {
      tx = await submit(await priced(signer));
    } catch (error) {
      const text = redact(error);
      if (attempt < 4 && /replacement fee|nonce|underpriced|already known/i.test(text)) {
        console.log(`  ${label} retry ${attempt}: ${text}`);
        await new Promise((resolve) => setTimeout(resolve, 4000 * attempt));
        continue;
      }
      throw error;
    }
    console.log(`  ${label} tx ${tx.hash}`);
    const receipt = await tx.wait(1);
    console.log(`  ${label} gas ${receipt.gasUsed}`);
    return receipt;
  }
  throw new Error(`${label} failed`);
}

async function deploy(signer, sol, name, args) {
  const { abi, bytecode } = artifact(sol, name);
  const factory = new ethers.ContractFactory(abi, bytecode, signer);
  let contract;
  await send(signer, name, async (fees) => {
    contract = await factory.deploy(...args, fees);
    return contract.deploymentTransaction();
  });
  const address = await contract.getAddress();
  console.log(`  ${name} ${address}`);
  return contract;
}

async function kept(signer, address) {
  if (!address) return null;
  const code = await signer.provider.getCode(address);
  if (!code || code === "0x") return null;
  return address;
}

async function deployChain(chain, signer) {
  const previous = readLive()[chain.key] || {};
  if (!process.env.FORCE_REDEPLOY && previous.box && previous.mailbox) {
    const [boxCode, mailboxCode] = await Promise.all([
      signer.provider.getCode(previous.box),
      signer.provider.getCode(previous.mailbox)
    ]);
    if (boxCode && boxCode !== "0x" && mailboxCode && mailboxCode !== "0x") {
      const mailbox = new ethers.Contract(previous.mailbox, artifact("WormholeMailbox", "WormholeMailbox").abi, signer);
      const bound = await mailbox.box();
      if (bound.toLowerCase() === previous.box.toLowerCase()) {
        console.log(`${chain.key} already deployed at ${previous.box}`);
        return previous;
      }
    }
  }

  console.log(`deploy new mailbox and box on ${chain.key} from ${signer.address}`);
  const balance = await signer.provider.getBalance(signer.address);
  console.log(`  balance ${ethers.formatEther(balance)} ETH`);
  if (balance < ethers.parseEther("0.005")) throw new Error(`${chain.key} balance is too low to deploy`);

  const mailbox = await deploy(signer, "WormholeMailbox", "WormholeMailbox", [chain.core, chain.wormholeId, signer.address]);
  const collector = await deploy(signer, "FeeCollector", "FeeCollector", [signer.address]);
  const box = await deploy(signer, "SchrodingerBox", "SchrodingerBox", [await mailbox.getAddress(), chain.wormholeId, signer.address]);
  const paradoxAddress = await kept(signer, previous.paradox);
  const catAddress = await kept(signer, previous.cat);
  const paradox = paradoxAddress
    ? { getAddress: async () => paradoxAddress }
    : await deploy(signer, "ParadoxToken", "ParadoxToken", []);
  const cat = catAddress
    ? { getAddress: async () => catAddress }
    : await deploy(signer, "SchrodingerCatNFT", "SchrodingerCatNFT", []);
  if (paradoxAddress) console.log(`  keeping PAR ${paradoxAddress}`);
  if (catAddress) console.log(`  keeping cats ${catAddress}`);

  const boxAddress = await box.getAddress();
  const collectorAddress = await collector.getAddress();
  console.log("  wiring mailbox and fee collector");
  await send(signer, "setBox", (fees) => mailbox.setBox(boxAddress, fees));
  await send(signer, "setFeeCollector", (fees) => box.setFeeCollector(collectorAddress, fees));
  await send(signer, "setMintingFee", (fees) => box.setMintingFee(0, fees));

  const deployed = {
    box: await box.getAddress(),
    feeCollector: await collector.getAddress(),
    paradox: await paradox.getAddress(),
    cat: await cat.getAddress(),
    mailbox: await mailbox.getAddress(),
    core: chain.core
  };
  const next = readLive();
  next[chain.key] = deployed;
  writeLive(next);
  console.log(`  saved ${chain.key}`);
  return deployed;
}

async function ensurePeer(contract, chainId, peer, label) {
  const current = await contract.peers(chainId);
  if (current.toLowerCase() === peer.toLowerCase()) {
    console.log(`  ${label} peer already set`);
    return;
  }
  await send(contract.runner, `${label} peer`, (fees) => contract.setPeer(chainId, peer, fees));
  console.log(`  ${label} peer set`);
}

async function ensureTrust(box, chainId, peer, label) {
  const current = await box.trustedContracts(chainId);
  if (current.toLowerCase() === peer.toLowerCase()) {
    console.log(`  ${label} trust already set`);
    return;
  }
  await send(box.runner, `${label} trust`, (fees) => box.setTrustedContract(chainId, peer, fees));
  console.log(`  ${label} trust set`);
}

async function wire(sepoliaSigner, baseSigner, sepolia, base) {
  const boxAbi = artifact("SchrodingerBox", "SchrodingerBox").abi;
  const mailAbi = artifact("WormholeMailbox", "WormholeMailbox").abi;
  const sepoliaBox = new ethers.Contract(sepolia.box, boxAbi, sepoliaSigner);
  const baseBox = new ethers.Contract(base.box, boxAbi, baseSigner);
  const sepoliaMail = new ethers.Contract(sepolia.mailbox, mailAbi, sepoliaSigner);
  const baseMail = new ethers.Contract(base.mailbox, mailAbi, baseSigner);
  const sepoliaBox32 = ethers.zeroPadValue(sepolia.box, 32);
  const baseBox32 = ethers.zeroPadValue(base.box, 32);
  const sepoliaMail32 = ethers.zeroPadValue(sepolia.mailbox, 32);
  const baseMail32 = ethers.zeroPadValue(base.mailbox, 32);

  await ensureTrust(sepoliaBox, CHAINS.base.wormholeId, baseBox32, "sepolia box");
  await ensureTrust(baseBox, CHAINS.sepolia.wormholeId, sepoliaBox32, "base box");
  await ensurePeer(sepoliaMail, CHAINS.base.wormholeId, baseMail32, "sepolia mailbox");
  await ensurePeer(baseMail, CHAINS.sepolia.wormholeId, sepoliaMail32, "base mailbox");

  const fee = await sepoliaBox.getFunction("getWormholeFee(uint16,uint256)")(CHAINS.base.wormholeId, 0);
  const back = await baseBox.getFunction("getWormholeFee(uint16,uint256)")(CHAINS.sepolia.wormholeId, 0);
  console.log(`  sepolia publish fee ${fee}`);
  console.log(`  base publish fee ${back}`);
  if (fee !== 0n || back !== 0n) {
    throw new Error("quote did not return the core fee of 0; the mailbox is not wired to core");
  }

  await freeze(sepoliaBox, "sepolia box");
  await freeze(baseBox, "base box");
  await freeze(sepoliaMail, "sepolia mailbox");
  await freeze(baseMail, "base mailbox");
}

async function freeze(contract, label) {
  if (await contract.configFrozen()) {
    console.log(`  ${label} already frozen`);
    return;
  }
  await send(contract.runner, `${label} freeze`, (fees) => contract.freezeConfig(fees));
  console.log(`  ${label} frozen`);
}

async function mintPractice(signer, contracts, second) {
  const par = new ethers.Contract(contracts.paradox, artifact("ParadoxToken", "ParadoxToken").abi, signer);
  const cat = new ethers.Contract(contracts.cat, artifact("SchrodingerCatNFT", "SchrodingerCatNFT").abi, signer);
  const gift = ethers.parseUnits("5000", 18);
  if (await par.balanceOf(second) < gift) {
    await send(signer, "mint PAR", (fees) => par.mint(second, gift, fees));
    console.log(`  minted PAR to ${second}`);
  }
  for (const account of [signer.address, second]) {
    const held = await cat.balanceOf(account);
    const missing = 3n - held;
    for (let i = 0n; i < missing; i += 1n) {
      await send(signer, "mint cat", (fees) => cat.mint(account, fees));
    }
    if (missing > 0n) console.log(`  minted ${missing} cats to ${account}`);
  }
}

async function bridgeEth(signer) {
  const baseProvider = providerFor(CHAINS.base);
  const baseBalance = await baseProvider.getBalance(signer.address);
  console.log(`base balance ${ethers.formatEther(baseBalance)} ETH`);
  if (baseBalance >= RESERVE) return;

  const live = readLive();
  if (!live.bridgeTx) {
    const sepoliaBalance = await signer.provider.getBalance(signer.address);
    if (sepoliaBalance < BRIDGE_VALUE + RESERVE) {
      throw new Error(`need ${ethers.formatEther(BRIDGE_VALUE + RESERVE)} ETH on Sepolia to fund Base and keep a reserve`);
    }
    const bridge = new ethers.Contract(
      CHAINS.sepolia.bridge,
      ["function bridgeETH(uint32 _minGasLimit, bytes _extraData) payable"],
      signer
    );
    const receipt = await send(signer, "bridge ETH", (fees) => bridge.bridgeETH(200000, "0x", { ...fees, value: BRIDGE_VALUE }));
    live.bridgeTx = receipt.hash;
    writeLive(live);
  } else {
    console.log(`waiting on existing bridge ${live.bridgeTx}`);
  }

  for (let attempt = 1; attempt <= 80; attempt += 1) {
    const balance = await baseProvider.getBalance(signer.address);
    console.log(`  base poll ${attempt}: ${ethers.formatEther(balance)} ETH`);
    if (balance >= RESERVE) return;
    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  throw new Error("Base Sepolia deposit is not visible yet");
}

async function main() {
  if (!fs.existsSync(envPath)) throw new Error("sibling env file is missing");
  const primary = process.env.TEST_PRIVATE_KEY1;
  const secondary = process.env.TEST_PRIVATE_KEY2;
  if (!primary || !secondary) throw new Error("test keys are missing from the env file");

  const sepoliaWallet = new ethers.Wallet(primary, providerFor(CHAINS.sepolia));
  const baseWallet = new ethers.Wallet(primary, providerFor(CHAINS.base));
  const second = new ethers.Wallet(secondary).address;
  console.log(`deployer ${sepoliaWallet.address}`);
  console.log(`second ${second}`);

  const core = new ethers.Contract(CHAINS.sepolia.core, ["function messageFee() view returns (uint256)"], sepoliaWallet);
  const fee = await core.messageFee();
  console.log(`sepolia core fee ${fee}`);

  const sepolia = await deployChain(CHAINS.sepolia, sepoliaWallet);
  if (process.env.SEPOLIA_ONLY === "1") {
    console.log("practice assets on sepolia");
    await mintPractice(sepoliaWallet, sepolia, second);
    console.log("sepolia only; base and the trusted peer are unchanged");
    console.log(JSON.stringify(readLive(), null, 2));
    return;
  }
  await bridgeEth(sepoliaWallet);
  const base = await deployChain(CHAINS.base, baseWallet);
  await wire(sepoliaWallet, baseWallet, sepolia, base);
  console.log("practice assets on sepolia");
  await mintPractice(sepoliaWallet, sepolia, second);
  console.log("practice assets on base");
  await mintPractice(baseWallet, base, second);
  console.log("ready");
  console.log(JSON.stringify(readLive(), null, 2));
}

main().catch((error) => {
  console.error(redact(error));
  process.exit(1);
});
