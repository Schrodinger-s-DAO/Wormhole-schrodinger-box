# Introduction

As kids, we carried our whole Pokémon collection in one binder. Dozens of cards, held as a single object you could pick up, hand to a friend, or take to school. Lift it once, and everything inside came with it.

A Schrödinger Box is that binder, made programmable: an NFT that bundles heterogeneous assets, even across chains, into one transferable object. A Web3 folder. Whoever holds the Box holds everything in it: tokens, NFTs, whole positions, all at once. Many assets on many chains stop being a list you move one by one and become a single thing you can pick up and move.

It earns its name in transit. Value cannot leave the chain it was born on, so when a Box crosses chains the original locks in place and a shadow box appears on the far side, identical down to the last holding. For the length of the crossing two boxes exist: one frozen, one live, the same identity split by the bridge. Exactly one is ever alive, so a Box can never be spent twice. The paradox is the safety property.

The whole challenge is the mental model: making "many assets across many chains" feel like a single thing you can hold. Live on Ethereum Sepolia and Base Sepolia, built over Wormhole. Findings from a review of the box contract, and the fixes, are in [SECURITY.md](SECURITY.md).

## Schrodinger Box

The Box holds heterogeneous assets (multiple ERC20 tokens and NFTs) and can be transferred between owners or bridged across EVM chains via Wormhole. When bridged, the source box locks and a shadow box with identical state is recreated on the target chain; both exist simultaneously until the bridge resolves, mirroring the Schrödinger paradox.

**Status**
- Deployed on Ethereum Sepolia and Base Sepolia.
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
npx hardhat test --network baseSepolia
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
- Sending the shadow home burns it, unlocks the original, and gives that original to the address chosen on the return. The local tests in `test/SchrodingerBox.bridge.test.js` run this round trip against a mock relayer.

## Deployments

Both chains were deployed on 4 October 2026 and each box trusts only the other. `freezeConfig` has been called on both boxes and both mailboxes. Source is not verified on the explorers: this environment has no Etherscan or Basescan API key. The same addresses are in `frontend/src/live.json` and `deployed_contracts.json`.

| Network | Contract | Address |
|---------|----------|---------|
| Ethereum Sepolia | SchrodingerBox | [`0x352167e7A42C69401F705005d179d18892D115F2`](https://sepolia.etherscan.io/address/0x352167e7A42C69401F705005d179d18892D115F2) |
| Ethereum Sepolia | WormholeMailbox | [`0x2e7AE434CDf01DF8453Fb96Ef26c200A0a6087A1`](https://sepolia.etherscan.io/address/0x2e7AE434CDf01DF8453Fb96Ef26c200A0a6087A1) |
| Base Sepolia | SchrodingerBox | [`0xcd2fD8153B15b37dE54B10eD522F3a25cB9b56a3`](https://sepolia.basescan.org/address/0xcd2fD8153B15b37dE54B10eD522F3a25cB9b56a3) |
| Base Sepolia | WormholeMailbox | [`0x571d5EC9977196eB0594291842711cc615378E53`](https://sepolia.basescan.org/address/0x571d5EC9977196eB0594291842711cc615378E53) |

## Environments & Deployment

- Configure RPC URLs, relayer addresses and deployed contract addresses in `.env` (see repository scripts for expected variables).

- Example deploy commands:

```bash
node scripts/deployTestnets.js
```

## License & Credits

- The license remains my intellectual property (Guglielmo Anfossi), while I am open to exploring its use in collaboration with your team.
