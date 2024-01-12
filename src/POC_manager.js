const { exec } = require("child_process"); 
const axios = require('axios');
const rateLimit = require('axios-rate-limit');
const fs = require('fs');
const templateManager = require("./template_manager.js");
const utils = require('./utils.js');
const { Mapper } = require('./mapper.js')

var ENV;
var rootPath = ''
const http = rateLimit(axios.create(), { maxRequests: 3, perMilliseconds: 1000, maxRPS: 3 })

function setupEnv(_env){
  ENV = _env;
}

async function foundrySetup(path, txHash) {
  rootPath = path;
  console.log(`Creating forge folder at ${path}`);
  return new Promise((resolve)=>{
    exec("forge init --force --no-git", {cwd: path}, function(error,stdout,stderr){
      if(error){
        throw new Error(error);
      }
      try {
        // Remove default contract
        fs.unlinkSync(path + '/src/Counter.sol');
        fs.unlinkSync(path + '/script/Counter.s.sol');
        fs.unlinkSync(path + '/test/Counter.t.sol');
      } catch(e){}
      if(!fs.existsSync(path + '/src_poc')){
        fs.mkdirSync(path + '/src_poc');
      }
      initEnvToml(path);
      const txPath = path + '/src_poc/' + utils.getTxHashTmpName(txHash)
      if(!fs.existsSync(txPath)){
        fs.mkdirSync(txPath), {recursive: true};
      }
      console.log('Finish setup')
      resolve();
    });
  });
}

async function isProxy(address) {
  return new Promise((resolve, reject)=>{
    exec(`cast abi-decode "func()(address)" $(cast storage --rpc-url ${ENV.RPC_URL} ${address} 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc || cast storage --rpc-url ${ENV.RPC_URL} ${address} 0X360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc)`, function(error,stdout,stderr){
      if(error) reject(`Cannot get address\n${error}`);
      if (stdout.trim() === '0x0000000000000000000000000000000000000000'){
        resolve(address)
      }else{
        resolve(stdout.trim());
      }
    });
  })
}

async function getContractData(address) {
  return http.get(`${ENV.API_ENDPOINT}?module=contract&action=getsourcecode&address=${address}&apikey=${ENV.EXPLORER_API_KEY}`)
  .then(result=>{
    if(result.data.status == 1){
      return result.data.result[0];
    }else{
      return null;
    }
  })
}

async function getSource(downloadAddress, txRootPath){
  return new Promise((resolve, reject)=>{
    exec(`cast src -d ${txRootPath} --etherscan-api-key ${ENV.EXPLORER_API_KEY} ${downloadAddress}`, {cwd: rootPath}, function(error,stdout,stderr){
      if(error) resolve(false);
      resolve(true);
    });
  })
}

async function getByte(address){
  return new Promise((resolve, reject)=>{
    exec(`cast co -r ${ENV.RPC_URL} ${address}`, {cwd: rootPath}, function(error,stdout,stderr){
      if(error) reject(error);
      resolve(stdout);
    });
  })
}

async function writeInterfaceFile(abiPath, outPath, cName){
  return new Promise((resolve, reject)=>{
    exec(`cast i -n ${cName} -o ${outPath} ${abiPath}`, {cwd: rootPath}, function(error,stdout,stderr){
      if(error) resolve("");
      resolve(outPath);
    });
  })
}

async function downloadSourceCode(toLoadAddresses, meta, isForced) {
  console.log('Start:  Downloading source code')
  let toDownload = toLoadAddresses.map(async e=>{
    return new Promise(async (resolve)=>{
      if(!isForced && meta.isContractLoaded(e)) {
        resolve();
        return;
      }
      let contractAddr = await isProxy(e);
      let contractData = await getContractData(contractAddr); // ABI,SourceCode,ContractName,CompilerVersion,OptimizationUsed,Runs,ConstructorArguments,EVMVersion,Library,Proxy,Implementation

      if(contractData == null){
        console.log(`${e}: is skipped due to an error`)
      }else if(contractData.ContractName == ''){
        console.log(`${e}:${e==contractAddr?'':contractAddr} is not verified`)
        let res = await getByte(contractAddr);
        if (res.trim() == '0x') {
          console.log(`${contractAddr}  is an EOA`);
        }else{
          // Not sure what to do
        }
      }else{
        let contractName = contractData.ContractName;
        console.log(`${e}:${e==contractAddr?'':contractAddr} is ${contractName}`)
          console.log(`Flattening . . . (${contractAddr})`);
          let flattenSrc;
          if(utils.isJsonSrc(contractData.SourceCode)){
            flattenSrc = utils.JSONSrcHandler(contractData.SourceCode);
          }else{
            flattenSrc = utils.srcFlatten(contractData.SourceCode);
          }
          let contractRootPath = `${meta.srcPath}/${e}`;
          if(!fs.existsSync(`${meta.srcPath}/${e}`)){
            fs.mkdirSync(`${meta.srcPath}/${e}`, {recursive: true});
          }
          fs.writeFileSync(contractRootPath+`/${contractName}.sol`, flattenSrc, 'utf-8');
          fs.writeFileSync(contractRootPath+`/${contractName}.abi.json`, contractData.ABI, 'utf-8'); // write ABI
  
          let interfaceRes = await writeInterfaceFile(contractRootPath+`/${contractName}.abi.json`, contractRootPath+`/${contractName}.interface.sol`, contractName)
  
          meta.loadedContract = {address:e, path: contractRootPath+`/${contractName}.sol`, interface: interfaceRes}
      }
      resolve();
    })
  })
  await Promise.all(toDownload);
  console.log('Finish: Downloading source code')
}

function initEnvToml(rootPath){
  console.log('Create foundry.toml')
  let toml = fs.readFileSync(__dirname+'/template/foundry.template.toml', 'utf-8');
  fs.writeFileSync(rootPath+ '/foundry.toml', toml, 'utf-8');

  if(!fs.existsSync(rootPath + '/.metadata.json')){
    console.log('Create .metadata.json')
    let meta = fs.readFileSync(__dirname+'/template/.metadata.template.json', 'utf-8');
    fs.writeFileSync(rootPath+ '/.metadata.json', meta, 'utf-8');
  }
}

function loadMetadata(txHash){
  let raw = fs.readFileSync(rootPath+'/.metadata.json', 'utf-8');
  let meta = JSON.parse(raw);
  if(txHash in meta.tx) return meta;
  meta.tx[txHash] = {addresses:{}, srcPath:rootPath+'/src_poc/'+utils.getTxHashTmpName(txHash), loadedSrc:{}};
  return meta;
}
function determineTargetContracts(trace, isRoot=true){
  let res = [];
  if(trace.type == 'CREATE' || isRoot){
    res.push(trace.to)
    if('calls' in trace){
      for(const c in trace.calls){
        res.push(...determineTargetContracts(trace.calls[c], false));
      }
    }
  }
  return res;
}

async function initStub(data, metadata){
  let mapper = new Mapper(rootPath+`/src_poc/${utils.getTxHashTmpName(data.block.hash)}`);
  templateManager.initParam(rootPath+'/test', ENV.FEATURES);
  let contractCalls = {};
  utils.analyzeContractCall(data.trace, contractCalls)
  await mapper.loadSigFromMeta(metadata);
  let targetContracts = determineTargetContracts(data.trace);
  let usedInterface = [];
  let unknownSig = {};
  for(const a of targetContracts){
    await templateManager.generateTargetContractCode(contractCalls,metadata,a, mapper,usedInterface, unknownSig);
  }
  await templateManager.writeTestFile(rootPath+`/test/CopiedCall(${data.block.hash.slice(0,12)}).t.sol`, metadata, data.trace, data.block, unknownSig)
  await templateManager.createConstantFile(metadata, metadata.srcPath+'/lib.constant.sol');
  await templateManager.createInterfaceFile(metadata, metadata.srcPath+'/interface.aggregate.sol', usedInterface);
}

module.exports = {foundrySetup, downloadSourceCode, initStub, loadMetadata, setupEnv};