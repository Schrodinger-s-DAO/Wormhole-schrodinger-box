require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: [
        process.env.TEST_PRIVATE_KEY1,
        process.env.TEST_PRIVATE_KEY2
      ].filter(Boolean),
      chainId: 11155111,
    },
    holesky: {
      url: process.env.HOLESKY_RPC_URL,
      accounts: [
        process.env.TEST_PRIVATE_KEY1,
        process.env.TEST_PRIVATE_KEY2
      ].filter(Boolean),
      chainId: 17000,
    }
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY,
      holesky: process.env.ETHERSCAN_API_KEY
    }
  }
};