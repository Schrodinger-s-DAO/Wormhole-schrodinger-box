import { ethers } from "ethers";
import { NETWORKS } from "./networks.js";
import { state, $ } from "./context.js";
import { network } from "./wallet.js";

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function short(address) {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function same(a, b) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

export function formatAmount(value, decimals = 18) {
  const raw = ethers.formatUnits(value, decimals);
  const negative = raw.startsWith("-");
  const [whole, frac = ""] = raw.replace("-", "").split(".");
  const wholeFmt = BigInt(whole || "0").toLocaleString("en-US");
  const trimmed = frac.replace(/0+$/, "").slice(0, 4);
  const shown = trimmed ? `${wholeFmt}.${trimmed}` : wholeFmt;
  return negative ? `-${shown}` : shown;
}

export function log(message, kind) {
  const item = el("li", kind || "", `${new Date().toLocaleTimeString("en-GB")}  ${message}`);
  const list = $("log");
  list.append(item);
  while (list.children.length > 30) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
}

export function flash(message, kind) {
  const node = $("flash");
  node.textContent = message || "";
  node.className = `flash${kind ? ` ${kind}` : ""}`;
}

export function setMode(mode) {
  state.mode = mode;
  $("use-panel").hidden = mode !== "use";
  $("admin-panel").hidden = mode !== "admin";
  $("tab-use").setAttribute("aria-selected", String(mode === "use"));
  $("tab-admin").setAttribute("aria-selected", String(mode === "admin"));
}

export function showEmpty(text) {
  $("empty").hidden = false;
  $("empty").textContent = text;
  $("workspace").hidden = true;
}

export function showWorkspace() {
  $("empty").hidden = true;
  $("workspace").hidden = false;
  setMode(state.mode);
}

export function fillOnce(id, value) {
  const input = $(id);
  if (!input || input.dataset.filled || !value) return;
  input.value = value;
  input.dataset.filled = "1";
}

export function seedAddresses() {
  const contracts = network().contracts;
  if (!contracts) return;
  for (const id of ["dep-token", "wd-token", "fc-token"]) fillOnce(id, contracts.paradox);
  for (const id of ["dep-nft", "wd-nft"]) fillOnce(id, contracts.cat);
}

export function paintMismatch() {
  const wanted = network();
  const known = Object.values(NETWORKS).find((item) => item.chainId === state.walletChainId);
  const wrong = Boolean(state.account) && state.walletChainId !== wanted.chainId;
  $("mismatch").hidden = !wrong;
  const actions = $("actions");
  if (actions) actions.hidden = wrong;
  if (!wrong) return;
  $("mismatch-line").textContent = known
    ? `Your wallet is on ${known.name}.`
    : "This wallet is on a network this app does not use.";
  $("btn-switch").textContent = `Switch to ${wanted.name}`;
}

export function paintBanner() {
  if (!window.ethereum) return;
  if (state.account && state.walletChainId === network().chainId && state.ethBalance === 0n) {
    $("banner").hidden = false;
    $("banner").textContent = `This wallet has no ETH on ${network().name} for gas.`;
    return;
  }
  $("banner").hidden = true;
}

export function paintChains() {
  $("chain-sepolia").setAttribute("aria-selected", String(state.networkKey === "sepolia"));
  $("chain-base").setAttribute("aria-selected", String(state.networkKey === "base"));
}

export function paintScope() {
  const mine = state.boxScope !== "all";
  $("filter-mine").setAttribute("aria-selected", String(mine));
  $("filter-all").setAttribute("aria-selected", String(!mine));
  $("box-heading").textContent = mine ? "Your boxes" : "All boxes";
}

export function paintSteps(phase) {
  const steps = ["step-lock", "step-wait", "step-sign", "step-done"];
  const current = { waiting: 1, signed: 3, out: 4 }[phase] ?? -1;
  steps.forEach((id, index) => {
    const node = $(id);
    node.className = index < current ? "done" : index === current ? "now" : "";
  });
}
