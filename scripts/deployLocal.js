const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const CHAIN_A = 10001;
const CHAIN_B = 10002;

function asBytes32(address) {
  return hre.ethers.zeroPadValue(address, 32);
}

async function main() {
  const [deployer, second] = await hre.ethers.getSigners();
  if (!deployer || !second) {
    throw new Error("The local node must expose at least two accounts");
  }

  const relayer = await (await hre.ethers.getContractFactory("MockRelayer")).deploy();
  await relayer.waitForDeployment();

  const fees = await (await hre.ethers.getContractFactory("FeeCollector")).deploy(deployer.address);
  await fees.waitForDeployment();

  const Box = await hre.ethers.getContractFactory("SchrodingerBox");
  const boxA = await Box.deploy(await relayer.getAddress(), CHAIN_A, deployer.address);
  const boxB = await Box.deploy(await relayer.getAddress(), CHAIN_B, deployer.address);
  await boxA.waitForDeployment();
  await boxB.waitForDeployment();

  const boxAAddress = await boxA.getAddress();
  const boxBAddress = await boxB.getAddress();

  await (await boxA.setFeeCollector(await fees.getAddress())).wait();
  await (await boxB.setFeeCollector(await fees.getAddress())).wait();
  await (await boxA.setTrustedContract(CHAIN_B, asBytes32(boxBAddress))).wait();
  await (await boxB.setTrustedContract(CHAIN_A, asBytes32(boxAAddress))).wait();

  const token = await (await hre.ethers.getContractFactory("ParadoxToken")).deploy();
  await token.waitForDeployment();
  const cat = await (await hre.ethers.getContractFactory("SchrodingerCatNFT")).deploy();
  await cat.waitForDeployment();

  const gift = hre.ethers.parseEther("10000");
  await (await token.mint(second.address, gift)).wait();
  await (await cat.mint(deployer.address)).wait();
  await (await cat.mint(deployer.address)).wait();
  await (await cat.mint(second.address)).wait();
  await (await cat.mint(second.address)).wait();

  const trustedOnA = await boxA.trustedContracts(CHAIN_B);
  if (trustedOnA.toLowerCase() !== asBytes32(boxBAddress).toLowerCase()) {
    throw new Error("Chain A does not trust chain B");
  }

  const out = {
    rpc: "http://127.0.0.1:8545",
    chainId: 31337,
    deployedAt: new Date().toISOString(),
    wormhole: { A: CHAIN_A, B: CHAIN_B },
    contracts: {
      relayer: await relayer.getAddress(),
      feeCollector: await fees.getAddress(),
      boxA: boxAAddress,
      boxB: boxBAddress,
      paradox: await token.getAddress(),
      cat: await cat.getAddress()
    },
    accounts: [
      {
        name: "Wallet A",
        address: deployer.address,
        role: "Owner dei contratti. Aprilo nel primo browser."
      },
      {
        name: "Wallet B",
        address: second.address,
        role: "Secondo wallet. Aprilo nell'altro browser."
      }
    ]
  };

  const file = path.join(__dirname, "..", "frontend", "public", "deployments.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("Local playground deployed");
  console.log(JSON.stringify(out, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
