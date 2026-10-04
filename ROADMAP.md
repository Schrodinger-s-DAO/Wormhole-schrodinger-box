# Mainnet roadmap

This is a list, not a change to the contracts. None of the items below are implemented. The testnet deployment leaves `freezeConfig` uncalled on purpose: the deploy key stays the owner, so a peer can be replaced without another deploy. That is written in the README and in [SECURITY.md](SECURITY.md). It is not a step the script forgot. A mainnet deploy does the items below first.

## Governance

The owner moves to a multisig. Parameter changes go through a timelock. The deploy script calls `freezeConfig` on the box and the mailbox after the peers are set, and it reverts if `configFrozen()` is still false.

## Versioned messages

The bridge payload gains a `version` field. A later deploy can still decode a message that is already in flight, instead of leaving the original locked.

## Same address on every chain

After the delivery fix, deploy the box and the mailbox with CREATE2 so each chain has the same address. Doing that before delivery stores the origin hash would bring back the stuck-box risk.

## Rebasing tokens

Either an on-chain allowlist of tokens the box will hold, or share accounting so a rebasing balance cannot be withdrawn as if it were a fixed amount.

## Verification

Verified source on the explorers. Slither and fuzzing in CI. Foundry invariant tests. An external audit of the box and the escrow together.

## Launch

A bug bounty. Monitoring for boxes that stay locked without a delivery. A cap on the value of one box, and a cap on one trade, for the first weeks.

## Accepted risks

Rewrite the accepted risks in the mainnet `SECURITY.md`. The frontend shows a warning for each of them.
