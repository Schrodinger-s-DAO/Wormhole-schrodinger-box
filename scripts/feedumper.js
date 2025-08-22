const FeeCollector = artifacts.require("FeeCollector");

module.exports = async function (callback) {
  try {
    const chainId = await web3.eth.getChainId();
    const feeCollector = await FeeCollector.deployed();

    if (chainId === 10004) {
      // Prelievo dalla chain con ID 10004 (Wormhole)
      const amount = web3.utils.toWei("1", "ether");
      await feeCollector.withdraw(amount);
      console.log("Prelievo effettuato sulla chain Wormhole");
    } else {
      console.log("Prelievo non supportato su questa chain");
    }

    callback();
  } catch (error) {
    callback(error);
  }
};