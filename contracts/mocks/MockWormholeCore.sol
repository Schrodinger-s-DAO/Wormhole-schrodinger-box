// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../WormholeMailbox.sol";

/// @notice Test double. `parseAndVerifyVM` trusts an abi-encoded fake VAA.
contract MockWormholeCore is IWormhole {
    uint256 public fee;
    uint64 public sequence;
    address public lastSender;
    bytes public lastPayload;

    function setFee(uint256 next) external {
        fee = next;
    }

    function messageFee() external view returns (uint256) {
        return fee;
    }

    function publishMessage(uint32, bytes memory payload, uint8) external payable returns (uint64) {
        require(msg.value == fee, "fee");
        lastSender = msg.sender;
        lastPayload = payload;
        sequence += 1;
        return sequence;
    }

    function parseAndVerifyVM(bytes calldata encodedVM)
        external
        view
        returns (VM memory vm, bool valid, string memory reason)
    {
        (uint16 emitterChainId, bytes32 emitterAddress, uint64 seq, bytes memory payload, bool ok, string memory why) =
            abi.decode(encodedVM, (uint16, bytes32, uint64, bytes, bool, string));
        vm.emitterChainId = emitterChainId;
        vm.emitterAddress = emitterAddress;
        vm.sequence = seq;
        vm.payload = payload;
        vm.hash = keccak256(encodedVM);
        valid = ok;
        reason = why;
    }
}
