import { ethers } from "ethers";
import { NETWORKS, otherNetwork } from "./networks.js";
import { state, $ } from "./context.js";
import { explain, invalid } from "./errors.js";
import { el, flash, formatAmount, paintBanner, paintChains, paintMismatch, seedAddresses, showEmpty, showWorkspace } from "./dom.js";
import { chainName, currentBox, refreshBoxes, refreshOwner } from "./boxes.js";
import { findMessages, refreshDelivery } from "./bridge.js";
import { refreshAssets } from "./assets.js";

export function network() {
  return NETWORKS[state.networkKey];
}

export function providerFor(net) {
  if (!state.providers[net.key]) {
    state.providers[net.key] = new ethers.JsonRpcProvider(net.rpc, net.chainId);
  }
  return state.providers[net.key];
}

export function provider() {
  return providerFor(network());
}

export async function requireSigner() {
  if (!window.ethereum) throw invalid("Install a wallet in this browser");
  if (!state.account) throw invalid("Connect the wallet in this browser");
  const browser = new ethers.BrowserProvider(window.ethereum);
  const net = await browser.getNetwork();
  if (Number(net.chainId) !== network().chainId) {
    throw invalid(`Your wallet is on another network. Switch to ${network().name}.`);
  }
  const signer = await browser.getSigner();
  const balance = await provider().getBalance(await signer.getAddress());
  if (balance === 0n) throw invalid(`This wallet has no ETH on ${network().name} for gas.`);
  return signer;
}

export async function refreshWallet() {
  if (!window.ethereum) {
    state.account = null;
    state.walletChainId = null;
    $("wallet-line").textContent = "No wallet";
    $("wallet-chain").textContent = "";
    $("banner").hidden = false;
    $("banner").textContent = "Install MetaMask, then connect.";
    paintMismatch();
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    state.account = accounts[0] || null;
    const hex = await window.ethereum.request({ method: "eth_chainId" });
    state.walletChainId = Number(hex);
  } catch {
    state.account = null;
  }
  const known = Object.values(NETWORKS).find((item) => item.chainId === state.walletChainId);
  if (!state.account) {
    $("wallet-line").textContent = "Not connected";
    $("wallet-chain").textContent = "";
  } else {
    $("wallet-line").textContent = `${state.account.slice(0, 6)}…`;
    $("wallet-chain").textContent = known ? known.name : "Unsupported network";
  }
  state.ethBalance = null;
  if (state.account && state.walletChainId === network().chainId) {
    try {
      state.ethBalance = await provider().getBalance(state.account);
    } catch {
      state.ethBalance = null;
    }
  }
  paintMismatch();
  paintBanner();
}

export async function refreshChain() {
  const current = network();
  const other = otherNetwork(current.key);
  const box = currentBox();
  const [fee, trusted] = await Promise.all([
    box.mintingFee(),
    box.trustedContracts(other.wormholeId)
  ]);
  $("mint-fee").textContent = fee === 0n ? "free" : `${formatAmount(fee)} ETH`;
  $("other-side").textContent = `Other side · ${other.name}`;
  const link = `${current.explorer}/address/${current.contracts.box}`;
  $("chain-meta").innerHTML = "";
  $("chain-meta").append(`${current.name} · ${trusted === ethers.ZeroHash ? "peer not set" : "peer connected"} · `);
  const anchor = el("a", "", "contract");
  anchor.href = link;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  $("chain-meta").append(anchor);
}

export async function connect() {
  if (!window.ethereum) {
    flash("Install a wallet in this browser", "bad");
    return;
  }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  state.account = accounts[0] || null;
  const hex = await window.ethereum.request({ method: "eth_chainId" });
  const chainId = Number(hex);
  const match = Object.values(NETWORKS).find((item) => item.chainId === chainId);
  if (match) state.networkKey = match.key;
  else await ensureChain(network());
  await refresh();
}

export async function switchNetwork(key) {
  state.networkKey = key;
  $("box-id").value = "";
  for (const input of document.querySelectorAll("[data-filled]")) delete input.dataset.filled;
  paintChains();
  await refresh();
}

export async function ensureChain(target) {
  if (!window.ethereum) {
    flash("Install a wallet in this browser", "bad");
    return;
  }
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target.hex }]
    });
  } catch (error) {
    if (error.code !== 4902) {
      flash(explain(error), "bad");
      return;
    }
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: target.hex,
        chainName: target.name,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [target.rpc],
        blockExplorerUrls: [target.explorer]
      }]
    });
  }
}

export async function refresh() {
  if (state.refreshing) {
    state.refreshQueued = true;
    return;
  }
  state.refreshing = true;
  try {
    do {
      state.refreshQueued = false;
      await refreshOnce();
    } while (state.refreshQueued);
  } catch (error) {
    console.error(error);
    $("chain-meta").textContent = "Could not read this network.";
  } finally {
    state.refreshing = false;
  }
}

export async function refreshOnce() {
  if (document.hidden) return;
  paintChains();
  await refreshWallet();
  const current = network();
  if (!current.contracts) {
    $("chain-meta").textContent = `${current.name} · Wormhole ${current.wormholeId} · no box deployed`;
    showEmpty(`${current.name} has no box yet.`);
    return;
  }
  const code = await provider().getCode(current.contracts.box);
  if (!code || code === "0x") {
    showEmpty(`${current.name} has no box contract at the saved address.`);
    return;
  }
  showWorkspace();
  seedAddresses();
  state.messages = await findMessages();
  await Promise.all([refreshChain(), refreshBoxes(), refreshAssets(), refreshOwner()]);
  await refreshDelivery();
}
