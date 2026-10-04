const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SchrodingerBox content hash", function () {
  async function deploy() {
    const [owner, alice] = await ethers.getSigners();
    const box = await (await ethers.getContractFactory("SchrodingerBox")).deploy(
      owner.address,
      10002,
      owner.address
    );
    await box.waitForDeployment();
    const meter = await (await ethers.getContractFactory("CallGasMeter")).deploy();
    return { box, alice, meter };
  }

  async function hashGas(meter, box, tokenId) {
    const data = box.interface.encodeFunctionData("contentHash", [tokenId]);
    return meter.used(await box.getAddress(), data);
  }

  it("stores the hash of a full box, so a later read stays under 50_000 gas", async function () {
    this.timeout(120_000);
    const { box, alice, meter } = await deploy();
    const boxAddress = await box.getAddress();
    const boxId = await box.connect(alice).mintBox.staticCall();
    await box.connect(alice).mintBox();
    const nft = await (await ethers.getContractFactory("SchrodingerCatNFT")).deploy();
    await nft.connect(alice).setApprovalForAll(boxAddress, true);

    for (let i = 0; i < 20; i++) {
      const token = await (await ethers.getContractFactory("ProbeERC20")).deploy();
      await token.mint(alice.address, 1_000n);
      await token.connect(alice).approve(boxAddress, 1_000n);
      await box.connect(alice).depositERC20(boxId, await token.getAddress(), 1_000n);
      const catId = await nft.connect(alice).mint.staticCall(alice.address);
      await nft.connect(alice).mint(alice.address);
      await box.connect(alice).depositNFT(boxId, await nft.getAddress(), catId);
    }

    await box.connect(alice).seal(boxId);
    const first = await box.contentHash(boxId);
    expect(await box.contentHash(boxId)).to.equal(first);
    expect(await hashGas(meter, box, boxId)).to.be.lessThan(50_000n);
  });

  it("keeps a four-level nest under 50_000 gas after the outer seal", async function () {
    const { box, alice, meter } = await deploy();
    const boxAddress = await box.getAddress();
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const id = await box.connect(alice).mintBox.staticCall();
      await box.connect(alice).mintBox();
      ids.push(id);
    }
    const token = await (await ethers.getContractFactory("ProbeERC20")).deploy();
    await token.mint(alice.address, 1n);
    await token.connect(alice).approve(boxAddress, 1n);
    await box.connect(alice).depositERC20(ids[3], await token.getAddress(), 1n);
    await box.connect(alice).setApprovalForAll(boxAddress, true);
    await box.connect(alice).seal(ids[3]);
    await box.connect(alice).depositNFT(ids[2], boxAddress, ids[3]);
    await box.connect(alice).seal(ids[2]);
    await box.connect(alice).depositNFT(ids[1], boxAddress, ids[2]);
    await box.connect(alice).seal(ids[1]);
    await box.connect(alice).depositNFT(ids[0], boxAddress, ids[1]);
    await box.connect(alice).seal(ids[0]);

    expect(await hashGas(meter, box, ids[0])).to.be.lessThan(50_000n);
    expect(await token.balanceOf(boxAddress)).to.equal(1n);
  });

  it("reverts the seal when an external container sits past the fourth level", async function () {
    const { box, alice } = await deploy();
    const boxAddress = await box.getAddress();
    const probe = await (await ethers.getContractFactory("ProbeSealable")).deploy();
    await probe.mint(alice.address, 1);
    await probe.connect(alice).setApprovalForAll(boxAddress, true);
    await box.connect(alice).setApprovalForAll(boxAddress, true);

    const ids = [];
    for (let i = 0; i < 5; i++) {
      const id = await box.connect(alice).mintBox.staticCall();
      await box.connect(alice).mintBox();
      ids.push(id);
    }
    await box.connect(alice).depositNFT(ids[4], await probe.getAddress(), 1);
    await box.connect(alice).seal(ids[4]);
    for (let i = 4; i > 0; i--) {
      await box.connect(alice).depositNFT(ids[i - 1], boxAddress, ids[i]);
      if (i > 1) await box.connect(alice).seal(ids[i - 1]);
    }
    await expect(box.connect(alice).seal(ids[0])).to.be.revertedWithCustomError(box, "ExternalTooDeep");
  });

  it("reverts the seal when an external container does not return a hash", async function () {
    const { box, alice } = await deploy();
    const heavy = await (await ethers.getContractFactory("GasHeavySealable")).deploy();
    await heavy.mint(alice.address, 1);
    const boxId = await box.connect(alice).mintBox.staticCall();
    await box.connect(alice).mintBox();
    const boxAddress = await box.getAddress();
    await heavy.connect(alice).setApprovalForAll(boxAddress, true);
    await box.connect(alice).depositNFT(boxId, await heavy.getAddress(), 1);
    await expect(box.connect(alice).seal(boxId)).to.be.revertedWithCustomError(box, "ExternalHashFailed");
  });
});
