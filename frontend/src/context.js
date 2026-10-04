import { ethers } from "ethers";
import { boxAbi, erc20Abi, feeAbi, mailboxAbi, nftAbi } from "./abi.js";

export const ERRORS = {
  NotBoxOwner: "Only the box owner can do that",
  BoxLocked: "This box is locked in a bridge",
  BoxNotLocked: "The original is already unlocked",
  InsufficientBalance: "That asset is not in the box",
  InsufficientMintingFee: "Not enough ETH for the mint fee",
  InsufficientWormholeFee: "Not enough ETH for the Wormhole fee",
  FeeSendFailed: "The fee transfer failed",
  UntrustedSource: "The message came from an untrusted box",
  NotOriginalBox: "This is a shadow. Use the original",
  NotShadowBox: "This is an original. Use the shadow",
  InvalidTargetChain: "That chain is not trusted yet",
  InvalidAddress: "That address is invalid",
  NotWormholeRelayer: "Only the mailbox can deliver",
  OnlyBox: "Only the box can publish",
  UntrustedEmitter: "That message is not from the other mailbox",
  AlreadyDelivered: "That message was already delivered",
  InvalidVaa: "Wormhole rejected the signed message",
  UnexpectedTarget: "The message is for a different box",
  WrongTargetChain: "That message belongs on the other chain",
  FeeTooLow: "Not enough ETH for the Wormhole publish fee",
  BoxUnset: "The mailbox is not connected to a box",
  RefundFailed: "Could not return the extra ETH",
  MessageAlreadyProcessed: "That message was already delivered",
  BridgeFailed: "Wormhole rejected the send",
  ZeroAmount: "Amount is zero",
  TooManyAssets: "This box already holds 20 of that kind",
  DuplicateAsset: "That NFT is already in the box",
  AssetNotReceived: "The NFT never arrived",
  UnknownAction: "Unknown bridge action",
  BoxSealed: "This box is sealed. Open it before adding or removing anything",
  AlreadySealed: "This box is already sealed",
  NotSealed: "This box is already open",
  NonceMismatch: "This return is not the bridge that locked the box",
  ConfigFrozen: "That configuration is frozen",
  OwnableUnauthorizedAccount: "Only the owner can do that",
  ERC721InsufficientApproval: "Approve the NFT first",
  ERC20InsufficientAllowance: "Approve the token first",
  ERC20InsufficientBalance: "Token balance is too low",
  ERC721NonexistentToken: "That box or NFT is already gone"
};

export const boxInterface = new ethers.Interface(boxAbi);
export const mailboxInterface = new ethers.Interface(mailboxAbi);
export const parsers = [boxAbi, erc20Abi, nftAbi, feeAbi, mailboxAbi].map((abi) => new ethers.Interface(abi));

export const state = {
  networkKey: "sepolia",
  mode: "use",
  account: null,
  walletChainId: null,
  boxes: [],
  cats: [],
  parBalance: 0n,
  ethBalance: null,
  readyVaa: null,
  readyId: null,
  busy: false,
  refreshing: false,
  refreshQueued: false,
  boxScope: "mine",
  messages: [],
  vaaCache: {},
  openAddress: null,
  providers: {}
};

export const $ = (id) => document.getElementById(id);

export const PENDING_KEY = "sb-pending-v1";
export const BRIDGE_WAIT_MS = 18 * 60 * 1000;
export const PUBLISHED_ABI = [
  "event LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)"
];
export const BOX_TUPLE = "tuple(tuple(address,uint256,uint256,uint8)[] assets,bool isLocked,uint16 originChain,bool isOriginal,uint256 creationTime,bytes32 messageNonce,uint256 originBoxId)";
