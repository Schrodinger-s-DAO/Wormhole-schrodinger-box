import live from "./live.json";

export const NETWORKS = {
  sepolia: {
    key: "sepolia",
    name: "Ethereum Sepolia",
    chainId: 11155111,
    hex: "0xaa36a7",
    wormholeId: 10002,
    rpc: "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io",
    contracts: live.sepolia
  },
  base: {
    key: "base",
    name: "Base Sepolia",
    chainId: 84532,
    hex: "0x14a34",
    wormholeId: 10004,
    rpc: "https://base-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.basescan.org",
    contracts: live.base
  }
};

export function otherNetwork(key) {
  return NETWORKS[key === "sepolia" ? "base" : "sepolia"];
}
