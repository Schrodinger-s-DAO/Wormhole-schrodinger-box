# Introduction

As kids, we carried our whole Pokémon collection in one binder. Dozens of cards, held as a single object you could pick up, hand to a friend, or take to school. Lift it once, and everything inside came with it.

A Schrödinger Box is that binder, made programmable: an NFT that bundles heterogeneous assets, even across chains, into one transferable object. A Web3 folder. Whoever holds the Box holds everything in it: tokens, NFTs, whole positions, all at once. Many assets on many chains stop being a list you move one by one and become a single thing you can pick up and move.

It earns its name in transit. Value cannot leave the chain it was born on, so when a Box crosses chains the original locks in place and a shadow box appears on the far side, identical down to the last holding. For the length of the crossing two boxes exist: one frozen, one live, the same identity split by the bridge. Exactly one is ever alive, so a Box can never be spent twice. The paradox is the safety property.

The whole challenge is the mental model: making "many assets across many chains" feel like a single thing you can hold. Live on Holesky and Sepolia, built over Wormhole. Findings from a review of the box contract, and the fixes, are in [SECURITY.md](SECURITY.md).

## Schrodinger Box

The Box holds heterogeneous assets (multiple ERC20 tokens and NFTs) and can be transferred between owners or bridged across EVM chains via Wormhole. When bridged, the source box locks and a shadow box with identical state is recreated on the target chain; both exist simultaneously until the bridge resolves, mirroring the Schrödinger paradox.

**Status**
- Deployed and tested on Holesky and Sepolia testnets.
- Built with Hardhat, Wormhole Relayer, and a 4-contract architecture: `SchrodingerBox`, `FeeCollector`, `ParadoxToken`, `SchrodingerCatNFT`.

## Quickstart

- Install dependencies:

```bash
npm install
```

- Compile:

```bash
npx hardhat compile
```

- Run tests (examples):

```bash
npx hardhat test --network holesky
npx hardhat test --network sepolia
```

## Architecture

- `SchrodingerBox`: core contract that holds ERC20s and NFTs, coordinates transfers and bridging.
- `FeeCollector`: contract that collects protocol fees.
- `ParadoxToken`: ERC20 used for fees/utility in demonstrations.
- `SchrodingerCatNFT`: example NFT contract used in tests and demos.

## Bridge Behavior

- Bridging locks the original box. That locked box cannot be transferred, and its assets stay on the chain where they were deposited.
- The destination mints a shadow with its own token id and records `originBoxId`. The shadow can be transferred. It cannot deposit or withdraw.
- Sending the shadow home burns it, unlocks the original, and gives that original to the account that sent it home. The local tests in `test/SchrodingerBox.bridge.test.js` run this round trip against a mock relayer.

## Deployments

Addresses recorded for the public testnet deployments. Source verification on the explorer is separate from this list.

| Network | Contract | Address |
|---------|----------|---------|
| Holesky | SchrodingerBox | [`0xE3c0C995fdC9C8B53383adB95f7816d4b3d657f5`](https://holesky.etherscan.io/address/0xE3c0C995fdC9C8B53383adB95f7816d4b3d657f5) |
| Holesky | FeeCollector | [`0x7368A8DA33cad6Db111686A130687f64E4df39c7`](https://holesky.etherscan.io/address/0x7368A8DA33cad6Db111686A130687f64E4df39c7) |
| Holesky | ParadoxToken | [`0xC23Cc5B5a56325b78A998678C3aB3b4cf299E0DC`](https://holesky.etherscan.io/address/0xC23Cc5B5a56325b78A998678C3aB3b4cf299E0DC) |
| Holesky | SchrodingerCatNFT | [`0x463aA9fa9CC882306b81440cf16845170Fc1b843`](https://holesky.etherscan.io/address/0x463aA9fa9CC882306b81440cf16845170Fc1b843) |
| Sepolia | SchrodingerBox | [`0xc858b43357b6D8D507ad8E069847b5CFb0181a71`](https://sepolia.etherscan.io/address/0xc858b43357b6D8D507ad8E069847b5CFb0181a71) |
| Sepolia | FeeCollector | [`0x25305962f8EE3e349F79387695693f50b0f4BAA1`](https://sepolia.etherscan.io/address/0x25305962f8EE3e349F79387695693f50b0f4BAA1) |
| Sepolia | ParadoxToken | [`0x84E17681cb4A5A8f89BF068a61594FF8699577c7`](https://sepolia.etherscan.io/address/0x84E17681cb4A5A8f89BF068a61594FF8699577c7) |
| Sepolia | SchrodingerCatNFT | [`0x0A9902718f5b0fA61E390746F3d2490211712Fed`](https://sepolia.etherscan.io/address/0x0A9902718f5b0fA61E390746F3d2490211712Fed) |

The same addresses are in `deployed_contracts.json`. These deployments predate the settlement fixes and the bridge fixes in this repository. A new deployment is required before either is live.

## Environments & Deployment

- Configure RPC URLs, relayer addresses and deployed contract addresses in `.env` (see repository scripts for expected variables).

- Example deploy commands:

```bash
npx hardhat run scripts/deploy.js --network holesky
npx hardhat run scripts/deploy.js --network sepolia
```

## License & Credits

- The license remains my intellectual property (Guglielmo Anfossi), while I am open to exploring its use in collaboration with your team.
