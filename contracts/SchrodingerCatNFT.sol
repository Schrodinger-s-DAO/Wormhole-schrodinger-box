// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

contract SchrodingerCatNFT is ERC721URIStorage {
    uint256 private _nextTokenId;
    string private constant CAT_URI = "ipfs://bafybeighqiefcio4swqevf6dw5fr33isndjl3azlm2s2v6hzjni7nhtubq";

    constructor() ERC721("CAT NFT", "SCAT") {
        _nextTokenId = 1;
    }

    /// @notice Mints a cat NFT to `to`.
    function mint(address to) external returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, CAT_URI);
        return tokenId;
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}