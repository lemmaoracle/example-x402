// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Groth16Verifier} from "../build/CircuitVerifier.sol";

contract Deploy is Script {
  function run() external {
    uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

    vm.startBroadcast(deployerPrivateKey);
    Groth16Verifier verifier = new Groth16Verifier();
    vm.stopBroadcast();

    console.log("Groth16Verifier deployed:", address(verifier));
  }
}