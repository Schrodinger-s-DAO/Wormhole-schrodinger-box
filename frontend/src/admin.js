import { ethers } from "ethers";
import { feeAbi } from "./abi.js";
import { $ } from "./context.js";
import { invalid } from "./errors.js";
import { network, requireSigner } from "./wallet.js";
import { currentBox } from "./boxes.js";
import { run, send } from "./bridge.js";
import { parseAddress, parseEth, parseId, tokenDecimals } from "./assets.js";

export async function onSetFee() {
  await run("Set mint fee", async () => {
    const signer = await requireSigner();
    await send(currentBox(signer).setMintingFee(parseEth("fee-input")));
  });
}

export async function onSetCollector() {
  await run("Set collector", async () => {
    const signer = await requireSigner();
    await send(currentBox(signer).setFeeCollector(parseAddress($("collector-input").value, "Collector")));
  });
}

export async function onSetTrust() {
  await run("Trust box", async () => {
    const signer = await requireSigner();
    const chainId = Number(parseId($("trust-chain").value, "Chain id"));
    if (chainId > 65535) throw invalid("Wormhole chain id must fit in uint16");
    const address = parseAddress($("trust-addr").value, "Box");
    await send(currentBox(signer).setTrustedContract(chainId, ethers.zeroPadValue(address, 32)));
  });
}

export async function onWithdrawEth() {
  await run("Withdraw collector ETH", async () => {
    const signer = await requireSigner();
    const collector = new ethers.Contract(network().contracts.feeCollector, feeAbi, signer);
    await send(collector.withdrawETH());
  });
}

export async function onWithdrawFeeToken() {
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
