import { ethers } from "ethers";
import { erc20Abi, nftAbi } from "./abi.js";
import { state, $ } from "./context.js";
import { invalid } from "./errors.js";
import { el, formatAmount, paintBanner, same } from "./dom.js";
import { network, provider, requireSigner } from "./wallet.js";
import { currentBox, ensureOpenBox } from "./boxes.js";
import { run, send } from "./bridge.js";

export function parseId(value, label) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) throw invalid(`${label} must be a number`);
  return BigInt(raw);
}

export function parseAddress(value, label) {
  try {
    return ethers.getAddress(String(value).trim());
  } catch {
    throw invalid(`${label} is not an address`);
  }
}

export function parseEth(id) {
  const raw = $(id).value.trim();
  if (!raw) return 0n;
  try {
    return ethers.parseEther(raw);
  } catch {
    throw invalid("ETH amount is invalid");
  }
}

export function selectedId() {
  return parseId($("box-id").value, "Box id");
}

export async function tokenDecimals(token) {
  try {
    return await new ethers.Contract(token, erc20Abi, provider()).decimals();
  } catch {
    return 18;
  }
}

export async function refreshAssets() {
  if (!state.account || !network().contracts) {
    $("asset-eth").textContent = "—";
    $("asset-par").textContent = "—";
    $("put-par-balance").textContent = "—";
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
  $("put-par-balance").textContent = formatAmount(par);
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

export async function ownedCats(cat, account) {
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

export async function onMintPar() {
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

export async function onMintCat() {
  await run("Mint cat", async () => {
    const signer = await requireSigner();
    const cat = new ethers.Contract(network().contracts.cat, nftAbi, signer);
    await send(cat.mint(await signer.getAddress()));
  });
}

export async function onMintBox() {
  await run("Mint box", async () => {
    const signer = await requireSigner();
    const box = currentBox(signer);
    const fee = await box.mintingFee();
    await send(box.mintBox({ value: fee }));
  });
}

export async function parAmount() {
  let amount;
  try {
    amount = ethers.parseUnits($("put-par-amount").value.trim() || "0", 18);
  } catch {
    throw invalid("PAR amount is invalid");
  }
  if (amount === 0n) throw invalid("Amount is zero");
  return amount;
}

export async function onPutPar() {
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

export async function putCat(id) {
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

export async function takeToken(boxId, token) {
  await run("Take token out", async () => {
    const signer = await requireSigner();
    await send(currentBox(signer).withdrawERC20(boxId, token));
  });
}

export async function takeNft(boxId, nft, tokenId) {
  await run("Take NFT out", async () => {
    const signer = await requireSigner();
    await send(currentBox(signer).withdrawNFT(boxId, nft, tokenId));
  });
}

export async function onDeposit() {
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

export async function onWithdrawToken() {
  await run("Withdraw token", async () => {
    const signer = await requireSigner();
    await send(currentBox(signer).withdrawERC20(selectedId(), parseAddress($("wd-token").value, "Token")));
  });
}

const PROXY_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a618b3c30b4a7c9c00";

async function nftAccountWarning(nftAddress) {
  const notes = [];
  try {
    const slot = await provider().getStorage(nftAddress, PROXY_SLOT);
    if (slot && slot !== ethers.ZeroHash) {
      notes.push("This NFT contract looks like an EIP-1967 proxy. Its admin can change what the token does after you deposit it.");
    }
  } catch {
    /* A failed storage read is not evidence either way. */
  }
  try {
    const account = new ethers.Contract(nftAddress, ["function token() view returns (uint256,address,uint256)"], provider());
    await account.token();
    notes.push("This contract answers like an ERC-6551 account. What it holds can change without a deposit or a withdrawal.");
  } catch {
    /* Not an account. */
  }
  if (notes.length > 0) window.alert(notes.join("\n\n"));
}

export async function onDepositNft() {
  await run("Deposit NFT", async () => {
    const signer = await requireSigner();
    const nftAddress = parseAddress($("dep-nft").value, "NFT contract");
    await nftAccountWarning(nftAddress);
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

export async function onWithdrawNft() {
  await run("Withdraw NFT", async () => {
    const signer = await requireSigner();
    await send(currentBox(signer).withdrawNFT(
      selectedId(),
      parseAddress($("wd-nft").value, "NFT contract"),
      parseId($("wd-nft-id").value, "Token id")
    ));
  });
}

export async function onSeal() {
  await run("Seal", async () => {
    const signer = await requireSigner();
    const box = currentBox(signer);
    const id = selectedId();
    const sealed = await box.isSealed(id);
    await send(sealed ? box.unseal(id) : box.seal(id));
  });
}

export async function onTransfer() {
  await run("Transfer", async () => {
    const signer = await requireSigner();
    const from = await signer.getAddress();
    await send(currentBox(signer).safeTransferFrom(from, parseAddress($("transfer-to").value, "Recipient"), selectedId()));
  });
}
