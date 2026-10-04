import { ethers } from "ethers";
import { boxAbi } from "./abi.js";
import { NETWORKS, otherNetwork } from "./networks.js";
import { state, $ } from "./context.js";
import { invalid } from "./errors.js";
import { el, formatAmount, paintScope, same, setMode, short } from "./dom.js";
import { network, provider, providerFor, refresh } from "./wallet.js";
import { currentPending } from "./bridge.js";
import { takeNft, takeToken } from "./assets.js";

export function boxAt(address, runner = provider()) {
  return new ethers.Contract(address, boxAbi, runner);
}

export function currentBox(runner) {
  return boxAt(network().contracts.box, runner);
}

export async function refreshBoxes() {
  const box = currentBox();
  const supply = await box.totalSupply();
  const items = [];
  for (let index = 0n; index < supply; index++) {
    const id = await box.tokenByIndex(index);
    const [owner, details] = await Promise.all([box.ownerOf(id), box.getBoxDetails(id)]);
    items.push({
      id,
      owner,
      locked: details.isLocked,
      original: details.isOriginal,
      originChain: Number(details.originChain),
      originBoxId: details.originBoxId,
      tokens: details.assets.filter((asset) => Number(asset.assetType) === 0).map((asset) => ({ address: asset.contractAddress, amount: asset.amount })),
      nfts: details.assets.filter((asset) => Number(asset.assetType) === 1).map((asset) => ({
        contract: asset.contractAddress,
        id: asset.tokenId.toString()
      })),
      sealed: null,
      sealState: null
    });
  }
  await Promise.all(items.map(async (item) => {
    try {
      const [sealed, sealState] = await Promise.all([
        box.isSealed(item.id),
        box.sealState(item.id)
      ]);
      item.sealed = sealed;
      item.sealState = sealState;
    } catch {
      item.sealed = null;
    }
  }));
  const lockedIds = items.filter((item) => item.original && item.locked).map((item) => item.id);
  const targets = await shadowTargets(lockedIds);
  for (const item of items) {
    if (item.original && item.locked) item.target = targets.get(item.id.toString()) || null;
  }
  const rank = (item) => {
    if (item.original && item.locked) return 1;
    if (same(item.owner, state.account)) return 0;
    return 2;
  };
  items.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.id > b.id ? -1 : 1;
  });
  state.boxes = items;
  renderBoxes();
  await refreshQuote();
}

export function tokenLabel(address) {
  const known = Object.values(NETWORKS).some((net) => same(net.contracts?.paradox, address));
  if (known) return "PAR";
  return short(address);
}

export function nftLabel(address) {
  const known = Object.values(NETWORKS).some((net) => same(net.contracts?.cat, address));
  if (known) return "Cat";
  return short(address);
}

export function chainName(wormholeId) {
  return Object.values(NETWORKS).find((item) => item.wormholeId === wormholeId)?.name || `chain ${wormholeId}`;
}

export function otherSideText(item) {
  if (!item.original) return `Home is ${chainName(item.originChain)} · original #${item.originBoxId}`;
  const flight = flightFor(item);
  if (flight) return `Going to ${NETWORKS[flight.targetKey].name}`;
  if (item.locked) return `Shadow on ${otherNetwork(state.networkKey).name}`;
  return "";
}

export function flightFor(item) {
  if (!item) return null;
  const originId = item.original ? item.id.toString() : item.originBoxId.toString();
  return currentPending().find((message) => message.originBoxId === originId) || null;
}

export function statusLine(item, detailed) {
  const flight = flightFor(item);
  if (flight) {
    const from = NETWORKS[flight.sourceKey].name;
    const to = NETWORKS[flight.targetKey].name;
    const line = `Bridging from ${from} to ${to}`;
    if (detailed && flight.targetKey !== state.networkKey) return `${line}. Deliver it on ${to}.`;
    return line;
  }
  if (!item.original) return `Shadow of original #${item.originBoxId} on ${chainName(item.originChain)}`;
  if (item.locked) return `Locked on ${network().name}`;
  if (item.sealed) return `Sealed on ${network().name}`;
  return `Open on ${network().name}`;
}

export function ownerText(item) {
  if (item.original && item.locked) {
    const address = receiverFor(item);
    return address ? `Owned by ${address}` : "Owned by this contract until the shadow comes home";
  }
  if (same(item.owner, state.account)) return "Owned by you";
  if (same(item.owner, network().contracts.box)) return "Owned by this contract";
  return `Owned by ${item.owner}`;
}

export function receiverFor(item) {
  const originId = item.id.toString();
  const message = currentPending().find((entry) => entry.originBoxId === originId && entry.receiver);
  return item.target || message?.receiver || null;
}

export function insideText(item) {
  const parts = [
    ...item.tokens.map((token) => `${tokenLabel(token.address)} ${formatAmount(token.amount)}`),
    ...item.nfts.map((nft) => `${nftLabel(nft.contract)} #${nft.id}`)
  ];
  return parts.length ? parts.join(", ") : "Empty";
}

export async function shadowTargets(originIds) {
  const found = new Map();
  const other = otherNetwork(state.networkKey);
  if (!other.contracts || originIds.length === 0) return found;
  try {
    const box = new ethers.Contract(other.contracts.box, boxAbi, providerFor(other));
    const supply = await box.totalSupply();
    const wanted = new Set(originIds.map((id) => id.toString()));
    const here = network().wormholeId;
    for (let index = 0n; index < supply; index++) {
      const id = await box.tokenByIndex(index);
      const details = await box.getBoxDetails(id);
      if (details.isOriginal || Number(details.originChain) !== here) continue;
      const originId = details.originBoxId.toString();
      if (!wanted.has(originId)) continue;
      found.set(originId, await box.ownerOf(id));
    }
  } catch {
    /* The other chain can be read on the next refresh. */
  }
  return found;
}

export function visibleBoxes() {
  if (state.boxScope === "all") return state.boxes;
  return state.boxes.filter((item) => same(item.owner, state.account) || (item.original && item.locked));
}

export function renderBoxes() {
  const host = $("box-list");
  host.replaceChildren();
  paintScope();
  const visible = visibleBoxes();
  const raw = $("box-id").value.trim();
  if (!visible.some((item) => item.id.toString() === raw)) {
    const pick = visible.find((item) => same(item.owner, state.account) && (item.original ? !item.locked : true)) || null;
    $("box-id").value = pick ? pick.id.toString() : "";
  }
  if (state.boxes.length === 0) {
    host.append(el("p", "hint", "No boxes on this network yet."));
    syncSelection();
    return;
  }
  if (visible.length === 0) {
    host.append(el("p", "hint", "Nothing in this wallet. Mint a box, or show all."));
    syncSelection();
    return;
  }
  const selected = $("box-id").value.trim();
  let group = "";
  for (const item of visible) {
    const mine = same(item.owner, state.account);
    const next = item.original && item.locked ? "Locked" : mine ? "Yours" : "Others";
    if (next !== group) {
      group = next;
      host.append(el("h3", "", group));
    }
    const card = el("button", "box");
    card.type = "button";
    if (item.id.toString() === selected) card.classList.add("on");
    const head = el("div", "row");
    head.append(el("span", "id", `#${item.id}`), el("span", `tag ${tagKind(item)}`, tagText(item)));
    card.append(head);
    card.append(el("div", "", statusLine(item)));
    const side = otherSideText(item);
    if (side && !flightFor(item)) card.append(el("div", "hint", side));
    const owned = item.original && item.locked ? receiverFor(item) : item.owner;
    const open = state.openAddress === item.id.toString();
    const shown = !owned ? "this contract" : open ? owned : (same(owned, state.account) ? "you" : short(owned));
    const line = el("div", owned ? "addr" : "", `Owned by ${shown}`);
    if (owned) {
      line.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.openAddress = open ? null : item.id.toString();
        renderBoxes();
      });
    }
    card.append(line);
    card.addEventListener("click", () => selectBox(item));
    host.append(card);
  }
  syncSelection();
}

export function tagKind(item) {
  if (!item.original) return "shadow";
  return item.locked ? "locked" : "alive";
}

export function tagText(item) {
  if (!item.original) return "shadow";
  return item.locked ? "locked" : "original";
}

export function selectBox(item) {
  $("box-id").value = item.id.toString();
  if (item.tokens[0]) $("wd-token").value = item.tokens[0].address;
  if (item.nfts[0]) {
    $("wd-nft").value = item.nfts[0].contract;
    $("wd-nft-id").value = item.nfts[0].id;
  }
  renderBoxes();
}

export function syncSelection() {
  const hint = $("selected-hint");
  const raw = $("box-id").value.trim();
  const item = state.boxes.find((box) => box.id.toString() === raw);
  const title = $("box-title");
  const owner = $("box-owner");
  const label = $("contents-label");
  if (!item) {
    if (title) title.textContent = "Select a box";
    hint.textContent = raw ? "No box with that id on this network." : "Pick a box on the left.";
    const side = $("box-side");
    if (side) {
      side.hidden = true;
      side.textContent = "";
    }
    owner.textContent = "";
    if (label) label.hidden = true;
    renderContents();
    paintForms();
    return;
  }
  if (title) title.textContent = `Box #${item.id}`;
  hint.textContent = statusLine(item, true);
  const side = $("box-side");
  const extra = otherSideText(item);
  if (side) {
    const show = Boolean(extra) && !flightFor(item);
    side.hidden = !show;
    side.textContent = show ? extra : "";
  }
  owner.textContent = ownerText(item);
  if (label) label.hidden = false;
  renderContents();
  paintForms();
}

export function paintForms() {
  const item = selectedItem();
  const openMine = Boolean(item && item.original && !item.locked && same(item.owner, state.account));
  const shadowMine = Boolean(item && !item.original && same(item.owner, state.account));
  const yours = openMine || shadowMine;
  const sealed = Boolean(openMine && item.sealed);
  $("fill-tools").hidden = !openMine || sealed;
  $("more-assets").hidden = !openMine || sealed;
  $("form-return").hidden = !shadowMine;
  $("form-transfer").hidden = !yours;
  const sealForm = $("form-seal");
  if (openMine && item.sealed !== null) {
    sealForm.hidden = false;
    $("seal-hint").textContent = sealed
      ? "Sealed. Nothing can be added or removed until you open it. Listing it in a trade keeps this seal."
      : "Seal it before you list this box in a trade. A deposit or a withdrawal has to wait until it is open.";
    $("seal-submit").textContent = sealed ? "Unseal" : "Seal this box";
  } else {
    sealForm.hidden = true;
  }
  if (yours) {
    $("transfer-title").textContent = shadowMine ? "Move the shadow" : "Move this box";
    $("transfer-hint").textContent = shadowMine
      ? "The wallet that holds this shadow receives the original when it comes home."
      : "Sends this folder to another wallet on this chain. Nothing is bridged.";
    $("transfer-submit").textContent = shadowMine ? "Send shadow" : "Send box";
  }
  const foreign = $("box-foreign");
  if (!item || yours) {
    foreign.hidden = true;
  } else if (item.original && item.locked) {
    foreign.hidden = false;
    foreign.textContent = "This box is locked. It unlocks for whoever destroys the shadow.";
  } else {
    foreign.hidden = false;
    foreign.textContent = "This box is not yours.";
  }
}

export function selectedItem() {
  const raw = $("box-id").value.trim();
  return state.boxes.find((box) => box.id.toString() === raw) || null;
}

export function renderContents() {
  const host = $("contents");
  host.replaceChildren();
  const raw = $("box-id").value.trim();
  const item = state.boxes.find((box) => box.id.toString() === raw);
  if (!item) return;
  host.append(el("p", "hint", insideText(item)));
  const canOpen = item.original && !item.locked && same(item.owner, state.account);
  if (!canOpen) return;
  for (const token of item.tokens) {
    const label = `${tokenLabel(token.address)} ${formatAmount(token.amount)}`;
    host.append(takeButton(`Take out ${label}`, () => takeToken(item.id, token.address)));
  }
  for (const nft of item.nfts) {
    const label = `${nftLabel(nft.contract)} #${nft.id}`;
    host.append(takeButton(`Take out ${label}`, () => takeNft(item.id, nft.contract, nft.id)));
  }
}

export function takeButton(text, action) {
  const button = el("button", "out", text);
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}

export function ensureOpenBox() {
  const raw = $("box-id").value.trim();
  if (raw) {
    const item = state.boxes.find((box) => box.id.toString() === raw);
    if (!item) throw invalid("That box is not on this network");
    if (!same(item.owner, state.account)) throw invalid("That box is in another wallet");
    if (!item.original || item.locked) throw invalid("Pick an open original box");
    return item.id;
  }
  const mine = state.boxes.find((box) => same(box.owner, state.account) && box.original && !box.locked);
  if (!mine) throw invalid("Mint a box first");
  $("box-id").value = mine.id.toString();
  renderBoxes();
  return mine.id;
}

export async function refreshQuote() {
  const raw = $("box-id").value.trim();
  const item = state.boxes.find((box) => box.id.toString() === raw);
  const count = item ? BigInt(item.tokens.length + item.nfts.length) : 0n;
  try {
    const fee = await currentBox().getFunction("getWormholeFee(uint16,uint256)")(otherNetwork(state.networkKey).wormholeId, count);
    const text = `${formatAmount(fee)} ETH`;
    $("bridge-fee").textContent = text;
    $("return-fee").textContent = text;
  } catch {
    $("bridge-fee").textContent = "unavailable";
    $("return-fee").textContent = "unavailable";
  }
}

export async function refreshOwner() {
  const box = currentBox();
  const [owner, collector, balance] = await Promise.all([
    box.owner(),
    box.feeCollector(),
    provider().getBalance(network().contracts.feeCollector)
  ]);
  const you = same(owner, state.account);
  $("tab-admin").hidden = !you;
  if (!you && state.mode === "admin") setMode("use");
  $("owner-line").textContent = you ? `Owner ${owner}. This wallet is the owner.` : `Owner ${owner}. This wallet is not the owner.`;
  $("fc-line").textContent = collector;
  $("fc-balance").textContent = formatAmount(balance);
}
