import { $, ERRORS, parsers } from "./context.js";
import { network } from "./wallet.js";

export function invalid(message) {
  const error = new Error(message);
  error.validation = true;
  return error;
}

export function findRevertData(error) {
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

export function walletReason(error) {
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

export function explain(error) {
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

export function decodedReason(error) {
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

export function walletText(error) {
  return [error?.message, error?.data?.message, walletReason(error)].filter(Boolean).join(" ");
}

export function isSponsoredRefusal(error) {
  return /EIP-7702|gas included|sponsored/i.test(walletText(error));
}
