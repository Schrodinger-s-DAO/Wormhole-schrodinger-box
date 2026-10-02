# SchrodingerBox security review

Self-review of `contracts/SchrodingerBox.sol` and the ETH path in `contracts/FeeCollector.sol`. This is not a third-party audit. The findings below were in the previous version of the contracts and are fixed in the current source.

**Scope:** deposits, withdrawals, minting-fee refunds, and the bridge refund. Wormhole message authentication (trusted source, replay nonce) was reviewed and left as it was.

## Summary

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| H-01 | ERC-20 `transferFrom` return value is ignored | High | Fixed |
| M-01 | Fee-on-transfer deposits are credited in full | Medium | Fixed |
| M-02 | ETH refunds use `address.transfer` | Medium | Fixed |
| L-01 | Asset lists inside a box have no cap | Low | Fixed |
| I-01 | Comments mixed Italian and English | Info | Fixed |

The deployed Holesky and Sepolia addresses in the README are the previous bytecode. These fixes are in the repository only until a new deployment.

## H-01 — ERC-20 `transferFrom` return value is ignored

**Severity:** High

`depositERC20` called `IERC20.transferFrom` and then added `amount` to the box. Two non-standard shapes matter.

**Return `false`.** The call does not revert and no tokens move. The box still recorded `amount`. `withdrawERC20` later sends that amount from the contract balance. If other boxes have deposited the same token, the withdrawal pays the attacker with their tokens.

Exploit:

1. Alice deposits 1,000 real tokens into her box. The contract holds 1,000.
2. Bob deposits a token whose `transferFrom` returns `false`. His box is credited 1,000. The contract still holds only Alice's 1,000.
3. Bob withdraws. The contract sends him 1,000 of Alice's tokens.

**Missing return data (USDT).** Through the `IERC20` interface, a token that returns no bool makes the ABI decoder revert. A USDT deposit could not succeed. That is a broken deposit, not a silent one.

**Fix:** `SafeERC20.safeTransferFrom` on the way in and `safeTransfer` on the way out. A `false` return reverts the deposit, so the box is not credited. Empty return data is treated as success, so a USDT-style token can be deposited and withdrawn. `test/SchrodingerBox.security.test.js` covers both.

## M-01 — Fee-on-transfer deposits are credited in full

**Severity:** Medium

A token can return success and still deliver less than `amount`. The old code credited `amount`. The contract held less than the sum of the box balances. A later withdraw of the recorded amount pulled the difference from other deposits of the same token.

**Fix:** the box records the recipient balance increase, not the requested `amount`. A 1,000 deposit that arrives as 900 is stored as 900. Withdrawing that balance cannot spend another box's tokens. Fee-on-transfer tokens stay usable; the accounting follows the tokens that arrived.

## M-02 — ETH refunds use `address.transfer`

**Severity:** Medium

Minting, bridging, and returning a shadow box refunded unused ETH with `address.transfer`, which forwards 2300 gas. A contract wallet whose receive function needs more than that could not get the refund, and the mint or bridge reverted after the fee had already been considered. `FeeCollector.withdrawETH` had the same pattern, so the owner could be a contract that cannot receive the balance.

**Fix:** refunds and the collector withdrawal use `call` and revert if the call fails. `mintBox` is `nonReentrant`, and the bridge paths already were. The box is minted, or locked, before the refund, so the refund cannot re-enter and mint or bridge a second time.

## L-01 — Asset lists inside a box have no cap

**Severity:** Low

Each deposit of a new token or NFT pushed an unbounded array. Reads and the bridge payload walk those arrays. A box could be made expensive to bridge.

**Fix:** `MAX_ASSETS` is 20 for the ERC-20 list and 20 for the NFT list. Topping up a token that is already in the box does not consume a new slot.

## I-01 — Comments mixed Italian and English

**Severity:** Informational

NatSpec and inline comments in `SchrodingerBox` and `SchrodingerCatNFT` were partly Italian. They are English now.

## Residual risk

- A token that lies about `balanceOf` can still be credited for a balance increase that is not a real deposit. The user chose that token.
- A fee-on-transfer token charges again on withdraw. The box pays the recorded net amount; the token may deliver less to the wallet. The contract balance stays consistent with the books.
- The Wormhole relayer and the trusted remote contract are privileged. A bad trusted registration can still deliver a shadow box.
- Shadow boxes copy the asset list. They do not move the underlying tokens. Spending a shadow box's ERC-20 on the destination chain is only possible if that chain's contract actually holds the tokens. That custody split is the bridge model, not something this patch changes.
- The addresses in the README run the previous bytecode.
