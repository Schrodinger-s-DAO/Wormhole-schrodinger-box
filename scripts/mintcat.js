// scripts/mintcat.js

require("dotenv").config();
const hre = require("hardhat");

async function main() {
  // Recuperiamo il nome della rete e convertiamo in uppercase per cercare la variabile nel .env
  const networkName = hre.network.name.toUpperCase();
  const nftAddress = process.env[`${networkName}_SCHRODINGER_CAT_NFT_ADDRESS`];

  if (!nftAddress) {
    throw new Error(`Indirizzo SchrodingerCatNFT non trovato per la rete ${hre.network.name}`);
  }

  // Otteniamo il signer (l'account predefinito)
  const [signer] = await hre.ethers.getSigners();

  // Creiamo un'istanza del contratto SchrodingerCatNFT
  const schrodingerCatNFT = await hre.ethers.getContractAt("SchrodingerCatNFT", nftAddress, signer);

  // Eseguiamo il mint passando l'indirizzo del signer come destinatario
  const tx = await schrodingerCatNFT.mint(signer.address);
  await tx.wait();

  console.log("NFT mintato con successo");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
