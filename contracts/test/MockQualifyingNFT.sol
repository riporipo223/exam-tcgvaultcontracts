// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockQualifyingNFT is ERC721 {
    uint256 private _nextId = 1;

    constructor() ERC721("Mock Qualifying NFT", "MQNFT") {}

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = _nextId;
        _nextId += 1;
        _mint(to, tokenId);
    }
}
