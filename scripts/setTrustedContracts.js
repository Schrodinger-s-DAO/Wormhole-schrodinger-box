// scripts/setTrustedContracts.js
require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  // Ottieni gli argomenti dalla riga di comando
  const networkName = process.env.HARDHAT_NETWORK || "holesky";
  
  // Determina la rete di destinazione
  let targetNetwork;
  let sourceChainId;
  let targetChainId;
  
  if (networkName.toLowerCase() === "holesky") {
    targetNetwork = "SEPOLIA";
    sourceChainId = 10004; // Holesky Wormhole Chain ID
    targetChainId = 10002; // Sepolia Wormhole Chain ID
  } else if (networkName.toLowerCase() === "sepolia") {
    targetNetwork = "HOLESKY";
    sourceChainId = 10002; // Sepolia Wormhole Chain ID
    targetChainId = 10004; // Holesky Wormhole Chain ID
  } else {
    throw new Error(`Rete non supportata: ${networkName}`);
  }
  
  console.log(`Configurazione contratto fidato da ${networkName.toUpperCase()} a ${targetNetwork}`);
  
  // Carica gli indirizzi dai file .env
  const sourceBoxAddress = process.env[`${networkName.toUpperCase()}_SCHRODINGER_BOX_ADDRESS`];
  const targetBoxAddress = process.env[`${targetNetwork}_SCHRODINGER_BOX_ADDRESS`];
  
  if (!sourceBoxAddress || !targetBoxAddress) {
    throw new Error("Indirizzi dei contratti mancanti nel file .env");
  }
  
  console.log(`Indirizzo contratto sorgente (${networkName.toUpperCase()}): ${sourceBoxAddress}`);
  console.log(`Indirizzo contratto destinazione (${targetNetwork}): ${targetBoxAddress}`);
  
  // Ottieni un signer (account con privilegi di owner)
  const [deployer] = await ethers.getSigners();
  console.log(`Utilizzando l'account: ${deployer.address}`);
  
  // Carica il contratto SchrodingerBox
  const schrodingerBox = await ethers.getContractAt(
    "SchrodingerBox",
    sourceBoxAddress,
    deployer
  );
  
  // Converti l'indirizzo di destinazione in bytes32
  const targetAddressBytes32 = ethers.zeroPadValue(targetBoxAddress, 32);
  console.log(`Indirizzo di destinazione (bytes32): ${targetAddressBytes32}`);
  
  // Verifica se il contratto fidato è già impostato
  const currentTrustedContract = await schrodingerBox.trustedContracts(targetChainId);
  console.log(`Contratto fidato attuale per chain ${targetChainId}: ${currentTrustedContract}`);
  
  if (currentTrustedContract === targetAddressBytes32) {
    console.log("Il contratto fidato è già correttamente impostato");
    return;
  }
  
  // Imposta il contratto fidato
  console.log(`Impostazione del contratto fidato per chain ${targetChainId}...`);
  const tx = await schrodingerBox.setTrustedContract(targetChainId, targetAddressBytes32, {
    gasLimit: 200000
  });
  
  console.log(`Transazione inviata: ${tx.hash}`);
  console.log("In attesa di conferma...");
  
  // Attendi la conferma della transazione
  const receipt = await tx.wait(2);
  console.log(`Transazione confermata nel blocco: ${receipt.blockNumber}`);
  
  // Verifica che il contratto fidato sia stato impostato correttamente
  const updatedTrustedContract = await schrodingerBox.trustedContracts(targetChainId);
  console.log(`Contratto fidato aggiornato per chain ${targetChainId}: ${updatedTrustedContract}`);
  
  if (updatedTrustedContract === targetAddressBytes32) {
    console.log("Contratto fidato impostato correttamente!");
  } else {
    console.log("ERRORE: Il contratto fidato non è stato impostato correttamente");
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Errore durante l'esecuzione:", error);
    process.exit(1);
  });