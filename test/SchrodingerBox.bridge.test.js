const { expect } = require("chai");
const { ethers } = require("hardhat");

const ORIGIN_CHAIN = 2;
const DEST_CHAIN = 4;

function asBytes32(address) {
  return ethers.zeroPadValue(address, 32);
}

async function deployPair() {
  const [owner, alice, bob] = await ethers.getSigners();
  const relayer = await (await ethers.getContractFactory("MockRelayer")).deploy();
  await relayer.waitForDeployment();
  const Box = await ethers.getContractFactory("SchrodingerBox");
  const origin = await Box.deploy(await relayer.getAddress(), ORIGIN_CHAIN, owner.address);
  const dest = await Box.deploy(await relayer.getAddress(), DEST_CHAIN, owner.address);
  await origin.waitForDeployment();
  await dest.waitForDeployment();
  await origin.setTrustedContract(DEST_CHAIN, asBytes32(await dest.getAddress()));
  await dest.setTrustedContract(ORIGIN_CHAIN, asBytes32(await origin.getAddress()));
  const token = await (await ethers.getContractFactory("NoReturnERC20")).deploy();
  await token.waitForDeployment();
  return { owner, alice, bob, relayer, origin, dest, token };
}

async function mintBox(box, signer) {
  const boxId = await box.connect(signer).mintBox.staticCall();
  await box.connect(signer).mintBox();
  return boxId;
}

async function deposit(box, token, signer, boxId, amount) {
  await token.mint(signer.address, amount);
  await token.connect(signer).approve(await box.getAddress(), amount);
  await box.connect(signer).depositERC20(boxId, await token.getAddress(), amount);
}

async function bridge(relayer, origin, dest, signer, boxId, receiver) {
  await origin.connect(signer).bridgeBox(DEST_CHAIN, receiver, boxId);
  const delivery = await relayer.deliver(
    await dest.getAddress(),
    ORIGIN_CHAIN,
    asBytes32(await origin.getAddress())
  );
  const receipt = await delivery.wait();
  const received = receipt.logs
    .map((log) => {
      try {
        return dest.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed && parsed.name === "BoxReceived");
  return received.args.boxId;
}

async function sendHome(relayer, origin, dest, signer, shadowId) {
  await dest.connect(signer).returnShadowBox(shadowId, signer.address);
  await relayer.deliver(await origin.getAddress(), DEST_CHAIN, asBytes32(await dest.getAddress()));
}

describe("SchrodingerBox bridge", function () {
  it("unlocks the original on the way home and gives it to whoever held the shadow", async function () {
    const { alice, bob, relayer, origin, dest, token } = await deployPair();
    const amount = 1_000n;
    const originBoxId = await mintBox(origin, alice);
    await deposit(origin, token, alice, originBoxId, amount);

    const shadowId = await bridge(relayer, origin, dest, alice, originBoxId, alice.address);
    expect((await dest.getBoxDetails(shadowId)).originBoxId).to.equal(originBoxId);
    expect((await dest.getBoxDetails(shadowId)).isOriginal).to.equal(false);
    expect((await origin.getBoxDetails(originBoxId)).isLocked).to.equal(true);
    expect(await origin.ownerOf(originBoxId)).to.equal(await origin.getAddress());

    await dest.connect(alice).transferFrom(alice.address, bob.address, shadowId);
    await sendHome(relayer, origin, dest, bob, shadowId);

    await expect(dest.ownerOf(shadowId)).to.be.reverted;
    expect(await origin.ownerOf(originBoxId)).to.equal(bob.address);
    expect((await origin.getBoxDetails(originBoxId)).isLocked).to.equal(false);

    await origin.connect(bob).withdrawERC20(originBoxId, await token.getAddress());
    expect(await token.balanceOf(bob.address)).to.equal(amount);
    expect(await token.balanceOf(await origin.getAddress())).to.equal(0n);
  });

  it("does not let a shadow box withdraw tokens held for another box", async function () {
    const { alice, bob, relayer, origin, dest, token } = await deployPair();
    const amount = 1_000n;
    const localBoxId = await mintBox(dest, bob);
    await deposit(dest, token, bob, localBoxId, amount);

    const originBoxId = await mintBox(origin, alice);
    await deposit(origin, token, alice, originBoxId, amount);
    const shadowId = await bridge(relayer, origin, dest, alice, originBoxId, alice.address);

    await expect(
      dest.connect(alice).withdrawERC20(shadowId, await token.getAddress())
    ).to.be.revertedWithCustomError(dest, "NotOriginalBox");

    expect(await token.balanceOf(await dest.getAddress())).to.equal(amount);
    await dest.connect(bob).withdrawERC20(localBoxId, await token.getAddress());
    expect(await token.balanceOf(bob.address)).to.equal(amount);
    expect(await token.balanceOf(await dest.getAddress())).to.equal(0n);
  });

  it("mints a new shadow id when the destination already uses that number", async function () {
    const { alice, bob, relayer, origin, dest } = await deployPair();
    const occupied = await mintBox(dest, bob);
    const originBoxId = await mintBox(origin, alice);
    expect(occupied).to.equal(originBoxId);

    const shadowId = await bridge(relayer, origin, dest, alice, originBoxId, alice.address);
    expect(shadowId).to.not.equal(occupied);
    expect(await dest.ownerOf(occupied)).to.equal(bob.address);
    expect((await dest.getBoxDetails(occupied)).isOriginal).to.equal(true);

    await sendHome(relayer, origin, dest, alice, shadowId);
    expect((await origin.getBoxDetails(originBoxId)).isLocked).to.equal(false);
    expect(await origin.ownerOf(originBoxId)).to.equal(alice.address);
    expect(await dest.ownerOf(occupied)).to.equal(bob.address);
  });

  it("refuses to transfer a locked original", async function () {
    const { alice, bob, relayer, origin, dest } = await deployPair();
    const originBoxId = await mintBox(origin, alice);
    const shadowId = await bridge(relayer, origin, dest, alice, originBoxId, alice.address);

    await expect(
      origin.connect(alice).transferFrom(await origin.getAddress(), bob.address, originBoxId)
    ).to.be.revertedWithCustomError(origin, "BoxLocked");
    expect(await origin.ownerOf(originBoxId)).to.equal(await origin.getAddress());
    expect(await dest.ownerOf(shadowId)).to.equal(alice.address);
  });

  it("rejects a zero receiver before locking the box", async function () {
    const { alice, origin } = await deployPair();
    const originBoxId = await mintBox(origin, alice);

    await expect(
      origin.connect(alice).bridgeBox(DEST_CHAIN, ethers.ZeroAddress, originBoxId)
    ).to.be.revertedWithCustomError(origin, "InvalidAddress");
    expect((await origin.getBoxDetails(originBoxId)).isLocked).to.equal(false);
  });

  it("asks the relayer for more than 500k gas", async function () {
    const { alice, relayer, origin, dest, token } = await deployPair();
    const originBoxId = await mintBox(origin, alice);
    await deposit(origin, token, alice, originBoxId, 1n);
    await bridge(relayer, origin, dest, alice, originBoxId, alice.address);

    const gas = await relayer.lastGasLimit();
    expect(gas).to.be.gt(500_000n);
    expect(gas).to.equal((await origin.BASE_DELIVERY_GAS()) + (await origin.GAS_PER_ASSET()));
  });

  it("mints a shadow to a contract that does not accept ERC-721", async function () {
    const { alice, relayer, origin, dest } = await deployPair();
    const sink = await (await ethers.getContractFactory("BlindReceiver")).deploy();
    const originBoxId = await mintBox(origin, alice);

    const shadowId = await bridge(relayer, origin, dest, alice, originBoxId, await sink.getAddress());
    expect(await dest.ownerOf(shadowId)).to.equal(await sink.getAddress());
    expect((await origin.getBoxDetails(originBoxId)).isLocked).to.equal(true);
  });

  it("reverts the bridge when the quote reverts, and leaves the box open", async function () {
    const { alice, relayer, origin } = await deployPair();
    const originBoxId = await mintBox(origin, alice);
    await relayer.setRevertQuote(true);

    await expect(
      origin.connect(alice).bridgeBox(DEST_CHAIN, alice.address, originBoxId)
    ).to.be.revertedWithCustomError(relayer, "QuoteUnavailable");
    expect((await origin.getBoxDetails(originBoxId)).isLocked).to.equal(false);
    expect(await origin.ownerOf(originBoxId)).to.equal(alice.address);
  });

  it("rejects a return whose nonce is not the bridge that locked the box", async function () {
    const { alice, relayer, origin, dest } = await deployPair();
    const originBoxId = await mintBox(origin, alice);
    await bridge(relayer, origin, dest, alice, originBoxId, alice.address);

    const stored = await origin.boxes(originBoxId);
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "uint256", "tuple(tuple(address,uint256,uint256,uint8)[],bool,uint16,bool,uint256,bytes32,uint256)", "address", "bytes32", "bytes32"],
      [
        2,
        originBoxId,
        [[], false, ORIGIN_CHAIN, false, 0, ethers.id("wrong"), originBoxId],
        alice.address,
        ethers.id("return"),
        ethers.ZeroHash
      ]
    );
    await expect(
      relayer.deliverPayload(await origin.getAddress(), payload, DEST_CHAIN, asBytes32(await dest.getAddress()))
    ).to.be.revertedWithCustomError(origin, "NonceMismatch");
    expect(stored.messageNonce).to.not.equal(ethers.id("wrong"));
    expect((await origin.getBoxDetails(originBoxId)).isLocked).to.equal(true);
  });

  it("seals and unseals, keeps a shadow sealed, and bumps the counter when the original comes home", async function () {
    const { alice, relayer, origin, dest, token } = await deployPair();
    const originBoxId = await mintBox(origin, alice);
    expect(await origin.isSealed(originBoxId)).to.equal(false);
    expect(await origin.supportsInterface("0x49064906")).to.equal(true);

    await origin.connect(alice).seal(originBoxId);
    expect(await origin.sealState(originBoxId)).to.equal(1n);
    await expect(
      origin.connect(alice).depositERC20(originBoxId, await token.getAddress(), 1n)
    ).to.be.revertedWithCustomError(origin, "BoxSealed");

    await origin.connect(alice).unseal(originBoxId);
    expect(await origin.isSealed(originBoxId)).to.equal(false);
    expect(await origin.sealState(originBoxId)).to.equal(2n);
    await origin.connect(alice).seal(originBoxId);

    const shadowId = await bridge(relayer, origin, dest, alice, originBoxId, alice.address);
    expect(await dest.isSealed(shadowId)).to.equal(true);
    await expect(dest.connect(alice).unseal(shadowId)).to.be.revertedWithCustomError(dest, "NotOriginalBox");

    const before = await origin.sealState(originBoxId);
    await sendHome(relayer, origin, dest, alice, shadowId);
    expect(await origin.sealState(originBoxId)).to.equal(before + 1n);
    expect(await origin.isSealed(originBoxId)).to.equal(true);
  });

  it("delivers a shadow when the destination cannot read the nested hash", async function () {
    const { alice, relayer, origin, dest } = await deployPair();
    const hostile = await (await ethers.getContractFactory("DestHostileSealable")).deploy();
    await hostile.setHostileTo(await dest.getAddress());
    await hostile.mint(alice.address, 1);
    const originBoxId = await mintBox(origin, alice);
    const originAddress = await origin.getAddress();
    await hostile.connect(alice).setApprovalForAll(originAddress, true);
    await origin.connect(alice).depositNFT(originBoxId, await hostile.getAddress(), 1);
    await origin.connect(alice).seal(originBoxId);
    const originHash = await origin.contentHash(originBoxId);

    const shadowId = await bridge(relayer, origin, dest, alice, originBoxId, alice.address);
    expect(await dest.contentHash(shadowId)).to.equal(originHash);
    expect((await origin.getBoxDetails(originBoxId)).isLocked).to.equal(true);
    expect(await dest.isSealed(shadowId)).to.equal(true);

    await sendHome(relayer, origin, dest, alice, shadowId);
    expect(await origin.ownerOf(originBoxId)).to.equal(alice.address);
    expect((await origin.getBoxDetails(originBoxId)).isLocked).to.equal(false);
    await expect(dest.ownerOf(shadowId)).to.be.reverted;
  });

  it("gives the original to the receiver named on the return", async function () {
    const { alice, bob, relayer, origin, dest } = await deployPair();
    const originBoxId = await mintBox(origin, alice);
    const shadowId = await bridge(relayer, origin, dest, alice, originBoxId, alice.address);
    await dest.connect(alice).returnShadowBox(shadowId, bob.address);
    await relayer.deliver(await origin.getAddress(), DEST_CHAIN, asBytes32(await dest.getAddress()));
    expect(await origin.ownerOf(originBoxId)).to.equal(bob.address);
    await expect(dest.ownerOf(shadowId)).to.be.reverted;
  });

  it("refuses to deliver a box to the trusted box contract", async function () {
    const { alice, relayer, origin, dest } = await deployPair();
    const originBoxId = await mintBox(origin, alice);
    await expect(
      origin.connect(alice).bridgeBox(DEST_CHAIN, await dest.getAddress(), originBoxId)
    ).to.be.revertedWithCustomError(origin, "InvalidAddress");

    const shadowId = await bridge(relayer, origin, dest, alice, originBoxId, alice.address);
    await expect(
      dest.connect(alice).returnShadowBox(shadowId, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(dest, "InvalidAddress");
    await expect(
      dest.connect(alice).returnShadowBox(shadowId, await origin.getAddress())
    ).to.be.revertedWithCustomError(dest, "InvalidAddress");
  });

  it("refuses to replace a trusted contract after the config is frozen", async function () {
    const { owner, origin } = await deployPair();
    await origin.freezeConfig();
    await expect(
      origin.connect(owner).setTrustedContract(DEST_CHAIN, asBytes32(owner.address))
    ).to.be.revertedWithCustomError(origin, "ConfigFrozen");
  });
});
