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
| SB-07 | A return delivers the original to `msg.sender` on the origin chain | Medium | Fixed |
| SB-08 | A shadow held where it cannot be returned locks the original forever | Medium | Accepted risk |
| SB-09 | Rebasing and blocklist tokens break pooled accounting | Medium | Accepted risk |
| SB-10 | A box can be deposited into itself | Low | Fixed |
| SB-11 | Nested boxes are frozen only by an undocumented invariant | Low | Fixed |
| SB-12 | The seal freezes the asset list, not the value of what is inside | Info | Accepted risk |
| SB-13 | Deployment addresses disagree between README and deploy files | Info | Fixed |
| SB-14 | Single-key `Ownable`, manual freeze | Low | Mitigated |

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

**Mitigation:** `freezeConfig()` on each contract is irreversible. After it, those two functions revert. `setBox` on the mailbox was already one-shot. The contracts do not freeze themselves. This testnet deploy does not call `freezeConfig`. That is intentional: the deploy key can replace a peer without another deploy. It is not a step the script forgot. Mainnet puts the owner behind a multisig and a timelock, and the deploy script calls the freeze. That work is listed in [ROADMAP.md](ROADMAP.md) and is not in this deployment. `test/SchrodingerBox.bridge.test.js` and `test/WormholeMailbox.test.js` cover the freeze.

## L-04 — The fee quote fallback breaks the bridge

**Severity:** Low

If `quoteEVMDeliveryPrice` reverted, the box used to send a fixed 0.01 ETH. The mailbox refunds the unused value to the box. The box has no `receive()`, so the refund reverted and the bridge reverted with it.

**Fix:** the `try/catch` and `DEFAULT_WORMHOLE_FEE` are gone. A quote that reverts fails the bridge before the original is locked or the shadow is burned. `test/SchrodingerBox.bridge.test.js` covers a reverting quote.

## L-05 — A return is not bound to the bridge that locked the box

**Severity:** Low

A return used to name the original id and pass the peer check. It did not have to be the message for the bridge that locked that box.

**Fix:** `bridgeBox` stores `messageNonce` on the original, and the shadow keeps that same nonce. Action 2 reverts with `NonceMismatch` unless `boxData.messageNonce` equals the nonce stored on the original. `test/SchrodingerBox.bridge.test.js` delivers a return with a different nonce and checks that the original stays locked.

## SB-07 — A return delivers the original to `msg.sender` on the origin chain

**Severity:** Medium

`returnShadowBox` used to put `msg.sender` in the payload. On the origin chain the original was transferred to that address. A shadow held by a Safe, an ERC-4337 account, or an ERC-6551 account would send the original to the same address on the origin chain. If that account is not deployed there, or is controlled by someone else, the original and everything in it is lost.

**Fix:** `returnShadowBox(uint256 boxId, address receiver)` reverts on the zero address. The payload shape is unchanged; the chosen receiver is what gets written. The frontend defaults to the connected address, warns when that address has code, and asks the user to type it again.

## SB-08 — A shadow held where it cannot be returned locks the original forever

**Severity:** Medium (accepted risk)

Only the holder of the shadow can unlock the original. A shadow minted to a contract with no way to call `returnShadowBox`, to an address with no code on the destination, or to the box contract itself, leaves the original locked with no exit. This follows from H-05: delivery must not revert. There is no timeout that releases the original, because that would let the original and the shadow both be live.

**Mitigation:** `bridgeBox` reverts when the receiver is the trusted box on the destination chain. `returnShadowBox` reverts when the receiver is the trusted box on the origin chain. The frontend asks the user to retype the receiver and warns when the address has code. `test/SchrodingerBox.bridge.test.js` covers both refusals.

## SB-09 — Rebasing and blocklist tokens break pooled accounting

**Severity:** Medium (accepted risk)

All boxes share one contract balance per token. A token whose balance changes after deposit (negative rebase, demurrage) leaves the last withdrawer short. A positive rebase leaves surplus that no box can claim. A token that blocklists the box contract freezes that token in every box.

**Mitigation:** these tokens are unsupported. The deposit form says so and does not block the transaction. An on-chain allowlist, or per-box shares, is a later change and is not in this contract.

## SB-10 — A box can be deposited into itself

**Severity:** Low

`depositNFT(boxId, address(this), boxId)` used to check ownership before the transfer. After it, the contract owned the box and no one could withdraw or unseal it.

**Fix:** `depositNFT` reverts with `SelfDeposit` when `nftContract == address(this) && tokenId == boxId`. Longer cycles are already impossible, because a box inside another has no owner that can act on it. `test/SchrodingerBox.audit-poc.test.js` expects that revert.

## SB-11 — Nested boxes are frozen only by an undocumented invariant

**Severity:** Low

A box inside another box is owned by this contract. Every state-changing entrypoint requires `ownerOf(boxId) == msg.sender`, so the inner box cannot be sealed, unsealed, deposited into, or withdrawn from while it is inside. TradeEscrow relies on this: it checks the seal and the content hash of the outer box.

**Fix:** the invariant is stated in NatSpec on `_requireOpenOriginal` and on `ISealable`. `test/SchrodingerBox.audit-poc.test.js` seals the outer box and checks that the inner box stays unsealed and cannot be unsealed or withdrawn. Any future delegate, operator, or nested-withdraw feature must preserve it.

## SB-12 — The seal freezes the asset list, not the value of what is inside

**Severity:** Info (accepted risk)

The seal blocks deposits and withdrawals. It does not stop changes inside the assets: an ERC-6551 account can be drained through approvals or permits signed before it was deposited; an upgradeable NFT contract's admin can move a token; ERC-4907 keeps its `user` role; rebasing tokens change amount.

**Mitigation:** the deposit form warns, and does not block, when the NFT contract answers `token()` like an ERC-6551 account or has a non-zero EIP-1967 implementation slot. `seal` stores `contentHash`. While the box is sealed that function returns the stored word, then re-reads at most eight external `ISealable` contracts. A contract that claims the interface but does not return a hash makes `seal` revert `ExternalHashFailed`, so those contents are not dropped from the hash. A contract that does not claim the interface still contributes zero. A change that never touches the box's own asset list can still leave the hash unchanged when it is not one of those eight reads.

## SB-13 — Deployment addresses disagree

**Severity:** Info

The README, this file, `frontend/src/live.json`, and `deployed_contracts.json` used to name different box addresses.

**Fix:** one deployment table. The deploy script writes `live.json` and `deployed_contracts.json`, and the README and this file copy that pair. Older boxes are not trusted peers of this pair.

## SB-14 — Single-key `Ownable`, manual freeze

**Severity:** Low

**Status:** Mitigated

The box and the mailbox use `Ownable2Step`. `freezeConfig` is still in the contracts and is irreversible once called. This testnet deploy does not call it, on purpose, so the deploy key can replace a peer without another deploy. The script does not revert when `configFrozen()` is false. No multisig address was designated, so the owner is still the deploy key. The key cannot take assets out of a box. A mainnet deploy moves that owner to a multisig, puts a timelock on parameter changes, and calls `freezeConfig` from the script. That is in [ROADMAP.md](ROADMAP.md), not in this deployment. Ownership can move later with `transferOwnership` and `acceptOwnership`.

External `contentHash` reads use a 50,000 gas `staticcall`. A contract that claims `ISealable` and does not return inside that cap makes `seal` revert `ExternalHashFailed`. It does not contribute a zero hash.

## Deployment

| Chain | Box | Mailbox |
|-------|-----|---------|
| Ethereum Sepolia | `0x9E155f89D90EdC5C4904D2D489dE7a7F9E004Ec8` | `0x7951C9eD7383EA217D993415C8f02FB5914A6e9F` |
| Base Sepolia | `0x8F815921E7817c77C0fc5c59D4Ac71b247A6A8Ec` | `0x3482419026F5a088aA419f617249395dF639817B` |

Both chains were deployed on 4 October 2026 from the source in this repository. Each box trusts only the other. `freezeConfig` has not been called on the boxes or the mailboxes. That is intentional on this testnet, so the deploy key can replace a peer without another deploy. `seal` stores `contentHash`, and delivery stores that same word from the payload instead of calling the assets. The explorers do not show a verified source: this environment has no Etherscan or Basescan API key.

## Previous deployments

These boxes are still on chain. They are not peers of the pair above. An escrow that only understands the current `ISealable` id rejects the ones from before `contentHash`.

| Chain | Box | What it lacks |
|-------|-----|----------------|
| Ethereum Sepolia | `0x4642836001Ab04ebDf65f1780F5FB5E297e33990` | No `contentHash`. Not protected. |
| Ethereum Sepolia | `0x29733d284ba67EC96D43966C575f26437aF0aF73` | No `contentHash`. Not protected. |
| Base Sepolia | `0xbC727Eda544c08395A59A4b5e5865375b955be12` | No `contentHash`. Not protected. |
| Ethereum Sepolia | `0x352167e7A42C69401F705005d179d18892D115F2` | Has `contentHash`. External hash reads have no gas cap. |
| Base Sepolia | `0xcd2fD8153B15b37dE54B10eD522F3a25cB9b56a3` | Has `contentHash`. External hash reads have no gas cap. |
| Ethereum Sepolia | `0xe8De9D30ae05f176b5970559ad961958A5447831` | Computes `contentHash` on every read. An external hash that runs out of gas becomes zero. |
| Base Sepolia | `0x53C3fAa5029a7FfD23DaAA737C8E6524992fe9Ee` | Computes `contentHash` on every read. An external hash that runs out of gas becomes zero. |
| Ethereum Sepolia | `0x0D0aD3b2698ab55217fFb7428A8bE7Ac8e8041f9` | Stores `contentHash` at seal, then recomputes it on delivery. An external container can revert that delivery and leave the original locked. Mailbox `0x03a41E5f28e05C469761dD42216B1E12F2C00b32`. A box already in flight on this pair cannot be delivered. |
| Base Sepolia | `0x7c44c66c7F93Fa84dDeCd747E427fe3E4818cCE2` | Stores `contentHash` at seal, then recomputes it on delivery. An external container can revert that delivery and leave the original locked. Mailbox `0x8a9Be83e244Bf9DCbdAF67EFcB95C95130A4266b`. A box already in flight on this pair cannot be delivered. |

## Trust model

- **Box owner.** Until `freezeConfig`, this key chooses the trusted box on each other chain and can replace it. It also sets the mint fee and the fee collector. It cannot take assets out of someone else's box.
- **Mailbox owner.** Until `freezeConfig`, this key chooses the peer mailbox. `setBox` can be called once.
- **Wormhole guardians.** They sign the VAA. A delivery is accepted only after `parseAndVerifyVM` says the VAA is valid. `CONSISTENCY_LEVEL` is 1, so they sign after the source chain finalizes.
- **Whoever calls `deliver`.** They pay the destination gas and can submit any valid VAA from a registered peer. They cannot change the payload. A failed delivery reverts the whole transaction, so the same VAA can be submitted again.

## Bridge flow

1. `bridgeBox` quotes the fee, publishes through the mailbox, then moves the original to this contract and sets `isLocked`.
2. The mailbox publishes with `CONSISTENCY_LEVEL = 1` and records the sequence.
3. On the destination, `deliver` checks the guardian signatures, the peer, the target chain, and the target box. The sequence is stored before the box is called. If the box reverts, the stored sequence rolls back with the transaction. Action 1 stores the content hash from the payload. It does not call the assets, because those contracts are not on this chain. A failed hash on the origin reverts `bridgeBox` before the lock.
4. The box also rejects a `messageNonce` it has already applied. That is a second replay check, on the payload, separate from the mailbox sequence.
5. A return burns the shadow when the message is published. Anyone can deliver that VAA. If delivery fails, it can be retried. The original stays locked until a delivery succeeds.

## Rules that have to keep holding

- A box nested inside this contract is owned by this contract. Nobody can deposit, withdraw, seal, or unseal it until it is withdrawn.
- A shadow cannot deposit or withdraw.
- A locked original cannot be transferred. Burning it is still allowed.
- A sealed original cannot deposit or withdraw.
- A shadow is always sealed.
- A return unlocks the original only when the nonce matches the bridge that locked it, and then `sealState` increases.
- A failed delivery does not consume the mailbox sequence.

## Notes for integrators

- At settlement, read `isSealed`, `sealState`, and `contentHash` for any NFT that supports `ISealable`, and check them again after the transfers. TradeEscrow does this. On a sealed box, `contentHash` is the word stored by `seal`, plus at most eight live reads of external containers. Nested boxes of this contract are included when the outer box is sealed, up to four levels, and they are not walked again on the later read. A container that does not implement `ISealable` can still be emptied by its owner.
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
| Receiver cannot be the trusted box, and a return rejects the zero address (SB-08) | `test/SchrodingerBox.bridge.test.js` |
| Self-deposit reverts with SelfDeposit (SB-10) | `test/SchrodingerBox.audit-poc.test.js` |
| Inner box cannot be touched while nested (SB-11) | `test/SchrodingerBox.audit-poc.test.js` |
| A full box and a four-level nest stay under 50_000 gas once sealed | `test/SchrodingerBox.content-hash.test.js` |
| An external hash that does not return reverts the seal | `test/SchrodingerBox.content-hash.test.js` |
| An external container past the fourth level reverts the seal | `test/SchrodingerBox.content-hash.test.js` |
| Delivery stores the origin hash and does not call the assets | `test/SchrodingerBox.bridge.test.js` |
| Mailbox verifies the VAA, the peer, and replay | `test/WormholeMailbox.test.js` |

## Residual risk

- A token that lies about `balanceOf` can still be credited for a balance increase that is not a real deposit. The user chose that token.
- A fee-on-transfer token charges again on withdraw. The box pays the recorded net amount; the token may deliver less to the wallet. The contract balance stays consistent with the books.
- Until the owner calls `freezeConfig`, the owner key can still change who is trusted. After that call it cannot.
- The shadow is burned when the return message is published. Anyone can deliver that VAA, and a failed delivery can be submitted again. The original stays locked until delivery succeeds.
- `ParadoxToken` and `SchrodingerCatNFT` can be minted by anyone. That is acceptable for these testnet demo tokens.
- Container NFTs that do not implement `ISealable` are outside what this box can promise. The trade escrow documents that separately.
