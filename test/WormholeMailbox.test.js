const { expect } = require("chai");
const { ethers } = require("hardhat");

const ORIGIN_CHAIN = 10002;
const DEST_CHAIN = 10004;

function asBytes32(address) {
  return ethers.zeroPadValue(address, 32);
}

function fakeVaa({ emitterChain, emitter, sequence, payload, valid = true, reason = "" }) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint16", "bytes32", "uint64", "bytes", "bool", "string"],
    [emitterChain, emitter, sequence, payload, valid, reason]
  );
}

async function deployPair() {
  const [owner, alice] = await ethers.getSigners();
  const Core = await ethers.getContractFactory("MockWormholeCore");
  const originCore = await Core.deploy();
  const destCore = await Core.deploy();
  await originCore.waitForDeployment();
  await destCore.waitForDeployment();

  const Mail = await ethers.getContractFactory("WormholeMailbox");
  const originMail = await Mail.deploy(await originCore.getAddress(), ORIGIN_CHAIN, owner.address);
  const destMail = await Mail.deploy(await destCore.getAddress(), DEST_CHAIN, owner.address);
  await originMail.waitForDeployment();
  await destMail.waitForDeployment();

  const Box = await ethers.getContractFactory("SchrodingerBox");
  const origin = await Box.deploy(await originMail.getAddress(), ORIGIN_CHAIN, owner.address);
  const dest = await Box.deploy(await destMail.getAddress(), DEST_CHAIN, owner.address);
  await origin.waitForDeployment();
  await dest.waitForDeployment();

  await originMail.setBox(await origin.getAddress());
  await destMail.setBox(await dest.getAddress());
  await originMail.setPeer(DEST_CHAIN, asBytes32(await destMail.getAddress()));
  await destMail.setPeer(ORIGIN_CHAIN, asBytes32(await originMail.getAddress()));
  await origin.setTrustedContract(DEST_CHAIN, asBytes32(await dest.getAddress()));
  await dest.setTrustedContract(ORIGIN_CHAIN, asBytes32(await origin.getAddress()));

  return { owner, alice, originCore, destCore, originMail, destMail, origin, dest };
}

async function publishedVaa(core, mailbox, emitterChain) {
  return fakeVaa({
    emitterChain,
    emitter: asBytes32(await mailbox.getAddress()),
    sequence: await core.sequence(),
    payload: await core.lastPayload()
  });
}

describe("WormholeMailbox", function () {
  it("mints a shadow from a verified VAA and unlocks the original on the way home", async function () {
    const { alice, originCore, destCore, originMail, destMail, origin, dest } = await deployPair();
    const boxId = await origin.connect(alice).mintBox.staticCall();
    await origin.connect(alice).mintBox();

    await origin.connect(alice).bridgeBox(DEST_CHAIN, alice.address, boxId);
    const shadowTx = await destMail.deliver(await publishedVaa(originCore, originMail, ORIGIN_CHAIN));
    const shadowReceipt = await shadowTx.wait();
    const received = shadowReceipt.logs
      .map((log) => {
        try {
          return dest.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "BoxReceived");
    const shadowId = received.args.boxId;

    expect(await dest.ownerOf(shadowId)).to.equal(alice.address);
    expect((await dest.getBoxDetails(shadowId)).isOriginal).to.equal(false);
    expect((await origin.getBoxDetails(boxId)).isLocked).to.equal(true);
    expect(await origin.ownerOf(boxId)).to.equal(await origin.getAddress());

    await dest.connect(alice).returnShadowBox(shadowId, alice.address);
    await originMail.deliver(await publishedVaa(destCore, destMail, DEST_CHAIN));

    await expect(dest.ownerOf(shadowId)).to.be.reverted;
    expect((await origin.getBoxDetails(boxId)).isLocked).to.equal(false);
    expect(await origin.ownerOf(boxId)).to.equal(alice.address);
  });

  it("quotes the core fee and forwards exactly that amount", async function () {
    const { alice, originCore, origin, originMail } = await deployPair();
    await originCore.setFee(ethers.parseEther("0.02"));
    expect(await origin.getWormholeFee(DEST_CHAIN)).to.equal(ethers.parseEther("0.02"));

    const boxId = await origin.connect(alice).mintBox.staticCall();
    await origin.connect(alice).mintBox();
    await expect(
      origin.connect(alice).bridgeBox(DEST_CHAIN, alice.address, boxId, { value: ethers.parseEther("0.02") })
    ).to.emit(originMail, "Published");
    expect(await ethers.provider.getBalance(await originCore.getAddress())).to.equal(ethers.parseEther("0.02"));
  });

  it("rejects a publisher that is not the box, an unknown emitter, and a second delivery", async function () {
    const { alice, originCore, originMail, destMail, origin } = await deployPair();
    await expect(
      originMail.connect(alice).sendPayloadToEvm(DEST_CHAIN, alice.address, "0x", 0, 0)
    ).to.be.revertedWithCustomError(originMail, "OnlyBox");

    const boxId = await origin.connect(alice).mintBox.staticCall();
    await origin.connect(alice).mintBox();
    await origin.connect(alice).bridgeBox(DEST_CHAIN, alice.address, boxId);

    const vaa = await publishedVaa(originCore, originMail, ORIGIN_CHAIN);
    const stranger = fakeVaa({
      emitterChain: ORIGIN_CHAIN,
      emitter: asBytes32(alice.address),
      sequence: 1n,
      payload: await originCore.lastPayload()
    });
    await expect(destMail.deliver(stranger)).to.be.revertedWithCustomError(destMail, "UntrustedEmitter");

    await destMail.deliver(vaa);
    await expect(destMail.deliver(vaa)).to.be.revertedWithCustomError(destMail, "AlreadyDelivered");
  });

  it("refuses to replace a peer after the config is frozen", async function () {
    const { owner, destMail } = await deployPair();
    await destMail.freezeConfig();
    await expect(
      destMail.connect(owner).setPeer(ORIGIN_CHAIN, asBytes32(owner.address))
    ).to.be.revertedWithCustomError(destMail, "ConfigFrozen");
  });
});
