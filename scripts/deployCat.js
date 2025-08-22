// scripts/deployCat.js
const hre = require("hardhat");

async function main() {
  console.log("Avvio deploy del contratto SchrodingerCatNFT...");

  // Ottieni l'account che eseguirà il deploy
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  
  // Ottieni il bilancio dell'account
  const balance = await deployer.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");
  
  // Ottieni il factory del contratto
  const SchrodingerCatNFT = await hre.ethers.getContractFactory("SchrodingerCatNFT");
  
  // Deploy del contratto
  console.log("Deploying SchrodingerCatNFT...");
  const catNFT = await SchrodingerCatNFT.deploy();
  
  // Attendi che il deploy sia completato
  await catNFT.waitForDeployment();
  
  // Ottieni l'indirizzo del contratto deployato
  const catNFTAddress = await catNFT.getAddress();
  console.log("SchrodingerCatNFT deployato all'indirizzo:", catNFTAddress);
  
  // Informazioni sulla rete utilizzata
  const network = await hre.ethers.provider.getNetwork();
  console.log("Rete utilizzata:", network.name);
  
  console.log("Deploy completato con successo!");
  
  // Suggerimento per aggiornare il file .env
  console.log("\nAggiorna il tuo file .env con il nuovo indirizzo:");
  console.log(`${network.name.toUpperCase()}_SCHRODINGER_CAT_NFT_ADDRESS=${catNFTAddress}`);
  
  // Verifica del contratto (opzionale)
  console.log("\nPer verificare il contratto su Etherscan, esegui:");
  console.log(`npx hardhat verify --network ${network.name} ${catNFTAddress}`);
}

// Esecuzione della funzione main e gestione errori
main().catch((error) => {
  console.error("Errore durante il deploy:", error);
  process.exitCode = 1;
});