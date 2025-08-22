const hre = require("hardhat");

async function main() {
  // Get the deploying accounts
  const [deployer, secondAccount] = await hre.ethers.getSigners();
  
  if (!deployer || !secondAccount) {
    throw new Error("Not enough signers available");
  }

  console.log("Primary deploying account:", deployer.address);
  console.log("Secondary account:", secondAccount.address);

  // Wormhole Relayer addresses for testnets
  let wormholeRelayerAddress;
  let chainId;

  // Set addresses based on network
  const network = hre.network.name;
  if (network === "sepolia") {
    wormholeRelayerAddress = process.env.WORMHOLE_RELAYER_SEPOLIA;
    chainId = 10002; // Sepolia chain ID in Wormhole
  } else if (network === "holesky") {
    wormholeRelayerAddress = process.env.WORMHOLE_RELAYER_HOLESKY;
    chainId = 10004; // Holesky chain ID in Wormhole
  } else {
    throw new Error("Network not supported");
  }

  console.log(`Deploying on ${network} with Wormhole chain ID: ${chainId}`);
  console.log(`Using Wormhole Relayer: ${wormholeRelayerAddress}`);

  // Validate Wormhole Relayer address
  if (!wormholeRelayerAddress) {
    throw new Error(`Wormhole Relayer address not found for ${network}`);
  }

  // Deploy FeeCollector (using primary account)
  console.log("Deploying FeeCollector...");
  const FeeCollector = await hre.ethers.getContractFactory("FeeCollector");
  const feeCollector = await FeeCollector.deploy(deployer.address);
  await feeCollector.deploymentTransaction()?.wait(1);
  const feeCollectorAddress = await feeCollector.getAddress();
  console.log("FeeCollector deployed to:", feeCollectorAddress);

  // Deploy SchrodingerBox (using primary account)
  console.log("Deploying SchrodingerBox...");
  const SchrodingerBox = await hre.ethers.getContractFactory("SchrodingerBox");
  const schrodingerBox = await SchrodingerBox.deploy(
    wormholeRelayerAddress,
    chainId,
    deployer.address
  );
  await schrodingerBox.deploymentTransaction()?.wait(1);
  const schrodingerBoxAddress = await schrodingerBox.getAddress();
  console.log("SchrodingerBox deployed to:", schrodingerBoxAddress);

  // Deploy ParadoxToken (using secondary account)
  console.log("Deploying ParadoxToken...");
  const ParadoxToken = await hre.ethers.getContractFactory("ParadoxToken", secondAccount);
  const paradoxToken = await ParadoxToken.deploy();
  await paradoxToken.deploymentTransaction()?.wait(1);
  const paradoxTokenAddress = await paradoxToken.getAddress();
  console.log("ParadoxToken deployed to:", paradoxTokenAddress);

  // Deploy SchrodingerCatNFT (using secondary account)
  console.log("Deploying SchrodingerCatNFT...");
  const SchrodingerCatNFT = await hre.ethers.getContractFactory("SchrodingerCatNFT", secondAccount);
  const schrodingerCatNFT = await SchrodingerCatNFT.deploy();
  await schrodingerCatNFT.deploymentTransaction()?.wait(1);
  const schrodingerCatNFTAddress = await schrodingerCatNFT.getAddress();
  console.log("SchrodingerCatNFT deployed to:", schrodingerCatNFTAddress);

  // Set fee collector on SchrodingerBox
  const setFeeCollectorTx = await schrodingerBox.setFeeCollector(feeCollectorAddress);
  await setFeeCollectorTx.wait(1);
  console.log("Set fee collector on SchrodingerBox");

  // Final deployment summary
  console.log("\nDeployment complete!");
  console.log(`\nNetwork: ${network}`);
  console.log(`Chain ID (Wormhole): ${chainId}`);
  console.log(`Deploying Accounts:`);
  console.log(`- Primary (Deployer): ${deployer.address}`);
  console.log(`- Secondary: ${secondAccount.address}`);
  console.log(`\nDeployed Contracts:`);
  console.log(`SchrodingerBox: ${schrodingerBoxAddress}`);
  console.log(`FeeCollector: ${feeCollectorAddress}`);
  console.log(`ParadoxToken: ${paradoxTokenAddress}`);
  console.log(`SchrodingerCatNFT: ${schrodingerCatNFTAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment error:", error);
    console.error("Error details:", error.stack);
    process.exit(1);
  });