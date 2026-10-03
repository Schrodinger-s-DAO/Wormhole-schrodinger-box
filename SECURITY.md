# SchrodingerBox security review

Internal review of the contracts in this repository. This is not an external audit. The contracts are deployed on testnets only. Do not treat this file as an audit, and do not put real value behind these addresses.

**Scope:** `contracts/SchrodingerBox.sol`, `contracts/WormholeMailbox.sol`, and the ETH path in `contracts/FeeCollector.sol`. Deposits, withdrawals, the seal, minting-fee refunds, the bridge, and delivery of a signed Wormhole VAA.

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
| H-05 | `_safeMint` on a shadow can lock the original forever | High | Fixed |
| H-06 | A listed box can be emptied during a trade | High | Fixed |
| T-01 | Owner keys can seize a box that is in transit | High | Mitigated |
| L-04 | The fee quote fallback breaks the bridge | Low | Fixed |
| L-05 | A return is not bound to the bridge that locked the box | Low | Fixed |

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

**Fix:** `deliveryGasLimit` starts at 800_000 and adds 60_000 per listed asset. With the mailbox, that number is only an input to the price quote. Publishing does not attach it as a gas stipend. The account that calls `deliver` pays for execution on the destination chain.

## L-03 — Bridge receiver is not checked

**Severity:** Low

`bridgeBox` accepted the zero address. Delivery would then revert, after the original had been locked.

**Fix:** a zero receiver reverts with `InvalidAddress` before the message is sent. Delivery rejects a zero receiver as well.

## I-02 — `DebugLog` events in production code

**Severity:** Informational

Bridge and return emitted `DebugLog` for troubleshooting. Those events are removed.

## H-05 — `_safeMint` on a shadow can lock the original forever

**Severity:** High

Delivery used to mint the shadow with `_safeMint`. A receiver contract with no `onERC721Received`, including a smart wallet that exists on one chain and not the other, made every delivery revert. The original stayed in this contract with `isLocked` set, and nothing could unlock it.

**Fix:** the shadow is created with `_mint`. The user's own `mintBox` still uses `_safeMint`, because that receiver is the caller of the same transaction. `test/SchrodingerBox.bridge.test.js` mints a shadow to a contract that does not accept ERC-721.

## H-06 — A listed box can be emptied during a trade

**Severity:** High

Atomic Barter's escrow used to store only the NFT address and token id. The owner could withdraw what was inside after listing and before settlement. The counterparty received an empty box.

**Fix:** the box has a seal. `seal` and `unseal` each increase `sealState`. Deposits and withdrawals revert while the box is sealed. A shadow is always sealed. When the original comes home, `sealState` increases again. The interface is `ISealable` (`isSealed`, `sealState`), advertised through ERC-165, with `Sealed` / `Unsealed` and ERC-4906 `MetadataUpdate`. TradeEscrow stores the counter when the NFT reports `ISealable`, and checks it again before the transfer and after every leg. The write-up and the regression tests are in Atomic Barter's `SECURITY.md` (O-01) and `test/TradeEscrow.ts`.

## T-01 — Owner keys can seize a box that is in transit

**Severity:** High

`setTrustedContract` on the box and `setPeer` on the mailbox choose who is allowed to deliver a return. A later call could point that at a sender the key holder controls, unlock any locked original, and take it.

**Mitigation:** `freezeConfig()` on each contract is irreversible. After it, those two functions revert. `setBox` on the mailbox was already one-shot. The contracts do not freeze themselves. A deployment is mitigated only after the owner calls `freezeConfig`, once the peers are set. These testnet addresses have called it. A deployment that needs to rotate peers later should put the owner behind a multisig and a timelock, not a single key. `test/SchrodingerBox.bridge.test.js` and `test/WormholeMailbox.test.js` cover the freeze.

## L-04 — The fee quote fallback breaks the bridge

**Severity:** Low

If `quoteEVMDeliveryPrice` reverted, the box used to send a fixed 0.01 ETH. The mailbox refunds the unused value to the box. The box has no `receive()`, so the refund reverted and the bridge reverted with it.

**Fix:** the `try/catch` and `DEFAULT_WORMHOLE_FEE` are gone. A quote that reverts fails the bridge before the original is locked or the shadow is burned. `test/SchrodingerBox.bridge.test.js` covers a reverting quote.

## L-05 — A return is not bound to the bridge that locked the box

**Severity:** Low

A return used to name the original id and pass the peer check. It did not have to be the message for the bridge that locked that box.

**Fix:** `bridgeBox` stores `messageNonce` on the original, and the shadow keeps that same nonce. Action 2 reverts with `NonceMismatch` unless `boxData.messageNonce` equals the nonce stored on the original. `test/SchrodingerBox.bridge.test.js` delivers a return with a different nonce and checks that the original stays locked.

## Deployment

| Chain | Box | Mailbox |
|-------|-----|---------|
| Ethereum Sepolia | `0x4642836001Ab04ebDf65f1780F5FB5E297e33990` | `0x537DF7a9D17CA3EC59bA99291b099824Bc96fB35` |
| Base Sepolia | `0xbC727Eda544c08395A59A4b5e5865375b955be12` | `0xA6beA0b56D53dCAB242AAf6d6E1ACa961dFe6732` |

These addresses were deployed on 3 October 2026 from the source in this repository. Peers and trusted contracts are set, the publish fee is 0, and `freezeConfig` has been called on both boxes and both mailboxes. The explorers do not show a verified source yet. The previous pair (`0x826c…Eb61` / `0xe322…332e`) does not include these fixes and is no longer what the site uses. Holesky is not a supported network.

## Trust model

- **Box owner.** Until `freezeConfig`, this key chooses the trusted box on each other chain and can replace it. It also sets the mint fee and the fee collector. It cannot take assets out of someone else's box.
- **Mailbox owner.** Until `freezeConfig`, this key chooses the peer mailbox. `setBox` can be called once.
- **Wormhole guardians.** They sign the VAA. A delivery is accepted only after `parseAndVerifyVM` says the VAA is valid. `CONSISTENCY_LEVEL` is 1, so they sign after the source chain finalizes.
- **Whoever calls `deliver`.** They pay the destination gas and can submit any valid VAA from a registered peer. They cannot change the payload. A failed delivery reverts the whole transaction, so the same VAA can be submitted again.

## Bridge flow

1. `bridgeBox` quotes the fee, publishes through the mailbox, then moves the original to this contract and sets `isLocked`.
2. The mailbox publishes with `CONSISTENCY_LEVEL = 1` and records the sequence.
3. On the destination, `deliver` checks the guardian signatures, the peer, the target chain, and the target box. The sequence is stored before the box is called. If the box reverts, the stored sequence rolls back with the transaction.
4. The box also rejects a `messageNonce` it has already applied. That is a second replay check, on the payload, separate from the mailbox sequence.
5. A return burns the shadow when the message is published. Anyone can deliver that VAA. If delivery fails, it can be retried. The original stays locked until a delivery succeeds.

## Rules that have to keep holding

- A shadow cannot deposit or withdraw.
- A locked original cannot be transferred. Burning it is still allowed.
- A sealed original cannot deposit or withdraw.
- A shadow is always sealed.
- A return unlocks the original only when the nonce matches the bridge that locked it, and then `sealState` increases.
- A failed delivery does not consume the mailbox sequence.

## Notes for integrators

- At settlement, read `isSealed` and `sealState` for any NFT that supports `ISealable`, and check the counter again after the transfers. TradeEscrow does this. A container that does not implement `ISealable` can still be emptied by its owner.
- A shadow is the right to bring the original home. It does not hold the assets. The assets stay on the origin chain.
- A locked original is owned by the box contract. `transferFrom` of that token reverts.

## Reporting a vulnerability

Use Private vulnerability reporting on this GitHub repository (Settings, Security). Do not open a public issue for a problem that can move assets.

## Tests

| Check | Where |
|-------|--------|
| False ERC-20 return is not credited | `test/SchrodingerBox.security.test.js` |
| Fee-on-transfer is credited for what arrived | `test/SchrodingerBox.security.test.js` |
| USDT-style token with no return data | `test/SchrodingerBox.security.test.js` |
| Return gives the original to the shadow holder | `test/SchrodingerBox.bridge.test.js` |
| Shadow cannot withdraw another box's tokens | `test/SchrodingerBox.bridge.test.js` |
| Shadow id does not collide with a local box | `test/SchrodingerBox.bridge.test.js` |
| Locked original cannot be transferred | `test/SchrodingerBox.bridge.test.js` |
| Zero receiver does not lock the box | `test/SchrodingerBox.bridge.test.js` |
| Quote asks for more than 500k gas | `test/SchrodingerBox.bridge.test.js` |
| H-05 contract receiver still receives the shadow | `test/SchrodingerBox.bridge.test.js` |
| L-04 reverting quote does not lock the box | `test/SchrodingerBox.bridge.test.js` |
| L-05 wrong return nonce leaves the original locked | `test/SchrodingerBox.bridge.test.js` |
| Seal cycle, shadow stays sealed, return bumps the counter | `test/SchrodingerBox.bridge.test.js` |
| T-01 frozen trusted contract and frozen peer | `test/SchrodingerBox.bridge.test.js`, `test/WormholeMailbox.test.js` |
| Mailbox verifies the VAA, the peer, and replay | `test/WormholeMailbox.test.js` |

## Residual risk

- A token that lies about `balanceOf` can still be credited for a balance increase that is not a real deposit. The user chose that token.
- A fee-on-transfer token charges again on withdraw. The box pays the recorded net amount; the token may deliver less to the wallet. The contract balance stays consistent with the books.
- Until the owner calls `freezeConfig`, the owner key can still change who is trusted. After that call it cannot.
- The shadow is burned when the return message is published. Anyone can deliver that VAA, and a failed delivery can be submitted again. The original stays locked until delivery succeeds.
- `ParadoxToken` and `SchrodingerCatNFT` can be minted by anyone. That is acceptable for these testnet demo tokens.
- Container NFTs that do not implement `ISealable` are outside what this box can promise. The trade escrow documents that separately.
