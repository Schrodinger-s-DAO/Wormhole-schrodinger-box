require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  try {
    const networkName = network.name.toUpperCase();

    const paradoxTokenAddress = process.env[`${networkName}_PARADOX_TOKEN_ADDRESS`];
    if (!paradoxTokenAddress) {
      throw new Error(`Paradox Token address not found for network '${network.name}'`);
    }

    const [signer] = await ethers.getSigners();
    const paradoxToken = await ethers.getContractAt("ParadoxToken", paradoxTokenAddress, signer);

    const amount = ethers.parseEther("10000");

    await paradoxToken.mint(signer.address, amount);
    console.log("10000 tokens minted successfully");
  } catch (error) {
    console.error(error);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });