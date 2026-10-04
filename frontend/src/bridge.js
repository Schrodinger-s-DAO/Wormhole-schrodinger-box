import { ethers } from "ethers";
import { mailboxAbi } from "./abi.js";
import { NETWORKS, otherNetwork } from "./networks.js";
import { state, $, boxInterface, mailboxInterface, PENDING_KEY, BRIDGE_WAIT_MS, PUBLISHED_ABI, BOX_TUPLE } from "./context.js";
import { decodedReason, explain, invalid, isSponsoredRefusal } from "./errors.js";
import { flash, log, paintSteps, same, short } from "./dom.js";
import { network, provider, providerFor, refresh, requireSigner } from "./wallet.js";
import { currentBox, flightFor, paintForms, selectedItem } from "./boxes.js";
import { parseAddress, selectedId } from "./assets.js";

export function noteReceipt(receipt) {
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

export function loadPending() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePending(items) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(items));
}

export function rememberSend(mailbox, args) {
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

export function forgetSend(sourceChain, sequence) {
  const id = `${sourceChain}-${sequence}`;
  savePending(loadPending().filter((item) => item.id !== id));
  if (state.readyId === id) {
    state.readyVaa = null;
    state.readyId = null;
  }
  delete state.vaaCache[id];
}

export function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return ethers.hexlify(bytes);
}

export async function fetchVaa(entry) {
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

export async function send(txPromise) {
  const sent = await txPromise;
  log(`tx ${sent.hash}`);
  const receipt = await sent.wait();
  noteReceipt(receipt);
  return sent;
}

export async function run(label, fn) {
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

export function currentPending() {
  return state.messages;
}

export async function readBridgePayload(source, event) {
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

export function networkByWormhole(id) {
  return Object.values(NETWORKS).find((net) => net.wormholeId === Number(id)) || null;
}

export async function findMessages() {
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

export function waitCopy(item) {
  if (!item?.startedAt) return "Guardians sign after the source chain finalizes. Usually 15–20 minutes. Nothing is stuck.";
  const left = BRIDGE_WAIT_MS - (Date.now() - item.startedAt);
  if (left <= 0) return "Still waiting. Finality can run long. The box stays locked until you deliver.";
  const minutes = Math.max(1, Math.round(left / 60000));
  return `Guardians sign after the source chain finalizes. Usually 15–20 minutes. About ${minutes} ${minutes === 1 ? "minute" : "minutes"} left. Nothing is stuck.`;
}

export function stageCopy(item, signed) {
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

export function messageForHere() {
  const selected = selectedItem();
  const flight = flightFor(selected);
  if (flight?.targetKey === state.networkKey) return flight;
  if (selected) return null;
  return currentPending().find((message) => {
    if (message.targetKey !== state.networkKey || message.action === 2) return false;
    return !state.boxes.some((box) => box.original && box.id.toString() === String(message.originBoxId));
  }) || null;
}

export async function refreshDelivery() {
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

export async function simulateDeliver(vaa) {
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

export async function sendPriced(from, to, data, value, gas, gasPrice) {
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

export async function onDeliver() {
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

export async function onBridge() {
  await run("Bridge", async () => {
    const other = otherNetwork(state.networkKey);
    if (!other.contracts) throw invalid(`${other.name} has no box to receive the shadow`);
    const signer = await requireSigner();
    const box = currentBox(signer);
    const id = selectedId();
    const details = await box.getBoxDetails(id);
    const count = BigInt(details.assets.length);
    const fee = await box.getFunction("getWormholeFee(uint16,uint256)")(other.wormholeId, count);
    await send(box.bridgeBox(other.wormholeId, parseAddress($("bridge-to").value, "Receiver"), id, {
      value: fee
    }));
  });
}

export async function onReturn() {
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
    const count = BigInt(details.assets.length);
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
