import { ethers } from "ethers";
import { boxAbi, erc20Abi, feeAbi, mailboxAbi, nftAbi } from "./abi.js";
import { NETWORKS, otherNetwork } from "./networks.js";

const ERRORS = {
  NotBoxOwner: "Only the box owner can do that",
  BoxLocked: "This box is locked in a bridge",
  BoxNotLocked: "The original is already unlocked",
  InsufficientBalance: "That asset is not in the box",
  InsufficientMintingFee: "Not enough ETH for the mint fee",
  InsufficientWormholeFee: "Not enough ETH for the Wormhole fee",
  FeeSendFailed: "The fee transfer failed",
  UntrustedSource: "The message came from an untrusted box",
  NotOriginalBox: "This is a shadow. Use the original",
  NotShadowBox: "This is an original. Use the shadow",
  InvalidTargetChain: "That chain is not trusted yet",
  InvalidAddress: "That address is invalid",
  NotWormholeRelayer: "Only the mailbox can deliver",
  OnlyBox: "Only the box can publish",
  UntrustedEmitter: "That message is not from the other mailbox",
  AlreadyDelivered: "That message was already delivered",
  InvalidVaa: "Wormhole rejected the signed message",
  UnexpectedTarget: "The message is for a different box",
  WrongTargetChain: "That message belongs on the other chain",
  FeeTooLow: "Not enough ETH for the Wormhole publish fee",
  BoxUnset: "The mailbox is not connected to a box",
  RefundFailed: "Could not return the extra ETH",
  MessageAlreadyProcessed: "That message was already delivered",
  ArrayLengthMismatch: "The box asset lists do not match",
  BridgeFailed: "Wormhole rejected the send",
  ZeroAmount: "Amount is zero",
  TooManyAssets: "This box already holds 20 of that kind",
  DuplicateAsset: "That NFT is already in the box",
  AssetNotReceived: "The NFT never arrived",
  UnknownAction: "Unknown bridge action",
  OwnableUnauthorizedAccount: "Only the owner can do that",
  ERC721InsufficientApproval: "Approve the NFT first",
  ERC20InsufficientAllowance: "Approve the token first",
  ERC20InsufficientBalance: "Token balance is too low",
  ERC721NonexistentToken: "That box or NFT is already gone"
};

const boxInterface = new ethers.Interface(boxAbi);
const mailboxInterface = new ethers.Interface(mailboxAbi);
const parsers = [boxAbi, erc20Abi, nftAbi, feeAbi, mailboxAbi].map((abi) => new ethers.Interface(abi));

const state = {
  networkKey: "sepolia",
  mode: "use",
  account: null,
  walletChainId: null,
  boxes: [],
  cats: [],
  parBalance: 0n,
  ethBalance: null,
  readyVaa: null,
  readyId: null,
  busy: false,
  refreshing: false,
  refreshQueued: false,
  boxScope: "mine",
  messages: [],
  vaaCache: {},
  openAddress: null,
  providers: {}
};

const $ = (id) => document.getElementById(id);

function network() {
  return NETWORKS[state.networkKey];
}

function providerFor(net) {
  if (!state.providers[net.key]) {
    state.providers[net.key] = new ethers.JsonRpcProvider(net.rpc, net.chainId);
  }
  return state.providers[net.key];
}

function provider() {
  return providerFor(network());
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function short(address) {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function same(a, b) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function formatAmount(value, decimals = 18) {
  const raw = ethers.formatUnits(value, decimals);
  const negative = raw.startsWith("-");
  const [whole, frac = ""] = raw.replace("-", "").split(".");
  const wholeFmt = BigInt(whole || "0").toLocaleString("en-US");
  const trimmed = frac.replace(/0+$/, "").slice(0, 4);
  const shown = trimmed ? `${wholeFmt}.${trimmed}` : wholeFmt;
  return negative ? `-${shown}` : shown;
}

function invalid(message) {
  const error = new Error(message);
  error.validation = true;
  return error;
}

function findRevertData(error) {
  const seen = new Set();
  const queue = [error];
  while (queue.length && seen.size < 40) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (typeof current.data === "string" && current.data.startsWith("0x") && current.data.length >= 10) {
      return current.data;
    }
    if (current.data && typeof current.data === "object") queue.push(current.data);
    queue.push(current.error, current.info, current.cause, current.revert);
  }
  return null;
}

function walletReason(error) {
  const found = [];
  const seen = new Set();
  const walk = (value, depth) => {
    if (value == null || depth > 5) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text || text.length > 400 || /^0x[0-9a-f]{20,}$/i.test(text)) return;
      if (/could not coalesce|^unknown_error$|^eth_|^[A-Z0-9_]+$/i.test(text)) return;
      if (!found.includes(text)) found.push(text);
      try {
        walk(JSON.parse(text), depth + 1);
      } catch {
        /* not JSON */
      }
      return;
    }
    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    for (const key of Object.keys(value)) {
      if (key === "stack") continue;
      walk(value[key], depth + 1);
    }
  };
  walk(error, 0);
  const useful = found.filter((line) => !/^internal json-rpc error\.?$/i.test(line) && !/missing revert data|could not coalesce/i.test(line));
  const picked = useful.find((line) => /insufficient funds|revert|denied|rejected|nonce|underpriced|gas/i.test(line)) || useful[0] || null;
  if (!picked) return null;
  if (/insufficient funds/i.test(picked)) return `This wallet does not have enough ETH on ${network().name} for gas.`;
  if (/user rejected|user denied/i.test(picked)) return "Rejected in the wallet";
  return picked.replace(/^execution reverted:?\s*/i, "").slice(0, 280);
}

function explain(error) {
  if (!error) return "Unknown error";
  if (error.validation) return error.message;
  const code = error.code || error.info?.error?.code || error.error?.code;
  if (code === "ACTION_REJECTED" || code === 4001) return "Rejected in the wallet";
  if (error.revert?.name) return ERRORS[error.revert.name] || error.revert.name;
  const data = findRevertData(error);
  if (data) {
    for (const parser of parsers) {
      try {
        const parsed = parser.parseError(data);
        if (parsed) return ERRORS[parsed.name] || parsed.name;
      } catch {
        /* next ABI */
      }
    }
  }
  const nested = walletReason(error);
  if (nested) return nested;
  const message = error.shortMessage || error.reason || error.message || String(error);
  if (/insufficient funds/i.test(message)) return `This wallet does not have enough ETH on ${network().name} for gas.`;
  if (/could not coalesce|missing revert data/i.test(message)) return "The wallet refused the transaction before it opened.";
  return message.replace(/^execution reverted:?\s*/i, "").slice(0, 280);
}

function log(message, kind) {
  const item = el("li", kind || "", `${new Date().toLocaleTimeString("en-GB")}  ${message}`);
  const list = $("log");
  list.append(item);
  while (list.children.length > 30) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
}

function flash(message, kind) {
  const node = $("flash");
  node.textContent = message || "";
  node.className = `flash${kind ? ` ${kind}` : ""}`;
}

function boxAt(address, runner = provider()) {
  return new ethers.Contract(address, boxAbi, runner);
}

function currentBox(runner) {
  return boxAt(network().contracts.box, runner);
}

async function requireSigner() {
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

function parseId(value, label) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) throw invalid(`${label} must be a number`);
  return BigInt(raw);
}

function parseAddress(value, label) {
  try {
    return ethers.getAddress(String(value).trim());
  } catch {
    throw invalid(`${label} is not an address`);
  }
}

function parseEth(id) {
  const raw = $(id).value.trim();
  if (!raw) return 0n;
  try {
    return ethers.parseEther(raw);
  } catch {
    throw invalid("ETH amount is invalid");
  }
}

function selectedId() {
  return parseId($("box-id").value, "Box id");
}

async function tokenDecimals(token) {
  try {
    return await new ethers.Contract(token, erc20Abi, provider()).decimals();
  } catch {
    return 18;
  }
}

function noteReceipt(receipt) {
  for (const entry of receipt.logs) {
    let parsed = null;
    try {
      parsed = boxInterface.parseLog(entry);
    } catch {
      parsed = null;
    }
    if (parsed) {
      if (parsed.name === "BoxMinted" || parsed.name === "BoxReceived") {
        $("box-id").value = parsed.args.boxId.toString();
      }
      if (parsed.name === "BoxMinted") log(`Minted box #${parsed.args.boxId}`, "ok");
      if (parsed.name === "BoxReceived") log(`Box #${parsed.args.boxId} received by ${short(parsed.args.receiver)}`, "ok");
      if (parsed.name === "BoxBridged") log(`Box #${parsed.args.boxId} locked on this chain`, "ok");
      if (parsed.name === "ShadowBoxReturned") log(`Shadow #${parsed.args.boxId} burned on this chain`, "ok");
      continue;
    }
    let mail = null;
    try {
      mail = mailboxInterface.parseLog(entry);
    } catch {
      mail = null;
    }
    if (!mail) continue;
    if (mail.name === "Published") {
      rememberSend(entry.address, mail.args);
      log(`Wormhole sequence ${mail.args.sequence}. Deliver it on ${otherNetwork(state.networkKey).name} after the guardians sign`, "ok");
    }
    if (mail.name === "Delivered") {
      forgetSend(Number(mail.args.sourceChain), mail.args.sequence.toString());
      log(`Delivered sequence ${mail.args.sequence}`, "ok");
    }
  }
}

const PENDING_KEY = "sb-pending-v1";

function loadPending() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePending(items) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(items));
}

function rememberSend(mailbox, args) {
  const current = network();
  const entry = {
    id: `${current.wormholeId}-${args.sequence}`,
    sourceKey: current.key,
    targetKey: otherNetwork(current.key).key,
    sourceChain: current.wormholeId,
    sequence: args.sequence.toString(),
    emitter: mailbox,
    startedAt: Date.now()
  };
  savePending(loadPending().filter((item) => item.id !== entry.id).concat(entry));
}

function forgetSend(sourceChain, sequence) {
  const id = `${sourceChain}-${sequence}`;
  savePending(loadPending().filter((item) => item.id !== id));
  if (state.readyId === id) {
    state.readyVaa = null;
    state.readyId = null;
  }
  delete state.vaaCache[id];
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return ethers.hexlify(bytes);
}

async function fetchVaa(entry) {
  const emitter = ethers.zeroPadValue(entry.emitter, 32).slice(2);
  const root = import.meta.env.DEV ? "/wormhole" : "https://api.testnet.wormholescan.io";
  const paths = [
    `${root}/api/v1/vaas/${entry.sourceChain}/${emitter}/${entry.sequence}`,
    `${root}/v1/signed_vaa/${entry.sourceChain}/${emitter}/${entry.sequence}`
  ];
  for (const path of paths) {
    try {
      const response = await fetch(path, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      const body = await response.json();
      const encoded = body?.data?.vaa || body?.vaaBytes || body?.vaa;
      if (!encoded || typeof encoded !== "string") continue;
      return encoded.startsWith("0x") ? encoded : fromBase64(encoded);
    } catch {
      /* The next endpoint may use another response shape. */
    }
  }
  return null;
}

async function send(txPromise) {
  const sent = await txPromise;
  log(`tx ${sent.hash}`);
  const receipt = await sent.wait();
  noteReceipt(receipt);
  return sent;
}

async function run(label, fn) {
  if (state.busy) return;
  state.busy = true;
  document.body.classList.add("is-busy");
  log(`${label}…`);
  flash(`${label}…`);
  try {
    await fn();
    flash(`${label} confirmed`, "ok");
    log(`${label} confirmed`, "ok");
    await refresh();
  } catch (error) {
    const message = explain(error);
    flash(message, "bad");
    log(`${label} failed · ${message}`, "bad");
  } finally {
    state.busy = false;
    document.body.classList.remove("is-busy");
  }
}

function setMode(mode) {
  state.mode = mode;
  $("use-panel").hidden = mode !== "use";
  $("admin-panel").hidden = mode !== "admin";
  $("tab-use").setAttribute("aria-selected", String(mode === "use"));
  $("tab-admin").setAttribute("aria-selected", String(mode === "admin"));
}

function showEmpty(text) {
  $("empty").hidden = false;
  $("empty").textContent = text;
  $("workspace").hidden = true;
}

function showWorkspace() {
  $("empty").hidden = true;
  $("workspace").hidden = false;
  setMode(state.mode);
}

function fillOnce(id, value) {
  const input = $(id);
  if (!input || input.dataset.filled || !value) return;
  input.value = value;
  input.dataset.filled = "1";
}

function seedAddresses() {
  const contracts = network().contracts;
  if (!contracts) return;
  for (const id of ["dep-token", "wd-token", "fc-token"]) fillOnce(id, contracts.paradox);
  for (const id of ["dep-nft", "wd-nft"]) fillOnce(id, contracts.cat);
}

async function refresh() {
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

async function refreshOnce() {
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

async function refreshWallet() {
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

function paintMismatch() {
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

function paintBanner() {
  if (!window.ethereum) return;
  if (state.account && state.walletChainId === network().chainId && state.ethBalance === 0n) {
    $("banner").hidden = false;
    $("banner").textContent = `This wallet has no ETH on ${network().name} for gas.`;
    return;
  }
  $("banner").hidden = true;
}

async function refreshChain() {
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

async function refreshBoxes() {
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
      tokens: details.erc20Tokens.map((address, i) => ({ address, amount: details.erc20Amounts[i] })),
      nfts: details.erc721Contracts.map((contract, i) => ({
        contract,
        id: details.erc721TokenIds[i].toString()
      }))
    });
  }
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

function tokenLabel(address) {
  const known = Object.values(NETWORKS).some((net) => same(net.contracts?.paradox, address));
  if (known) return "PAR";
  return short(address);
}

function nftLabel(address) {
  const known = Object.values(NETWORKS).some((net) => same(net.contracts?.cat, address));
  if (known) return "Cat";
  return short(address);
}

function chainName(wormholeId) {
  return Object.values(NETWORKS).find((item) => item.wormholeId === wormholeId)?.name || `chain ${wormholeId}`;
}

function otherSideText(item) {
  if (item.original) return `Goes to ${otherNetwork(state.networkKey).name}`;
  return `Home is ${chainName(item.originChain)} · original #${item.originBoxId}`;
}

function flightFor(item) {
  if (!item) return null;
  const originId = item.original ? item.id.toString() : item.originBoxId.toString();
  return currentPending().find((message) => message.originBoxId === originId) || null;
}

function statusLine(item, detailed) {
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
  return `Open on ${network().name}`;
}

function ownerText(item) {
  if (item.original && item.locked) {
    const address = receiverFor(item);
    return address ? `Owned by ${address}` : "Owned by this contract until the shadow comes home";
  }
  if (same(item.owner, state.account)) return "Owned by you";
  if (same(item.owner, network().contracts.box)) return "Owned by this contract";
  return `Owned by ${item.owner}`;
}

function receiverFor(item) {
  const originId = item.id.toString();
  const message = currentPending().find((entry) => entry.originBoxId === originId && entry.receiver);
  return item.target || message?.receiver || null;
}

function insideText(item) {
  const parts = [
    ...item.tokens.map((token) => `${tokenLabel(token.address)} ${formatAmount(token.amount)}`),
    ...item.nfts.map((nft) => `${nftLabel(nft.contract)} #${nft.id}`)
  ];
  return parts.length ? parts.join(", ") : "Empty";
}

async function shadowTargets(originIds) {
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

function visibleBoxes() {
  if (state.boxScope === "all") return state.boxes;
  return state.boxes.filter((item) => same(item.owner, state.account) || (item.original && item.locked));
}

function paintScope() {
  const mine = state.boxScope !== "all";
  $("filter-mine").setAttribute("aria-selected", String(mine));
  $("filter-all").setAttribute("aria-selected", String(!mine));
  $("box-heading").textContent = mine ? "Your boxes" : "All boxes";
}

function renderBoxes() {
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

function tagKind(item) {
  if (!item.original) return "shadow";
  return item.locked ? "locked" : "alive";
}

function tagText(item) {
  if (!item.original) return "shadow";
  return item.locked ? "locked" : "original";
}

function selectBox(item) {
  $("box-id").value = item.id.toString();
  if (item.tokens[0]) $("wd-token").value = item.tokens[0].address;
  if (item.nfts[0]) {
    $("wd-nft").value = item.nfts[0].contract;
    $("wd-nft-id").value = item.nfts[0].id;
  }
  renderBoxes();
}

function syncSelection() {
  const hint = $("selected-hint");
  const raw = $("box-id").value.trim();
  const item = state.boxes.find((box) => box.id.toString() === raw);
  const title = $("box-title");
  const owner = $("box-owner");
  const label = $("contents-label");
  if (!item) {
    if (title) title.textContent = "Select a box";
    hint.textContent = raw ? "No box with that id on this network." : "Pick a box on the left.";
    owner.textContent = "";
    if (label) label.hidden = true;
    renderContents();
    paintForms();
    return;
  }
  if (title) title.textContent = `Box #${item.id}`;
  hint.textContent = statusLine(item, true);
  owner.textContent = ownerText(item);
  if (label) label.hidden = false;
  renderContents();
  paintForms();
}

function paintForms() {
  const item = selectedItem();
  const openMine = Boolean(item && item.original && !item.locked && same(item.owner, state.account));
  const shadowMine = Boolean(item && !item.original && same(item.owner, state.account));
  const yours = openMine || shadowMine;
  $("fill-tools").hidden = !openMine;
  $("more-assets").hidden = !openMine;
  $("form-return").hidden = !shadowMine;
  $("form-transfer").hidden = !shadowMine;
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

function selectedItem() {
  const raw = $("box-id").value.trim();
  return state.boxes.find((box) => box.id.toString() === raw) || null;
}

function currentPending() {
  return state.messages;
}

const PUBLISHED_ABI = [
  "event LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)"
];
const BOX_TUPLE = "tuple(address[] erc20Tokens,uint256[] erc20Amounts,address[] erc721Contracts,uint256[] erc721TokenIds,bool isLocked,uint16 originChain,bool isOriginal,uint256 creationTime,bytes32 messageNonce,uint256 originBoxId)";

async function readBridgePayload(source, event) {
  if (!source.contracts?.core || !event.transactionHash) return {};
  try {
    const receipt = await providerFor(source).getTransactionReceipt(event.transactionHash);
    if (!receipt) return {};
    const iface = new ethers.Interface(PUBLISHED_ABI);
    const coder = ethers.AbiCoder.defaultAbiCoder();
    for (const entry of receipt.logs) {
      if (!same(entry.address, source.contracts.core)) continue;
      let parsed = null;
      try {
        parsed = iface.parseLog(entry);
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.args.sequence.toString() !== event.args.sequence.toString()) continue;
      const outer = coder.decode(["uint16", "address", "bytes", "bytes32"], parsed.args.payload);
      const inner = coder.decode(["uint8", "uint256", BOX_TUPLE, "address", "bytes32"], outer[2]);
      return { receiver: inner[3], originBoxId: inner[1].toString(), action: Number(inner[0]) };
    }
  } catch {
    return {};
  }
  return {};
}

function networkByWormhole(id) {
  return Object.values(NETWORKS).find((net) => net.wormholeId === Number(id)) || null;
}

async function findMessages() {
  const pending = [];
  const delivered = new Set();
  for (const sourceKey of Object.keys(NETWORKS)) {
    const source = NETWORKS[sourceKey];
    if (!source.contracts?.mailbox) continue;
    const sourceProvider = providerFor(source);
    let latest;
    try {
      latest = await sourceProvider.getBlockNumber();
    } catch {
      continue;
    }
    const mail = new ethers.Contract(source.contracts.mailbox, mailboxAbi, sourceProvider);
    let published = [];
    try {
      published = await mail.queryFilter(mail.filters.Published(), Math.max(0, latest - 45000));
    } catch {
      continue;
    }
    for (const event of published) {
      const target = networkByWormhole(event.args.targetChain);
      if (!target?.contracts?.mailbox) continue;
      const sequence = event.args.sequence.toString();
      const id = `${source.wormholeId}-${sequence}`;
      let done = false;
      try {
        const destProvider = providerFor(target);
        const destLatest = await destProvider.getBlockNumber();
        const dest = new ethers.Contract(target.contracts.mailbox, mailboxAbi, destProvider);
        const hits = await dest.queryFilter(
          dest.filters.Delivered(source.wormholeId, event.args.sequence),
          Math.max(0, destLatest - 45000)
        );
        done = hits.length > 0;
      } catch {
        done = false;
      }
      if (done) {
        delivered.add(id);
        continue;
      }
      let startedAt = null;
      try {
        const block = await event.getBlock();
        startedAt = Number(block.timestamp) * 1000;
      } catch {
        startedAt = null;
      }
      const saved = loadPending().find((item) => item.id === id);
      const carried = await readBridgePayload(source, event);
      pending.push({
        id,
        sourceKey,
        targetKey: target.key,
        sourceChain: source.wormholeId,
        sequence,
        emitter: source.contracts.mailbox,
        startedAt: saved?.startedAt || startedAt,
        receiver: carried.receiver || saved?.receiver || null,
        originBoxId: carried.originBoxId || saved?.originBoxId || null,
        action: carried.action ?? saved?.action ?? null
      });
    }
  }
  const seen = new Set(pending.map((item) => item.id));
  for (const item of loadPending()) {
    const source = NETWORKS[item.sourceKey];
    if (!source?.contracts?.mailbox || !same(source.contracts.mailbox, item.emitter)) continue;
    if (seen.has(item.id) || delivered.has(item.id)) continue;
    pending.push(item);
  }
  return pending;
}

const BRIDGE_WAIT_MS = 18 * 60 * 1000;

function waitCopy(item) {
  if (!item?.startedAt) return "Guardians sign after the source chain finalizes. Usually 15–20 minutes. Nothing is stuck.";
  const left = BRIDGE_WAIT_MS - (Date.now() - item.startedAt);
  if (left <= 0) return "Still waiting. Finality can run long. The box stays locked until you deliver.";
  const minutes = Math.max(1, Math.round(left / 60000));
  return `Guardians sign after the source chain finalizes. Usually 15–20 minutes. About ${minutes} ${minutes === 1 ? "minute" : "minutes"} left. Nothing is stuck.`;
}

function paintSteps(phase) {
  const steps = ["step-lock", "step-wait", "step-sign", "step-done"];
  const current = { waiting: 1, signed: 3, out: 4 }[phase] ?? -1;
  steps.forEach((id, index) => {
    const node = $(id);
    node.className = index < current ? "done" : index === current ? "now" : "";
  });
}

function stageCopy(item, signed) {
  const target = NETWORKS[item.targetKey].name;
  const home = item.action === 2;
  const fresh = item.action === 1;
  const who = item.receiver ? ` ${item.receiver}` : "";
  if (!signed) {
    if (home) return `${waitCopy(item)} The original stays locked until you deliver this message.`;
    if (fresh) return `${waitCopy(item)} The shadow does not exist until you deliver this message.`;
    return `${waitCopy(item)} Deliver it on ${target} once Wormhole has signed it.`;
  }
  if (home) return `Signed. Press Deliver. The original unlocks for${who || " the wallet that destroyed the shadow"}.`;
  if (fresh) {
    let line = `Signed. Press Deliver. That creates the shadow${who ? ` for${who}` : ""}.`;
    if (state.account && state.ethBalance === 0n) line += ` This wallet has no ETH on ${target} for gas.`;
    return line;
  }
  return `Signed. Press Deliver on ${target}.`;
}

function messageForHere() {
  const selected = selectedItem();
  const flight = flightFor(selected);
  if (flight?.targetKey === state.networkKey) return flight;
  if (selected) return null;
  return currentPending().find((message) => {
    if (message.targetKey !== state.networkKey || message.action === 2) return false;
    return !state.boxes.some((box) => box.original && box.id.toString() === String(message.originBoxId));
  }) || null;
}

function renderContents() {
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

function takeButton(text, action) {
  const button = el("button", "out", text);
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}

function ensureOpenBox() {
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

async function refreshQuote() {
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

async function refreshAssets() {
  if (!state.account || !network().contracts) {
    $("asset-eth").textContent = "—";
    $("asset-par").textContent = "—";
    $("asset-allowance").textContent = "—";
    $("cat-list").replaceChildren();
    state.parBalance = 0n;
    state.ethBalance = null;
    paintBanner();
    return;
  }
  const contracts = network().contracts;
  const token = new ethers.Contract(contracts.paradox, erc20Abi, provider());
  const cat = new ethers.Contract(contracts.cat, nftAbi, provider());
  const [eth, par, allowance, cats] = await Promise.all([
    provider().getBalance(state.account),
    token.balanceOf(state.account),
    token.allowance(state.account, contracts.box),
    ownedCats(cat, state.account)
  ]);
  state.parBalance = par;
  state.ethBalance = eth;
  state.cats = cats;
  $("asset-eth").textContent = formatAmount(eth);
  $("asset-par").textContent = formatAmount(par);
  $("asset-allowance").textContent = formatAmount(allowance);
  const chips = $("cat-list");
  chips.replaceChildren();
  for (const id of cats) {
    const chip = el("button", "", `Put cat #${id} in box`);
    chip.type = "button";
    chip.addEventListener("click", () => putCat(id));
    chips.append(chip);
  }
  if (cats.length === 0) chips.append(el("span", "hint", "No cats in this wallet. Mint one, then put it in the box."));
  paintBanner();
}

async function ownedCats(cat, account) {
  try {
    const latest = await provider().getBlockNumber();
    const from = Math.max(0, latest - 49000);
    const logs = await cat.queryFilter(cat.filters.Transfer(), from);
    const ids = [...new Set(logs.map((entry) => entry.args.tokenId.toString()))];
    const mine = [];
    for (const id of ids) {
      try {
        if (same(await cat.ownerOf(id), account)) mine.push(id);
      } catch {
        /* gone */
      }
    }
    return mine.sort((a, b) => Number(a) - Number(b));
  } catch {
    return [];
  }
}

async function refreshOwner() {
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

function paintChains() {
  $("chain-sepolia").setAttribute("aria-selected", String(state.networkKey === "sepolia"));
  $("chain-base").setAttribute("aria-selected", String(state.networkKey === "base"));
}

async function switchNetwork(key) {
  state.networkKey = key;
  $("box-id").value = "";
  for (const input of document.querySelectorAll("[data-filled]")) delete input.dataset.filled;
  paintChains();
  await refresh();
}

async function ensureChain(target) {
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

async function connect() {
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

async function onMintPar() {
  await run("Mint PAR", async () => {
    const signer = await requireSigner();
    let amount;
    try {
      amount = ethers.parseUnits($("par-amount").value.trim() || "0", 18);
    } catch {
      throw invalid("PAR amount is invalid");
    }
    if (amount === 0n) throw invalid("Amount is zero");
    const token = new ethers.Contract(network().contracts.paradox, erc20Abi, signer);
    await send(token.mint(await signer.getAddress(), amount));
  });
}

async function onMintCat() {
  await run("Mint cat", async () => {
    const signer = await requireSigner();
    const cat = new ethers.Contract(network().contracts.cat, nftAbi, signer);
    await send(cat.mint(await signer.getAddress()));
  });
}

async function onMintBox() {
  await run("Mint box", async () => {
    const signer = await requireSigner();
    const box = currentBox(signer);
    const fee = await box.mintingFee();
    await send(box.mintBox({ value: fee }));
  });
}

async function parAmount() {
  let amount;
  try {
    amount = ethers.parseUnits($("par-amount").value.trim() || "0", 18);
  } catch {
    throw invalid("PAR amount is invalid");
  }
  if (amount === 0n) throw invalid("Amount is zero");
  return amount;
}

async function onPutPar() {
  await run("Put PAR in box", async () => {
    const signer = await requireSigner();
    const boxId = ensureOpenBox();
    const amount = await parAmount();
    const token = new ethers.Contract(network().contracts.paradox, erc20Abi, signer);
    const owner = await signer.getAddress();
    if (await token.balanceOf(owner) < amount) throw invalid("Not enough PAR. Mint some first");
    if (await token.allowance(owner, network().contracts.box) < amount) {
      await send(token.approve(network().contracts.box, ethers.MaxUint256));
    }
    await send(currentBox(signer).depositERC20(boxId, network().contracts.paradox, amount));
  });
}

async function putCat(id) {
  await run(`Put cat #${id} in box`, async () => {
    const signer = await requireSigner();
    const boxId = ensureOpenBox();
    const nftAddress = network().contracts.cat;
    const nft = new ethers.Contract(nftAddress, nftAbi, signer);
    const owner = await signer.getAddress();
    if (!same(await nft.ownerOf(id), owner)) throw invalid("That cat is not in this wallet");
    const approvedForAll = await nft.isApprovedForAll(owner, network().contracts.box);
    let approved = ethers.ZeroAddress;
    try {
      approved = await nft.getApproved(id);
    } catch {
      approved = ethers.ZeroAddress;
    }
    if (!approvedForAll && !same(approved, network().contracts.box)) {
      await send(nft.setApprovalForAll(network().contracts.box, true));
    }
    await send(currentBox(signer).depositNFT(boxId, nftAddress, id));
  });
}

async function takeToken(boxId, token) {
  await run("Take token out", async () => {
    const signer = await requireSigner();
    await send(currentBox(signer).withdrawERC20(boxId, token));
  });
}

async function takeNft(boxId, nft, tokenId) {
  await run("Take NFT out", async () => {
    const signer = await requireSigner();
    await send(currentBox(signer).withdrawNFT(boxId, nft, tokenId));
  });
}

function decodedReason(error) {
  if (error?.revert?.name) return ERRORS[error.revert.name] || error.revert.name;
  const data = findRevertData(error);
  if (!data) return null;
  for (const parser of parsers) {
    try {
      const parsed = parser.parseError(data);
      if (!parsed) continue;
      if (parsed.name === "InvalidVaa" && parsed.args?.[0]) return `Wormhole rejected the signed message: ${parsed.args[0]}`;
      return ERRORS[parsed.name] || parsed.name;
    } catch {
      /* next ABI */
    }
  }
  return null;
}

async function refreshDelivery() {
  const incoming = $("incoming");
  const status = $("delivery-status");
  const button = $("btn-deliver");
  const item = messageForHere();
  if (!item) {
    state.readyVaa = null;
    state.readyId = null;
    button.hidden = true;
    incoming.hidden = true;
    paintForms();
    return;
  }
  incoming.hidden = false;
  const sourceName = NETWORKS[item.sourceKey].name;
  const targetName = NETWORKS[item.targetKey].name;
  $("bridge-title").textContent = `Bridging from ${sourceName} to ${targetName}`;
  $("step-done").textContent = item.action === 2 ? "Unlock the original" : "Shadow arrives";
  const vaa = state.vaaCache[item.id] || await fetchVaa(item);
  if (!vaa) {
    state.readyVaa = null;
    state.readyId = null;
    button.hidden = true;
    paintSteps("waiting");
    status.textContent = stageCopy(item, false);
    paintForms();
    return;
  }
  state.vaaCache[item.id] = vaa;
  state.readyVaa = vaa;
  state.readyId = item.id;
  button.hidden = false;
  paintSteps("signed");
  status.textContent = stageCopy(item, true);
  paintForms();
}

async function simulateDeliver(vaa) {
  const mailbox = new ethers.Contract(network().contracts.mailbox, mailboxAbi, provider());
  try {
    await mailbox.deliver.staticCall(vaa);
  } catch (error) {
    const reason = decodedReason(error);
    if (reason) throw invalid(reason);
    const raw = error.shortMessage || error.message || "";
    if (/could not coalesce|missing revert data/i.test(raw)) {
      throw invalid(`Delivery was rejected on ${network().name}, and the network did not say why.`);
    }
    throw error;
  }
}

function walletText(error) {
  return [error?.message, error?.data?.message, walletReason(error)].filter(Boolean).join(" ");
}

function isSponsoredRefusal(error) {
  return /EIP-7702|gas included|sponsored/i.test(walletText(error));
}

async function sendPriced(from, to, data, value, gas, gasPrice) {
  try {
    return await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{
        from,
        to,
        data,
        value: ethers.toQuantity(value),
        gas: ethers.toQuantity(gas),
        gasPrice: ethers.toQuantity(gasPrice)
      }]
    });
  } catch (error) {
    if (!isSponsoredRefusal(error)) throw error;
    throw invalid("MetaMask tried to sponsor the gas. Open MetaMask, Settings, Advanced, turn off Smart Transactions, then try again and pay the fee in ETH.");
  }
}

async function onDeliver() {
  await run("Deliver", async () => {
    const vaa = state.readyVaa;
    if (!vaa) throw invalid("The signed message is not here yet");
    const signer = await requireSigner();
    const from = await signer.getAddress();
    await simulateDeliver(vaa);
    const mailbox = new ethers.Contract(network().contracts.mailbox, mailboxAbi, provider());
    const gas = ((await mailbox.deliver.estimateGas(vaa, { from })) * 3n) / 2n;
    const fee = await provider().getFeeData();
    const gasPrice = fee.gasPrice ?? fee.maxFeePerGas ?? 20_000_000n;
    const balance = await provider().getBalance(from);
    const cost = gas * gasPrice;
    if (balance < cost) {
      throw invalid(`This wallet has ${ethers.formatEther(balance)} ETH on ${network().name}. Delivery needs about ${ethers.formatEther(cost)} ETH for gas.`);
    }
    const data = mailbox.interface.encodeFunctionData("deliver", [vaa]);
    const hash = await sendPriced(from, network().contracts.mailbox, data, 0n, gas, gasPrice);
    log(`tx ${hash}`);
    const receipt = await provider().waitForTransaction(hash);
    if (!receipt || receipt.status === 0) throw invalid("The delivery transaction was mined and failed.");
    noteReceipt(receipt);
  });
}

async function onDeposit() {
  await run("Deposit token", async () => {
    const signer = await requireSigner();
    const tokenAddress = parseAddress($("dep-token").value, "Token");
    const decimals = await tokenDecimals(tokenAddress);
    let amount;
    try {
      amount = ethers.parseUnits($("dep-amount").value.trim() || "0", decimals);
    } catch {
      throw invalid("Amount is invalid");
    }
    if (amount === 0n) throw invalid("Amount is zero");
    const token = new ethers.Contract(tokenAddress, erc20Abi, signer);
    const owner = await signer.getAddress();
    const allowance = await token.allowance(owner, network().contracts.box);
    if (allowance < amount) await send(token.approve(network().contracts.box, ethers.MaxUint256));
    await send(currentBox(signer).depositERC20(selectedId(), tokenAddress, amount));
  });
}

async function onWithdrawToken() {
  await run("Withdraw token", async () => {
    const signer = await requireSigner();
    await send(currentBox(signer).withdrawERC20(selectedId(), parseAddress($("wd-token").value, "Token")));
  });
}

async function onDepositNft() {
  await run("Deposit NFT", async () => {
    const signer = await requireSigner();
    const nftAddress = parseAddress($("dep-nft").value, "NFT contract");
    const tokenId = parseId($("dep-nft-id").value, "Token id");
    const nft = new ethers.Contract(nftAddress, nftAbi, signer);
    const owner = await signer.getAddress();
    const approvedForAll = await nft.isApprovedForAll(owner, network().contracts.box);
    let approved = ethers.ZeroAddress;
    try {
      approved = await nft.getApproved(tokenId);
    } catch {
      approved = ethers.ZeroAddress;
    }
    if (!approvedForAll && !same(approved, network().contracts.box)) {
      await send(nft.setApprovalForAll(network().contracts.box, true));
    }
    await send(currentBox(signer).depositNFT(selectedId(), nftAddress, tokenId));
  });
}

async function onWithdrawNft() {
  await run("Withdraw NFT", async () => {
    const signer = await requireSigner();
    await send(currentBox(signer).withdrawNFT(
      selectedId(),
      parseAddress($("wd-nft").value, "NFT contract"),
      parseId($("wd-nft-id").value, "Token id")
    ));
  });
}

async function onTransfer() {
  await run("Transfer", async () => {
    const signer = await requireSigner();
    const from = await signer.getAddress();
    await send(currentBox(signer).safeTransferFrom(from, parseAddress($("transfer-to").value, "Recipient"), selectedId()));
  });
}

async function onBridge() {
  await run("Bridge", async () => {
    const other = otherNetwork(state.networkKey);
    if (!other.contracts) throw invalid(`${other.name} has no box to receive the shadow`);
    const signer = await requireSigner();
    const box = currentBox(signer);
    const id = selectedId();
    const details = await box.getBoxDetails(id);
    const count = BigInt(details.erc20Tokens.length + details.erc721Contracts.length);
    const fee = await box.getFunction("getWormholeFee(uint16,uint256)")(other.wormholeId, count);
    await send(box.bridgeBox(other.wormholeId, parseAddress($("bridge-to").value, "Receiver"), id, {
      value: fee
    }));
  });
}

async function onReturn() {
  await run("Destroy shadow", async () => {
    const signer = await requireSigner();
    const from = await signer.getAddress();
    const id = selectedId();
    const box = currentBox(provider());
    let details;
    try {
      details = await box.getBoxDetails(id);
    } catch (error) {
      throw invalid(decodedReason(error) || "That shadow is already gone.");
    }
    if (details.isOriginal) throw invalid("Only a shadow can be destroyed.");
    const count = BigInt(details.erc20Tokens.length + details.erc721Contracts.length);
    const fee = await box.getFunction("getWormholeFee(uint16,uint256)")(Number(details.originChain), count);
    try {
      await box.returnShadowBox.staticCall(id, { from, value: fee });
    } catch (error) {
      throw invalid(decodedReason(error) || "Destroy was rejected, and the network did not say why.");
    }
    const gas = ((await box.returnShadowBox.estimateGas(id, { from, value: fee })) * 3n) / 2n;
    const feeData = await provider().getFeeData();
    const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 20_000_000n;
    const balance = await provider().getBalance(from);
    const cost = gas * gasPrice + fee;
    if (balance < cost) {
      throw invalid(`This wallet has ${ethers.formatEther(balance)} ETH on ${network().name}. Destroy needs about ${ethers.formatEther(cost)} ETH.`);
    }
    const data = box.interface.encodeFunctionData("returnShadowBox", [id]);
    const hash = await sendPriced(from, network().contracts.box, data, fee, gas, gasPrice);
    log(`tx ${hash}`);
    const receipt = await provider().waitForTransaction(hash);
    if (!receipt || receipt.status === 0) throw invalid("Destroy was mined and failed.");
    noteReceipt(receipt);
  });
}

async function onSetFee() {
  await run("Set mint fee", async () => {
    const signer = await requireSigner();
    await send(currentBox(signer).setMintingFee(parseEth("fee-input")));
  });
}

async function onSetCollector() {
  await run("Set collector", async () => {
    const signer = await requireSigner();
    await send(currentBox(signer).setFeeCollector(parseAddress($("collector-input").value, "Collector")));
  });
}

async function onSetTrust() {
  await run("Trust box", async () => {
    const signer = await requireSigner();
    const chainId = Number(parseId($("trust-chain").value, "Chain id"));
    if (chainId > 65535) throw invalid("Wormhole chain id must fit in uint16");
    const address = parseAddress($("trust-addr").value, "Box");
    await send(currentBox(signer).setTrustedContract(chainId, ethers.zeroPadValue(address, 32)));
  });
}

async function onWithdrawEth() {
  await run("Withdraw collector ETH", async () => {
    const signer = await requireSigner();
    const collector = new ethers.Contract(network().contracts.feeCollector, feeAbi, signer);
    await send(collector.withdrawETH());
  });
}

async function onWithdrawFeeToken() {
  await run("Withdraw collector token", async () => {
    const signer = await requireSigner();
    const token = parseAddress($("fc-token").value, "Token");
    const decimals = await tokenDecimals(token);
    let amount;
    try {
      amount = ethers.parseUnits($("fc-amount").value.trim() || "0", decimals);
    } catch {
      throw invalid("Amount is invalid");
    }
    if (amount === 0n) throw invalid("Amount is zero");
    const collector = new ethers.Contract(network().contracts.feeCollector, feeAbi, signer);
    await send(collector.withdrawERC20(token, amount));
  });
}

function bind() {
  const forms = {
    "form-par": onMintPar,
    "form-cat": onMintCat,
    "form-mint": onMintBox,
    "form-deposit": onDeposit,
    "form-withdraw-token": onWithdrawToken,
    "form-deposit-nft": onDepositNft,
    "form-withdraw-nft": onWithdrawNft,
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
  $("btn-put-par").addEventListener("click", onPutPar);
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
