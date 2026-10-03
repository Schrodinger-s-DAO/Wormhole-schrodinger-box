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
const baseSepolia = remoteNetwork("BASE_SEPOLIA_RPC_URL", 84532);
if (sepolia) networks.sepolia = sepolia;
if (baseSepolia) networks.baseSepolia = baseSepolia;

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
    ? { apiKey: { sepolia: etherscanKey, baseSepolia: etherscanKey } }
    : undefined
};