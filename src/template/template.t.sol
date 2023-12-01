// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
{IMPORT_FILES}

{TARGET_CONTRACTS}

contract CallTest is Test {
    address public EOA = {EOA};
    address public target; // Can be either contract or address in the case that we dont have the abi
    bool success;
    bytes32 txHash = {TX_HASH};

    function setUp() public {
        target = address({TARGET});
        vm.createSelectFork('Anvil', {BLOCK_NUMBER} - 1);
    }

    function testMimicContractCall() public {
        vm.deal(EOA, EOA.balance);

        vm.startPrank(EOA, EOA);
        {INITIAL_CALL}
    }

}
