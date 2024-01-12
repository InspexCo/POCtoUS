# POCtoUS

[![CC BY-SA 4.0](https://img.shields.io/badge/License-CC%20BY--SA%204.0-lightgrey.svg)](http://creativecommons.org/licenses/by-sa/4.0/)

POCtoUS is pronounced like 'Octopus'🐙 but in reverse. It is a script that aims to help create an environment for analyzing a transaction on the blockchain by leveraging the power of an incredible tool, [Foundry](https://github.com/foundry-rs/foundry).

The tool will create a foundry test file of a given transaction hash. The tool will try to imitate the attacker's attack contract. It also downloads and flattens the contract source code of every related address.

For now, the code looks really messy. We want to express the ideas first, then re-organize them after consider it worth doing.

## Usage
We planned for the script to be able to be executed anywhere. But for now, you need to execute the `main.js` file to run.
```bash
./main.js [txHash] [-f force pulling the rpc] [-r url of the rpc] [-k API key of the block explorer] [-e (optional) endpoint of the block explorers API] [--auto-merge enable auto-merge feature]
```
For example
```bash=
./main.js 0xc42fe1ce2516e125a386d198703b2422aa0190b25ef6a7b0a1d3c6f5d199ffad -r https://eth.llamarpc.com -k ABC1234567
```
The script will create a folder `POC` at the current directory that contains basic necessities for doing the POC.

* Some contracts downloading may fail. If you experience some oddity in the POC file, you can run the script again to re-download the failed files. This might help in some cases.

Normally, the script will pull the data from the RPC once and cache the pulled data. On the next executions, it will use the data from the cache file. You can use the `-f` flag to force the script to pull the data from the RPC instead of using the cache.

### Run the test file
The POC files are forge test files. They can be run with the ol' classic `forge test` command. 

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
- Arbitrum One (https://api.arbiscan.io/api)

## File structure

The script will create a `POC` folder that have the `forge init` setup.
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
git clone https://github.com/InspexCo/POCtoUS.git
cd poctous
npm install
```

## Example

To demonstrate the tool, we choose a transaction that have had an attack occurred, `0xc42fe1ce2516e125a386d198703b2422aa0190b25ef6a7b0a1d3c6f5d199ffad`.
In this transaction, there are callbacks. It is good example to show the quirky side of the tool that might confuse a new user.

### 1. Run the tool

We assume that you have already cloned and completed the npm install step. The tool can be run anywhere, and the `POC` folder will be created in that directory.
In this example, we will run the tool at the root of the repository path using the following command.

```bash=!
src/main.js 0xc42fe1ce2516e125a386d198703b2422aa0190b25ef6a7b0a1d3c6f5d199ffad \
-r https://eth.llamarpc.com \
-k {YOUR_BLOCK_EXPLORER_API_KEY}
```
![image](https://github.com/InspexCo/POCtoUS/assets/97514712/1d52d72b-d916-4fc2-a384-e7bfbcc4ac13)

If there are no errors, the log should appear as follows. The tool will attempt to retrieve the source code of every address called in the transaction from the respective block explorer's API endpoint. The download process might take time, and some downloads may fail. Failed contract downloads may or may not impact the generated POC file. You can rerun the tool to attempt downloading the failed contracts again.

![image](https://github.com/InspexCo/POCtoUS/assets/97514712/0d6e7245-0f9b-45cd-9fca-8696e70d4a9c)

There are three files being generated from the tool:
- `test/CopiedCall(0xc42fe1ce25).t.sol` This is the POC file that can be run with `forge test`.
- `src_poc/0xc42fe1ce/lib.constant.sol` A file that contains the named addresses' address.
- `src_poc/0xc42fe1ce/interface.aggregate.sol` A file that collects the interfaces that being used by the POC file.

### 2. Look at the POC file

The tool has completed its duty. It ain't much, but it's an honest work. The POC file might be runnable for less complex transactions, but in most cases, it will require cleanup. It's our responsibility to tidy up the POC file.
The `C_A_0x9d9820_13d` contract imitates the attacker's exploiting contract. Each function includes comments explaining how it's called and who the caller is. Additionally, there's a comment indicating when a function is duplicated. Handling these aspects will be our next step.

![image](https://github.com/InspexCo/POCtoUS/assets/97514712/779cc260-8351-4749-8e4c-cd399dd6be0b)

The addresses are replaced by constant variables sourced from the lib.constant.sol file to improve the readability of the POC file. The names are gathered from the block explorer's verified contracts.
- If the name has `A_` as a prefix, it means that the addresses are not verified or be an EOA address.
- If the name has `C_` as a prefix, it means that the addresses are contracts that being generated by the tool that meant to represent the respective addresses.

![image](https://github.com/InspexCo/POCtoUS/assets/97514712/9bbb4a30-e84f-48c8-b28f-b9f63a1267c8)

The test contract locates at the bottom of the POC file. It has only one test function `testMimicContractCall()`.
- The `EOA` state is the address of the attacker. It is not necessary to prank being the attacker; you can remove the `vm.deal()` and `vm.startPrank()` from the test.
- The `target` state is the address of the original attacking contract. The address of the state will be overwritten by our imitated contract (a contract that has `C_` as a prefix).

The `setUp()` function will call the `vm.createSelectFork()` function to use the environment from `Anvil`. You can change this line if you want to use other ways to fork the chain to test.

The `testMimicContractCall()` function will deploy the imitated contract and call it with the call data. The function signature can be changed by the tool if the called cannot be decoded.

![image](https://github.com/InspexCo/POCtoUS/assets/97514712/d9b823b6-1039-4273-bc0e-a14ff19e2838)

### 3. Clean the POC file

The imitated contract has one problem; it contains numerous functions with identical signatures. A function is generated for each call made to the contract. For instance, in this scenario, the attacking contract has three calls to the `onERC1155Received()` function, resulting in the creation of three such functions.

![image](https://github.com/InspexCo/POCtoUS/assets/97514712/2831f28f-dbb1-40c0-a2ff-9a1dd9b98c04)

The first and second functions are identical, including their inputs. The third function, however, differs as it lacks a call to the deposit() function. To merge them into a single function, we need to establish a condition for branching the execution. Alternatively, using a more straightforward approach, just count them.

![image](https://github.com/InspexCo/POCtoUS/assets/97514712/dd50b810-89f4-44a6-aa65-4763f02ac958)

### 4. Setup Anvil (Optional)

Since the attack occurred in the past, we need to fork that block to have the environment as same as the real attacking. We use `Anvil` as the default value for the forking chain. If you wish the change, you can edit the endpoint in the `foundy.toml` file. 

![image](https://github.com/InspexCo/POCtoUS/assets/97514712/8118b971-a0fb-4ecd-993f-f1aebc20ae11)

Anvil can be started by simply using `anvil` command. Since we want to fork block, we have to add the `-f` flag and the RPC to the command.

![image](https://github.com/InspexCo/POCtoUS/assets/97514712/5e3589f3-a82d-4245-8a29-b4efb4fde441)

### 5. Do anything with education purpose

Now the test file is ready. You can do anything you want with the POC file. Since we are doing this for educational purposes, we will run the POC using the `forge test -vvvv` command to understand how the transaction works.

The result of the testing is `FAIL`. Why? Because the entire process of the attack doesn't start and end within one transaction. This is a crucial point I want to emphasize to users of the tool: the tool generates a POC from a single transaction only. Simulating the complete attack may require information spanning multiple transactions.

![image](https://github.com/InspexCo/POCtoUS/assets/97514712/fc0607ad-6874-4148-96a9-e389e6e2bcd0)

![image](https://github.com/InspexCo/POCtoUS/assets/97514712/9d49616d-358d-4b38-b3ce-320f96dfd5f8)

## Feature

### Auto-merge

```
--auto-merge
// Automatically merge the duplicated functions in imitated contracts
```
From the example, we have encountered a problem that there are duplicated functions in the imitated contract and the users have to manually merge them. 
By adding the `--auto-merge` flag, the tool will automatically merge any duplicated functions into one single function in the most naive approach.

![image](https://github.com/InspexCo/POCtoUS/assets/97514712/51b84a37-ef4b-4f7d-94de-572a6123d64c)


## Limitation
- The functions that are being called multiple times will be generated multiple times too. The user needs to merge them into one function.
- It can only generate a contract for one transaction at a time. The simulation of multiple transaction attacks will likely fail.
- Some calls that we cannot decode will become low-level calls in which the parameters will not be dynamically altered.
- A call that contains a complex data type will not likely be able to be decoded.
- The users must handle the array literals by themselves.
- The RPC must support the `debug_traceTransaction` method.
- The script will download ALL verified contracts of the address that appear at least once in the transaction though the POC does not need some of them.

## Common errors/issues
- An error after `Pulling data` process.

    They are common errors about the RPC pulling transaction data. The error code are commonly be `-32000` and `-32600`.
    - Try changing the RPC that supports `debug_traceTransaction` method and the RPC must have the data of the block of the transaction, preferably an RPC from an archive node.

- Function with same name and parameter types defined twice.

    It is an intended behavior of the tool (for now). It happens when the functions are called multiple time. It likely happens on a reentrancy attack.
    - The user has to merge them into one function. By merging, the user has to guess how to correctly return the right return value of each call; we have a hint of a call as a comment before the functions.
    - In the new version, you can use the `--auto-merge` flag to let the tool automatically merge the functions.
 
- Invalid array literal
    When the script try decoding a call that have an array datatype as an input, it will decode the array value to be an array literal value, which is mostly unacceptable by solidity compiler.
    - The user must manually declare and construct the array variable and pass it to the call.