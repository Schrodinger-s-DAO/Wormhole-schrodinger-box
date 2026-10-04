const ownableErrors = [
  "error OwnableUnauthorizedAccount(address account)",
  "error OwnableInvalidOwner(address owner)"
];

const erc721Errors = [
  "error ERC721InsufficientApproval(address operator, uint256 tokenId)",
  "error ERC721InvalidOwner(address owner)",
  "error ERC721InvalidReceiver(address receiver)",
  "error ERC721InvalidSender(address sender)",
  "error ERC721NonexistentToken(uint256 tokenId)",
  "error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner)"
];

const erc20Errors = [
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)"
];

export const boxAbi = [
  "function mintBox() payable returns (uint256)",
  "function depositERC20(uint256 boxId, address token, uint256 amount)",
  "function withdrawERC20(uint256 boxId, address token)",
  "function depositNFT(uint256 boxId, address nftContract, uint256 tokenId)",
  "function withdrawNFT(uint256 boxId, address nftContract, uint256 tokenId)",
  "function bridgeBox(uint16 targetChain, address receiver, uint256 boxId) payable",
  "function returnShadowBox(uint256 boxId) payable",
  "function getBoxDetails(uint256 boxId) view returns (tuple(address contractAddress, uint256 tokenId, uint256 amount, uint8 assetType)[] assets, bool isLocked, uint16 originChain, bool isOriginal, uint256 originBoxId)",
  "function getERC20Balance(uint256 boxId, address token) view returns (uint256)",
  "function containsNFT(uint256 boxId, address nftContract, uint256 tokenId) view returns (bool)",
  "function getWormholeFee(uint16 targetChain) view returns (uint256)",
  "function getWormholeFee(uint16 targetChain, uint256 assetCount) view returns (uint256)",
  "function deliveryGasLimit(uint256 assetCount) view returns (uint256)",
  "function setFeeCollector(address feeCollector)",
  "function setMintingFee(uint256 fee)",
  "function setTrustedContract(uint16 chainId, bytes32 contractAddress)",
  "function feeCollector() view returns (address)",
  "function mintingFee() view returns (uint256)",
  "function chainId() view returns (uint16)",
  "function wormholeRelayer() view returns (address)",
  "function owner() view returns (address)",
  "function MAX_ASSETS() view returns (uint256)",
  "function BASE_DELIVERY_GAS() view returns (uint256)",
  "function GAS_PER_ASSET() view returns (uint256)",
  "function trustedContracts(uint16 chainId) view returns (bytes32)",
  "function processedMessages(bytes32 nonce) view returns (bool)",
  "function boxes(uint256 boxId) view returns (bool isLocked, uint16 originChain, bool isOriginal, uint256 creationTime, bytes32 messageNonce, uint256 originBoxId)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function tokenByIndex(uint256 index) view returns (uint256)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function isSealed(uint256 tokenId) view returns (bool)",
  "function sealState(uint256 tokenId) view returns (uint256)",
  "function seal(uint256 boxId)",
  "function unseal(uint256 boxId)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "event BoxMinted(address indexed owner, uint256 indexed boxId)",
  "event ERC20Deposited(uint256 indexed boxId, address indexed token, uint256 amount)",
  "event ERC20Withdrawn(uint256 indexed boxId, address indexed token, uint256 amount)",
  "event NFTDeposited(uint256 indexed boxId, address indexed nftContract, uint256 nftTokenId)",
  "event NFTWithdrawn(uint256 indexed boxId, address indexed nftContract, uint256 nftTokenId)",
  "event BoxBridged(uint256 indexed boxId, uint16 indexed dstChainId, bytes32 indexed targetContract)",
  "event BoxReceived(uint256 indexed boxId, address indexed receiver)",
  "event ShadowBoxReturned(uint256 indexed boxId, uint16 indexed originalChain)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "error NotBoxOwner()",
  "error BoxLocked()",
  "error BoxNotLocked()",
  "error InsufficientBalance()",
  "error InsufficientMintingFee()",
  "error InsufficientWormholeFee()",
  "error FeeSendFailed()",
  "error UntrustedSource()",
  "error NotOriginalBox()",
  "error NotShadowBox()",
  "error InvalidTargetChain()",
  "error InvalidAddress()",
  "error NotWormholeRelayer()",
  "error MessageAlreadyProcessed()",
  "error BridgeFailed(string reason)",
  "error ZeroAmount()",
  "error TooManyAssets()",
  "error DuplicateAsset()",
  "error AssetNotReceived()",
  "error UnknownAction()",
  "error BoxSealed()",
  "error AlreadySealed()",
  "error NotSealed()",
  "error NonceMismatch()",
  "error ConfigFrozen()",
  "error ReentrancyGuardReentrantCall()",
  ...ownableErrors,
  ...erc721Errors
];

export const erc20Abi = [
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  ...erc20Errors
];

export const nftAbi = [
  "function mint(address to) returns (uint256)",
  "function approve(address to, uint256 tokenId)",
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  ...erc721Errors
];

export const mailboxAbi = [
  "function deliver(bytes encodedVaa)",
  "function quoteEVMDeliveryPrice(uint16 targetChain, uint256 receiverValue, uint256 gasLimit) view returns (uint256 deliveryPrice, uint256 wormholeFee)",
  "function peers(uint16 wormholeChainId) view returns (bytes32)",
  "function box() view returns (address)",
  "function core() view returns (address)",
  "function chainId() view returns (uint16)",
  "event Published(uint64 indexed sequence, uint16 indexed targetChain, address indexed targetAddress, bytes32 sourceBox)",
  "event Delivered(uint16 indexed sourceChain, uint64 indexed sequence, bytes32 sourceBox)",
  "error OnlyBox()",
  "error UntrustedEmitter()",
  "error AlreadyDelivered()",
  "error InvalidVaa(string reason)",
  "error UnexpectedTarget()",
  "error WrongTargetChain()",
  "error FeeTooLow()",
  "error BoxUnset()",
  "error BoxAlreadySet()",
  "error RefundFailed()",
  ...ownableErrors
];

export const relayerAbi = [
  "function quote() view returns (uint256)",
  "function setQuote(uint256 nextQuote)",
  "function lastTargetChain() view returns (uint16)",
  "function lastTarget() view returns (address)",
  "function lastPayload() view returns (bytes)",
  "function lastGasLimit() view returns (uint256)",
  "function deliver(address box, uint16 sourceChain, bytes32 sourceAddress)"
];

export const feeAbi = [
  "function owner() view returns (address)",
  "function withdrawETH()",
  "function withdrawERC20(address token, uint256 amount)",
  ...ownableErrors,
  ...erc20Errors
];
