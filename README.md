# POCtoUS

[![CC BY-SA 4.0](https://img.shields.io/badge/License-CC%20BY--SA%204.0-lightgrey.svg)](http://creativecommons.org/licenses/by-sa/4.0/)

POCtoUS is pronounced like 'Octopus'🐙 but in reverse. It is a script that aims to help create an environment for analyzing a transaction on the blockchain by leveraging the power of an incredible tool, [Foundry](https://github.com/foundry-rs/foundry).

For now, the code looks really messy. We want to express the ideas first, then re-organize them after consider it worth doing.

## Usage
We planned for the script to be able to be executed anywhere. But for now, you need to execute the `main.js` file to run.
```bash
./main.js [txHash] [-f force pulling the rpc] [-r url of the rpc] [-k API key of the block explorer] [-e (optional) endpoint of the block explorers API]
```
For example
```bash=
./main.js 0xc42fe1ce2516e125a386d198703b2422aa0190b25ef6a7b0a1d3c6f5d199ffad -r https://eth.llamarpc.com -k ABC1234567
```
The script will create a folder `POC` at the current directory that contains basic necessities for doing the POC.

* Some contracts downloading may fail. If you experience some oddity in the POC file, you can run the script again to re-download the failed files. This might help in some cases.

Normally, the script will pull the data from the RPC once and cache the pulled data. On the next executions, it will use the data from the cache file. You can use the `-f` flag to force the script to pull the data from the RPC instead of using the cache.

### Run the test file
The POC files are forge test files. They can be run with the ol' class `forge test` command. 

In the test file, we specified that the test would fork from `Anvil` environment. We suggest running the `anvil` beforehand, which would be good for the testing.
```
anvil -f <RPC_URL> --no-mining
```
### Required Environment
The script requires the RPC and Etherscan API keys to operate. You can set them on the command line.
```bash
export ETH_RPC_URL=<your-rpc-url>
export ETHERSCAN_API_KEY=<your-etherscan-api-key>
```

You can also specify them using the `-r` and `-k` flags when executing the script.
```bash=
./main.js 0xc42fe1ce2516e125a386d198703b2422aa0190b25ef6a7b0a1d3c6f5d199ffad \
-r https://eth.llamarpc.com \
-k ABC1234567
```
The `-e` flag is totally optional. The default of the API endpoint will be set to `https://api.etherscan.io/api`. When you need to use the script on another chain that does not in the `Predefined endpoint chain` list, you need to specify the endpoint through the `-e` flag. 

## Predefined endpoint chain
- Ethereum Mainnet (https://api.etherscan.io/api)
- Goerli (https://api-goerli.etherscan.io/api)
- OP Mainnet (https://api-optimistic.etherscan.io/api)
- BNB Smart Chain Mainnet (https://api.bscscan.com/api)
- BNB Smart Chain Testnet (https://api-testnet.bscscan.com/api)

## File structure

The scipt will create a `POC` folder that have the `forge init` setup.
#### Sourcecode
The script will download all verified contract the are interacted on the transaction. The downloaded sourcecode will be flattened and have the abis and interfaces extracted. They will be stored under the `src_poc` folder and each `transaction` folder.

#### Test file
The testfile (POC) is a forge test file. It will be created under the `test` folder. You can run the test file like any other forge test file by using `forge test` command.
```
POC
├── README.md
├── cache
├── foundry.toml
├── lib
├── out
├── script
├── src
├── src_poc
│   └── 0xabcdef // First 4 bytes of the tx
│       ├── (Contracts replate to the tx)
│       │   ├── (ContractName).abi.json
│       │   ├── (ContractName).interface.sol
│       │   └── (ContractName).sol
│       ├── interface.aggregate.sol // the interface that being used by the POC
│       └── lib.constant.sol // the constrant value of the addresses
└── test
    └── CopiedCall(0xabcdef).t.sol // The POC file (almost) ready to be tested
```

## Installation

In this version, you need to install the dependencies and execute the `main.js` file to use.
```bash
git clone https://gitlab.com/inspexco/tools/poctous
cd poctous
npm install .
```

## Limitation
- The functions that are being called multiple times will be generated multiple times too. The user needs to merge them into one function.
- It can only generate a contract for one transaction at a time. The simulation of multiple transaction attacks will likely fail.
- Some calls that we cannot decode will become low-level calls in which the parameters will not be dynamically altered.
- A call that contains a complex data type will not likely be able to be decoded.
- The users must handle the array literals by themselves.
- The RPC must support the `debug_traceTransaction` method.
- The script will download ALL verified contracts of the address that appear at least once in the transaction though the POC does not need some of them.
