// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @notice Wormhole core calls used to publish a message and check a signed VAA.
 * @dev The Standard Relayer no longer delivers testnet messages. This mailbox
 * publishes through core and lets anyone submit the signed VAA on the other chain.
 */
interface IWormhole {
    struct Signature {
        bytes32 r;
        bytes32 s;
        uint8 v;
        uint8 guardianIndex;
    }

    struct VM {
        uint8 version;
        uint32 timestamp;
        uint32 nonce;
        uint16 emitterChainId;
        bytes32 emitterAddress;
        uint64 sequence;
        uint8 consistencyLevel;
        bytes payload;
        uint32 guardianSetIndex;
        Signature[] signatures;
        bytes32 hash;
    }

    function messageFee() external view returns (uint256);

    function publishMessage(
        uint32 nonce,
        bytes memory payload,
        uint8 consistencyLevel
    ) external payable returns (uint64 sequence);

    function parseAndVerifyVM(bytes calldata encodedVM)
        external
        view
        returns (VM memory vm, bool valid, string memory reason);
}

interface IBoxReceiver {
    function receiveWormholeMessages(
        bytes memory payload,
        bytes[] memory additionalVaas,
        bytes32 sourceAddress,
        uint16 sourceChain,
        bytes32 deliveryHash
    ) external payable;
}

/// @notice Publishes box messages to Wormhole and delivers a verified VAA to one box.
contract WormholeMailbox is Ownable, ReentrancyGuard {
    /// @dev Finalized. Guardians sign after the source chain finalizes.
    uint8 public constant CONSISTENCY_LEVEL = 1;

    address public immutable core;
    uint16 public immutable chainId;
    address public box;
    uint32 public nextNonce;

    mapping(uint16 => bytes32) public peers;
    mapping(bytes32 => bool) public delivered;

    event BoxSet(address indexed box);
    event PeerSet(uint16 indexed wormholeChainId, bytes32 mailbox);
    event Published(
        uint64 indexed sequence,
        uint16 indexed targetChain,
        address indexed targetAddress,
        bytes32 sourceBox
    );
    event Delivered(uint16 indexed sourceChain, uint64 indexed sequence, bytes32 sourceBox);

    error InvalidAddress();
    error InvalidChain();
    error BoxAlreadySet();
    error BoxUnset();
    error OnlyBox();
    error FeeTooLow();
    error RefundFailed();
    error InvalidVaa(string reason);
    error UntrustedEmitter();
    error AlreadyDelivered();
    error UnexpectedTarget();
    error WrongTargetChain();

    constructor(address wormholeCore, uint16 wormholeChainId, address initialOwner) Ownable(initialOwner) {
        if (wormholeCore == address(0) || initialOwner == address(0) || wormholeChainId == 0) revert InvalidAddress();
        core = wormholeCore;
        chainId = wormholeChainId;
    }

    /// @notice Locks this mailbox to the box that is allowed to publish.
    function setBox(address next) external onlyOwner {
        if (next == address(0)) revert InvalidAddress();
        if (box != address(0)) revert BoxAlreadySet();
        box = next;
        emit BoxSet(next);
    }

    /// @notice Trusts the mailbox deployed on another Wormhole chain. Zero clears it.
    function setPeer(uint16 wormholeChainId, bytes32 mailbox) external onlyOwner {
        if (wormholeChainId == 0 || wormholeChainId == chainId) revert InvalidChain();
        peers[wormholeChainId] = mailbox;
        emit PeerSet(wormholeChainId, mailbox);
    }

    /// @notice Price the box forwards. On these testnets the core fee is often zero.
    function quoteEVMDeliveryPrice(uint16, uint256, uint256) external view returns (uint256 deliveryPrice, uint256 wormholeFee) {
        uint256 fee = IWormhole(core).messageFee();
        return (fee, fee);
    }

    /// @notice Called by the box. Publishes the payload and the sending box address.
    function sendPayloadToEvm(
        uint16 targetChain,
        address targetAddress,
        bytes memory payload,
        uint256,
        uint256
    ) external payable nonReentrant returns (uint64 sequence) {
        if (box == address(0)) revert BoxUnset();
        if (msg.sender != box) revert OnlyBox();

        uint256 fee = IWormhole(core).messageFee();
        if (msg.value < fee) revert FeeTooLow();

        bytes memory published = abi.encode(
            targetChain,
            targetAddress,
            payload,
            bytes32(uint256(uint160(msg.sender)))
        );
        sequence = IWormhole(core).publishMessage{value: fee}(nextNonce, published, CONSISTENCY_LEVEL);
        nextNonce += 1;

        if (msg.value > fee) {
            (bool ok,) = payable(msg.sender).call{value: msg.value - fee}("");
            if (!ok) revert RefundFailed();
        }

        emit Published(sequence, targetChain, targetAddress, bytes32(uint256(uint160(msg.sender))));
    }

    /// @notice Submits a guardian-signed VAA. Anyone can pay the destination gas.
    function deliver(bytes calldata encodedVaa) external nonReentrant {
        if (box == address(0)) revert BoxUnset();

        (IWormhole.VM memory vm, bool valid, string memory reason) = IWormhole(core).parseAndVerifyVM(encodedVaa);
        if (!valid) revert InvalidVaa(reason);

        bytes32 peer = peers[vm.emitterChainId];
        if (peer == bytes32(0) || peer != vm.emitterAddress) revert UntrustedEmitter();

        bytes32 deliveryId = keccak256(abi.encode(vm.emitterChainId, vm.emitterAddress, vm.sequence));
        if (delivered[deliveryId]) revert AlreadyDelivered();
        delivered[deliveryId] = true;

        (uint16 targetChain, address targetAddress, bytes memory payload, bytes32 sourceBox) =
            abi.decode(vm.payload, (uint16, address, bytes, bytes32));
        if (targetChain != chainId) revert WrongTargetChain();
        if (targetAddress != box) revert UnexpectedTarget();

        IBoxReceiver(box).receiveWormholeMessages(
            payload,
            new bytes[](0),
            sourceBox,
            vm.emitterChainId,
            vm.hash
        );

        emit Delivered(vm.emitterChainId, vm.sequence, sourceBox);
    }
}
