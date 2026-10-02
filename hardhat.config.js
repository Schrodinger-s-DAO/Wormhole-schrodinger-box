require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const accounts = [process.env.TEST_PRIVATE_KEY1, process.env.TEST_PRIVATE_KEY2].filter(Boolean);

function remoteNetwork(urlEnv, chainId) {
  const url = process.env[urlEnv];
  if (!url) return undefined;
  return { url, accounts, chainId };
}

const networks = {};
const sepolia = remoteNetwork("SEPOLIA_RPC_URL", 11155111);
const holesky = remoteNetwork("HOLESKY_RPC_URL", 17000);
if (sepolia) networks.sepolia = sepolia;
if (holesky) networks.holesky = holesky;

const etherscanKey = process.env.ETHERSCAN_API_KEY;

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      evmVersion: "cancun"
    }
  },
  networks,
  etherscan: etherscanKey
    ? { apiKey: { sepolia: etherscanKey, holesky: etherscanKey } }
    : undefined
};