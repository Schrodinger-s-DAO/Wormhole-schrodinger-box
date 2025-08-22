// scripts/redeployBox.js
require("dotenv").config();
const hre = require("hardhat");

async function main() {
  // Ottieni l'account di deployment
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  
  // Ottieni il bilancio dell'account
  const accountBalance = await deployer.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(accountBalance));
  
  // Ottieni informazioni sulla rete
  const network = hre.network.name;
  console.log(`Deploying on network: ${network}`);
  
  // Imposta gli indirizzi in base alla rete
  let wormholeRelayerAddress;
  let chainId;
  
  if (network === "sepolia") {
    wormholeRelayerAddress = process.env.WORMHOLE_RELAYER_SEPOLIA;
    chainId = 10002; // Sepolia chain ID in Wormhole
  } else if (network === "holesky") {
    wormholeRelayerAddress = process.env.WORMHOLE_RELAYER_HOLESKY;
    chainId = 10004; // Holesky chain ID in Wormhole
  } else {
    throw new Error(`Network ${network} not supported`);
  }
  
  console.log(`Using Wormhole Relayer: ${wormholeRelayerAddress}`);
  console.log(`Chain ID: ${chainId}`);
  
  // Deploy SchrodingerBox
  console.log("Deploying SchrodingerBox...");
  const SchrodingerBox = await hre.ethers.getContractFactory("SchrodingerBox");
  const schrodingerBox = await SchrodingerBox.deploy(
    wormholeRelayerAddress,
    chainId,
    deployer.address
  );
  
  await schrodingerBox.waitForDeployment();
  const schrodingerBoxAddress = await schrodingerBox.getAddress();
  console.log("SchrodingerBox deployed to:", schrodingerBoxAddress);
  
  // Se esiste un fee collector precedente, impostalo
  const oldFeeCollectorAddress = process.env[`${network.toUpperCase()}_FEE_COLLECTOR_ADDRESS`];
  if (oldFeeCollectorAddress) {
    console.log(`Setting fee collector to: ${oldFeeCollectorAddress}`);
    const tx = await schrodingerBox.setFeeCollector(oldFeeCollectorAddress);
    await tx.wait();
    console.log("Fee collector set successfully");
  }
  
  // Se esiste un contratto fidato, configuralo
  if (network === "sepolia") {
    const holeskyTrustedContract = process.env.HOLESKY_SCHRODINGER_BOX_ADDRESS;
    if (holeskyTrustedContract) {
      console.log(`Setting Holesky trusted contract: ${holeskyTrustedContract}`);
      // Converti l'indirizzo del contratto in bytes32
      const contractAsBytes32 = hre.ethers.zeroPadValue(holeskyTrustedContract, 32);
      const tx = await schrodingerBox.setTrustedContract(10004, contractAsBytes32);
      await tx.wait();
      console.log("Trusted contract set successfully");
    }
  } else if (network === "holesky") {
    const sepoliaTrustedContract = process.env.SEPOLIA_SCHRODINGER_BOX_ADDRESS;
    if (sepoliaTrustedContract) {
      console.log(`Setting Sepolia trusted contract: ${sepoliaTrustedContract}`);
      // Converti l'indirizzo del contratto in bytes32
      const contractAsBytes32 = hre.ethers.zeroPadValue(sepoliaTrustedContract, 32);
      const tx = await schrodingerBox.setTrustedContract(10002, contractAsBytes32);
      await tx.wait();
      console.log("Trusted contract set successfully");
    }
  }
  
  // Verifica che tutte le impostazioni siano corrette
  console.log("\nVerifying contract settings:");
  const feeCollector = await schrodingerBox.feeCollector();
  console.log(`Fee collector: ${feeCollector}`);
  
  const wormholeRelayer = await schrodingerBox.wormholeRelayer();
  console.log(`Wormhole relayer: ${wormholeRelayer}`);
  
  const contractChainId = await schrodingerBox.chainId();
  console.log(`Chain ID: ${contractChainId}`);
  
  const boxImageURI = await schrodingerBox.boxImageURI();
  console.log(`Box image URI: ${boxImageURI}`);
  
  // Aggiorna le variabili di ambiente (questa parte richiede l'aggiornamento manuale del file .env)
  console.log("\nPLEASE UPDATE YOUR .env FILE WITH THE FOLLOWING:");
  console.log(`${network.toUpperCase()}_SCHRODINGER_BOX_ADDRESS=${schrodingerBoxAddress}`);
  
  // Istruzioni per gli utenti
  console.log("\nSuccessfully deployed SchrodingerBox with image support!");
  console.log("Next steps:");
  console.log("1. Update your .env file with the new contract address");
  console.log("2. If deploying on the other network too, update the trusted contract settings");
  console.log("3. Run tests to verify everything is working correctly");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error during deployment:", error);
    process.exit(1);
  });