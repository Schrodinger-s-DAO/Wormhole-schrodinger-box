// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ISealable} from "../ISealable.sol";

contract CallGasMeter {
    function used(address target, bytes calldata data) external view returns (uint256 gas) {
        uint256 start = gasleft();
        (bool ok,) = target.staticcall(data);
        gas = start - gasleft();
        require(ok, "call failed");
    }
}

contract ProbeERC20 is ERC20 {
    constructor() ERC20("Probe", "PROBE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Claims `ISealable` and spends more gas than the external hash cap.
/// @notice A sealed container with a cheap, stable hash.
contract ProbeSealable is ERC721, ISealable {
    constructor() ERC721("Probe Seal", "PSEAL") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function isSealed(uint256 tokenId) public view returns (bool) {
        require(_ownerOf(tokenId) != address(0), "missing");
        return true;
    }

    function sealState(uint256) public pure returns (uint256) {
        return 1;
    }

    function contentHash(uint256 tokenId) public pure returns (bytes32) {
        return keccak256(abi.encode(tokenId));
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(ISealable).interfaceId || super.supportsInterface(interfaceId);
    }
}

/// @notice `contentHash` reverts when the caller is `hostileTo`.
/// @dev The destination box is that caller. The origin is not, so sealing and bridging succeed.
contract DestHostileSealable is ERC721, ISealable {
    address public hostileTo;

    constructor() ERC721("Hostile", "HSTL") {}

    function setHostileTo(address dest) external {
        hostileTo = dest;
    }

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function isSealed(uint256 tokenId) public view returns (bool) {
        require(_ownerOf(tokenId) != address(0), "missing");
        return true;
    }

    function sealState(uint256) public pure returns (uint256) {
        return 1;
    }

    function contentHash(uint256 tokenId) public view returns (bytes32) {
        require(msg.sender != hostileTo, "destination");
        return keccak256(abi.encode(tokenId, hostileTo));
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(ISealable).interfaceId || super.supportsInterface(interfaceId);
    }
}

contract GasHeavySealable is ERC721, ISealable {
    constructor() ERC721("Heavy", "HVY") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function isSealed(uint256 tokenId) public view returns (bool) {
        require(_ownerOf(tokenId) != address(0), "missing");
        return true;
    }

    function sealState(uint256) public pure returns (uint256) {
        return 1;
    }

    function contentHash(uint256 tokenId) public pure returns (bytes32) {
        uint256 n = tokenId;
        for (uint256 i = 0; i < 100_000; ++i) {
            n = uint256(keccak256(abi.encode(n, i)));
        }
        return bytes32(n);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(ISealable).interfaceId || super.supportsInterface(interfaceId);
    }
}
