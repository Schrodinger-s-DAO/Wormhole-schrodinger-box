# Schrodinger Box

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

## Contributing

- Open issues or pull requests against the upstream repository. If you want me to push and open a PR from your fork/branch, tell me which remote/branch to use.

## License & Credits

- The license remains my intellectual property (Guglielmo Anfossi), while I am open to exploring its use in collaboration with your team.
