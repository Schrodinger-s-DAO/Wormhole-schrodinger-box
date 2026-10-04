import { ethers } from "ethers";
import { $ , state } from "./context.js";
import { otherNetwork } from "./networks.js";
import { ensureChain, connect, refresh, switchNetwork, network } from "./wallet.js";
import { renderBoxes, syncSelection, refreshQuote } from "./boxes.js";
import { onDeliver } from "./bridge.js";
import { setMode } from "./dom.js";
import { flash } from "./dom.js";
import {
  onMintPar, onMintCat, onMintBox, onDeposit, onWithdrawToken, onDepositNft, onWithdrawNft,
  onPutPar, onSeal, onTransfer
} from "./assets.js";
import { onBridge, onReturn } from "./bridge.js";
import { onSetFee, onSetCollector, onSetTrust, onWithdrawEth, onWithdrawFeeToken } from "./admin.js";

function bind() {
  const forms = {
    "form-par": onMintPar,
    "form-cat": onMintCat,
    "form-mint": onMintBox,
    "form-deposit": onDeposit,
    "form-withdraw-token": onWithdrawToken,
    "form-deposit-nft": onDepositNft,
    "form-withdraw-nft": onWithdrawNft,
    "form-put-par": onPutPar,
    "form-seal": onSeal,
    "form-transfer": onTransfer,
    "form-bridge": onBridge,
    "form-return": onReturn,
    "form-fee": onSetFee,
    "form-collector": onSetCollector,
    "form-trust": onSetTrust,
    "form-withdraw-eth": onWithdrawEth,
    "form-fc-token": onWithdrawFeeToken
  };
  for (const [id, handler] of Object.entries(forms)) {
    $(id).addEventListener("submit", (event) => {
      event.preventDefault();
      handler();
    });
  }
  $("btn-connect").addEventListener("click", connect);
  $("btn-switch").addEventListener("click", () => ensureChain(network()).then(refresh));
  $("btn-refresh").addEventListener("click", refresh);
  $("btn-me").addEventListener("click", () => {
    if (!state.account) {
      flash("Connect a wallet first", "bad");
      return;
    }
    $("transfer-to").value = state.account;
    $("bridge-to").value = state.account;
  });
  $("btn-max").addEventListener("click", () => {
    $("dep-amount").value = ethers.formatUnits(state.parBalance, 18);
  });
  $("btn-par-all").addEventListener("click", () => {
    $("par-amount").value = ethers.formatUnits(state.parBalance, 18);
  });
  $("btn-put-par-all").addEventListener("click", () => {
    $("put-par-amount").value = ethers.formatUnits(state.parBalance, 18);
  });
  $("btn-deliver").addEventListener("click", onDeliver);
  $("btn-trust-peer").addEventListener("click", () => {
    const other = otherNetwork(state.networkKey);
    $("trust-chain").value = String(other.wormholeId);
    if (!other.contracts) {
      flash(`${other.name} has no box to trust yet`, "bad");
      return;
    }
    $("trust-addr").value = other.contracts.box;
  });
  $("filter-mine").addEventListener("click", () => {
    state.boxScope = "mine";
    renderBoxes();
  });
  $("filter-all").addEventListener("click", () => {
    state.boxScope = "all";
    renderBoxes();
  });
  $("chain-sepolia").addEventListener("click", () => switchNetwork("sepolia"));
  $("chain-base").addEventListener("click", () => switchNetwork("base"));
  $("tab-use").addEventListener("click", () => setMode("use"));
  $("tab-admin").addEventListener("click", () => setMode("admin"));
  $("box-id").addEventListener("input", () => {
    syncSelection();
    refreshQuote();
  });
  if (window.ethereum) {
    window.ethereum.on?.("accountsChanged", (accounts) => {
      state.account = accounts[0] || null;
      refresh();
    });
    window.ethereum.on?.("chainChanged", () => refresh());
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
}

bind();
refresh();
setInterval(refresh, 8000);
