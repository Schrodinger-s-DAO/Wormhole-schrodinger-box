# SchrodingerBox security review

Self-review of `contracts/SchrodingerBox.sol` and the ETH path in `contracts/FeeCollector.sol`. This is not a third-party audit. The findings below were in the previous version of the contracts and are fixed in the current source.

**Scope:** deposits, withdrawals, minting-fee refunds, the bridge refund, and the Wormhole round trip. Message authentication (trusted source, replay nonce) is unchanged.

## Summary

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| H-01 | ERC-20 `transferFrom` return value is ignored | High | Fixed |
| M-01 | Fee-on-transfer deposits are credited in full | Medium | Fixed |
| M-02 | ETH refunds use `address.transfer` | Medium | Fixed |
| L-01 | Asset lists inside a box have no cap | Low | Fixed |
| I-01 | Comments mixed Italian and English | Info | Fixed |
| H-02 | Returning a shadow box is rejected, so the original stays locked | High | Fixed |
| H-03 | A shadow box can withdraw another user's tokens | High | Fixed |
| H-04 | Reusing the origin box id collides on the destination | High | Fixed |
| M-03 | A locked box can still be transferred | Medium | Fixed |
| L-02 | Delivery gas is fixed at 500k | Low | Fixed |
| L-03 | Bridge receiver is not checked against the zero address | Low | Fixed |
| I-02 | `DebugLog` events in production code | Info | Fixed |
| O-01 | A bad shadow receiver locks the original forever | High | Open |
| O-02 | Owner keys can seize a box that is in transit | High | Open |
| O-03 | The fee fallback makes the bridge revert | Medium | Open |
| O-04 | A return is not bound to the bridge that locked the box | Medium | Open |
| O-05 | `deliveryGasLimit` is only a quote | Info | Open |
| O-06 | A listed box can be emptied before a trade settles | High | Open |

The findings marked **Open** are not fixed in the current source. They are specified below so the next change can implement them. Do not treat this file as an audit.

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

## H-02 — Returning a shadow box is rejected

**Severity:** High

`returnShadowBox` sent the shadow's own `Box`, whose `isOriginal` flag is false. The origin required `boxData.isOriginal == true` and reverted with `NotOriginalBox`. The shadow had already been burned, and the original stayed locked with the assets inside.

**Fix:** the origin unlocks the box it stored, and ignores the `isOriginal` flag carried in the return message. The message names the original id. After unlock, that box is transferred to the account that sent the shadow home.

## H-03 — A shadow box can withdraw another user's tokens

**Severity:** High

A shadow arrived unlocked and copied the asset list, but the tokens never moved. `withdrawERC20` did not check `isOriginal`. If the same token address exists on the destination, the shadow paid itself from deposits other users had made into that chain's contract.

**Fix:** deposit and withdraw require an original, unlocked box. A shadow can be transferred. It cannot take tokens out of the destination contract.

## H-04 — Reusing the origin box id collides on the destination

**Severity:** High

Each chain numbers boxes on its own. Delivery minted the shadow with the origin's id. If that id already existed, `mint` reverted and the original stayed locked.

**Fix:** a shadow is minted with the destination's next id and stores `originBoxId`. The return message uses that stored id, so the original unlocks even when both chains already had a box with the same number.

## M-03 — A locked box can still be transferred

**Severity:** Medium

`isLocked` blocked deposits and withdrawals, not `transferFrom`. The locked original and the shadow could both be sold, as two NFTs for one set of assets.

**Fix:** `_update` reverts while a box is locked, so the original cannot move. Burning it is still allowed. The shadow is the box that can change hands, and returning it hands the original to that holder.

## L-02 — Delivery gas is fixed at 500k

**Severity:** Low

`GAS_LIMIT` was 500_000 for every message. A full box writes on the order of 80 storage slots, which does not fit in that budget, so delivery of a full box could revert and leave the original locked.

**Fix:** `deliveryGasLimit` starts at 800_000 and adds 60_000 per listed asset. The quote and the send use that value.

## L-03 — Bridge receiver is not checked

**Severity:** Low

`bridgeBox` accepted the zero address. Delivery would then revert, after the original had been locked.

**Fix:** a zero receiver reverts with `InvalidAddress` before the message is sent. Delivery rejects a zero receiver as well.

## I-02 — `DebugLog` events in production code

**Severity:** Informational

Bridge and return emitted `DebugLog` for troubleshooting. Those events are removed.

## Open — still to implement

These are in the contracts that are deployed on Ethereum Sepolia and Base Sepolia. None of them is fixed yet.

### O-01 — A bad shadow receiver locks the original forever

**Severity:** High

Delivery mints the shadow with `_safeMint`. If `receiver` is a contract that does not implement `onERC721Received`, the mint reverts. The whole delivery reverts, so it can be retried, and it fails the same way every time. The original stays in this contract with `isLocked = true`. Nothing in the contract can unlock it. The same trap hits a smart wallet that exists on the source chain and has no code on the destination.

**To implement:** mint the shadow with `_mint`, not `_safeMint`. The original's own mint can stay a safe mint, because that receiver is `msg.sender` and the transaction is still the user's.

### O-02 — Owner keys can seize a box that is in transit

**Severity:** High

Whoever can call `setTrustedContract` on the box, or `setPeer` on the mailbox, can register a sender they control. That sender can publish a return (action 2). Delivery then unlocks any locked original and transfers it to them. On these testnets the deployer holds both keys, which is acceptable for the demo. It is not acceptable for anything that holds real value.

**To implement:** after the peers and the box are set, freeze those functions the same way `setBox` already refuses a second call. A later deployment that needs rotation should use a multisig and a timelock, not a single owner key.

### O-03 — The fee fallback makes the bridge revert

**Severity:** Medium

If `quoteEVMDeliveryPrice` reverts, the box quotes a fixed `DEFAULT_WORMHOLE_FEE` of 0.01 ETH and sends that value. The mailbox refunds the unused part to the box. The box has no `receive()` function, so the refund reverts and the bridge reverts with it. With the current mailbox the quote rarely fails. The fallback is still worse than letting the quote fail immediately, because a failed quote is a clear revert and a failed refund looks like a broken bridge.

**To implement:** remove the `try/catch` around the quote. If the mailbox cannot price the message, `bridgeBox` and `returnShadowBox` revert before they lock or burn anything.

### O-04 — A return is not bound to the bridge that locked the box

**Severity:** Medium

`returnShadowBox` names the original id and the mailbox checks the peer. It does not check that this return is the message for the bridge that locked the box. A later, trusted return for that id is enough. Saving the bridge `messageNonce` on the shadow, and requiring the same nonce when the origin unlocks, ties the return to that lock.

**To implement:** store the nonce on the shadow when it is minted. On action 2, revert unless the stored nonce matches the nonce in the message.

### O-05 — `deliveryGasLimit` is only a quote

**Severity:** Informational

The mailbox does not use `deliveryGasLimit` when it publishes. The account that calls `deliver` pays for execution. The number still feeds the price quote, so it should stay, with a comment that it is not a gas stipend.

### O-06 — A listed box can be emptied before a trade settles

**Severity:** High

This one is in Atomic Barter's `TradeEscrow`, not in this repository. The escrow stores an NFT as a contract address and a token id. It does not store what is inside. Until settlement the box stays in the owner's wallet, so `withdrawERC20` and `withdrawNFT` still work. `bundleVersion` changes when the trade's asset list changes. It does not change when the inside of a listed box changes.

Alice can list a box that holds tokens, wait until the other party has approved, withdraw the tokens, and then approve. The other party receives an empty box. Putting the withdrawal in front of their approval, with a higher gas price, works the same way. Bridging the box does not: the box moves to this contract, `transferFrom` fails, and the trade rolls back.

**To implement:** this box exposes `contentVersion(tokenId)`, incremented on every deposit and withdrawal, and ERC-165 for that interface. The escrow stores the version when the NFT is listed, if the contract reports the interface, and reverts with `ContentChanged` at settlement when the version differs. The interface check has to be a `staticcall`, so ordinary NFTs that do not implement ERC-165 can still be listed. The same check covers any container NFT, not only this box. A regression test in `test/TradeEscrow.ts` should run the withdrawal and expect `ContentChanged`.

The full write-up is also O-01 in Atomic Barter's `SECURITY.md`. Neither contract has the check yet. The wallet warns and disables accept when it sees a deposit or withdrawal after the box was listed. That is not a substitute for the settlement check.

## Residual risk

- A token that lies about `balanceOf` can still be credited for a balance increase that is not a real deposit. The user chose that token.
- A fee-on-transfer token charges again on withdraw. The box pays the recorded net amount; the token may deliver less to the wallet. The contract balance stays consistent with the books.
- The owner of the box and of the mailbox can still change who is trusted. That is O-02. It is accepted on these testnets and has to be closed before real value.
- The shadow is burned when the return message is accepted by the relayer, before the origin has executed it. If that delivery never lands, the shadow is gone and the original stays locked until the same message is delivered.
- `ParadoxToken` and `SchrodingerCatNFT` can be minted by anyone. That is acceptable for these testnet demo tokens.
- The addresses in the README run the previous bytecode.
