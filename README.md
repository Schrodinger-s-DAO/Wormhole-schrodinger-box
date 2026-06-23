# Introduction

As kids, we carried our whole Pokémon collection in one binder. Dozens of cards, held as a single object you could pick up, hand to a friend, or take to school. Lift it once, and everything inside came with it.

A Schrödinger Box is that binder, made programmable: an NFT that bundles heterogeneous assets, even across chains, into one transferable object. A Web3 folder. Whoever holds the Box holds everything in it: tokens, NFTs, whole positions, all at once. Many assets on many chains stop being a list you move one by one and become a single thing you can pick up and move.

It earns its name in transit. Value cannot leave the chain it was born on, so when a Box crosses chains the original locks in place and a shadow box appears on the far side, identical down to the last holding. For the length of the crossing two boxes exist: one frozen, one live, the same identity split by the bridge. Exactly one is ever alive, so a Box can never be spent twice. The paradox is the safety property.

The whole challenge is the mental model: making "many assets across many chains" feel like a single thing you can hold. Live on testnet, built over Wormhole.

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

- Bridging locks the original box on the source chain and recreates a shadow box with identical state on the target chain (same `boxId`). Both boxes coexist until the bridge completes or is reverted, reproducing the Schrödinger-style simultaneous states.

## Environments & Deployment

- Configure RPC URLs, relayer addresses and deployed contract addresses in `.env` (see repository scripts for expected variables).

- Example deploy commands:

```bash
npx hardhat run scripts/deploy.js --network holesky
npx hardhat run scripts/deploy.js --network sepolia
```

## License & Credits

- The license remains my intellectual property (Guglielmo Anfossi), while I am open to exploring its use in collaboration with your team.
