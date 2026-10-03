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
  await dest.connect(signer).returnShadowBox(shadowId);
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
});
