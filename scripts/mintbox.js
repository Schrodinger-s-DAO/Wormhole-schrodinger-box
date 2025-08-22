// scripts/mintbox.js

require("dotenv").config();
const hre = require("hardhat");

async function main() {
  // Recupera il nome della rete in maiuscolo per accedere alla variabile .env
  const networkName = hre.network.name.toUpperCase();
  const boxAddress = process.env[`${networkName}_SCHRODINGER_BOX_ADDRESS`];

  if (!boxAddress) {
    throw new Error(`Indirizzo SchrodingerBox non trovato per la rete ${hre.network.name}`);
  }

  // Otteniamo il signer (l'account predefinito)
  const [signer] = await hre.ethers.getSigners();

  // Creiamo l'istanza del contratto SchrodingerBox
  const schrodingerBox = await hre.ethers.getContractAt("SchrodingerBox", boxAddress, signer);

  // Invoca la funzione mintBox (ricordando che è payable, quindi se è prevista una fee, inviarla in msg.value)
  const tx = await schrodingerBox.mintBox();
  await tx.wait();

  console.log("Scatola mintata con successo");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
