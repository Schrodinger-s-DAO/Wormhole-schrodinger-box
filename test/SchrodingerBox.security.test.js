const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SchrodingerBox ERC-20 accounting", function () {
  async function deploy() {
    const [owner, alice] = await ethers.getSigners();
    const box = await (await ethers.getContractFactory("SchrodingerBox")).deploy(
      owner.address,
      10002,
      owner.address
    );
    await box.waitForDeployment();
    return { box, alice };
  }

  it("does not record a deposit when transferFrom returns false", async function () {
    const { box, alice } = await deploy();
    const token = await (await ethers.getContractFactory("FalseReturnERC20")).deploy();
    const payment = 1_000n;
    await token.mint(alice.address, payment);
    await token.connect(alice).approve(await box.getAddress(), payment);

    const boxId = await box.connect(alice).mintBox.staticCall();
    await box.connect(alice).mintBox();

    await expect(
      box.connect(alice).depositERC20(boxId, await token.getAddress(), payment)
    ).to.be.revertedWithCustomError(box, "SafeERC20FailedOperation");

    expect(await box.getERC20Balance(boxId, await token.getAddress())).to.equal(0);
    expect(await token.balanceOf(alice.address)).to.equal(payment);
    expect(await token.balanceOf(await box.getAddress())).to.equal(0);
  });

  it("credits the amount that arrived when the token takes a fee", async function () {
    const { box, alice } = await deploy();
    const token = await (await ethers.getContractFactory("FeeOnTransferERC20")).deploy();
    const payment = 1_000n;
    await token.mint(alice.address, payment);
    await token.connect(alice).approve(await box.getAddress(), payment);

    const boxId = await box.connect(alice).mintBox.staticCall();
    await box.connect(alice).mintBox();
    await box.connect(alice).depositERC20(boxId, await token.getAddress(), payment);

    expect(await box.getERC20Balance(boxId, await token.getAddress())).to.equal(900n);
    expect(await token.balanceOf(await box.getAddress())).to.equal(900n);

    await box.connect(alice).withdrawERC20(boxId, await token.getAddress());
    expect(await box.getERC20Balance(boxId, await token.getAddress())).to.equal(0);
    expect(await token.balanceOf(await box.getAddress())).to.equal(0);
  });

  it("accepts a USDT-style token that returns no data", async function () {
    const { box, alice } = await deploy();
    const token = await (await ethers.getContractFactory("NoReturnERC20")).deploy();
    const payment = 500n;
    await token.mint(alice.address, payment);
    await token.connect(alice).approve(await box.getAddress(), payment);

    const boxId = await box.connect(alice).mintBox.staticCall();
    await box.connect(alice).mintBox();
    await box.connect(alice).depositERC20(boxId, await token.getAddress(), payment);

    expect(await box.getERC20Balance(boxId, await token.getAddress())).to.equal(payment);
    await box.connect(alice).withdrawERC20(boxId, await token.getAddress());
    expect(await token.balanceOf(alice.address)).to.equal(payment);
    expect(await token.balanceOf(await box.getAddress())).to.equal(0);
  });
});
