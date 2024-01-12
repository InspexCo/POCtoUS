#!/usr/bin/env node
'use strict';

const fs = require('fs');
const rpc_source = require('./rpc_source.js');
const poc = require('./POC_manager.js');
const utils = require('./utils.js');
const { ArgumentParser } = require('argparse');
const { Metadata } = require("./metadata.js");

var ENV = {
  RPC_URL:'',
  EXPLORER_API_KEY: '',
  API_ENDPOINT: '',
  CHAIN_ID: '',
  FEATURES: {}
}
let main = async () => {
  let args = argHandle();
  let data;

  await initEnv(args);
  
  if(args.txHash != '') { // Pull from RPC
    if( !args.f && fs.existsSync(__dirname+`/../cache/RPC-${utils.getTxHashTmpName(args.txHash)}-packed.json`)){
      console.log(`Loading cache data of ${args.txHash}`)
      data = await rpc_source.loadData(__dirname+`/../cache/RPC-${utils.getTxHashTmpName(args.txHash)}-packed.json`);
    }else{
      await rpc_source.setEnv(ENV);
      console.log(`Pulling data of ${args.txHash}`)
      data = await rpc_source.pullData(args.txHash);
    }
  } else {
    console.log('Please specify the tx hash')
    process.exit(1);
  }
  const rootPath = createFolder();
  
  await poc.foundrySetup(rootPath, args.txHash);

  let meta = new Metadata(rootPath, args.txHash);

  poc.setupEnv(ENV);
  meta.populatedAddresses(data.addresses, data.trace)
  let verifiedContract = meta.verifiedAddress;
  await poc.downloadSourceCode(verifiedContract, meta, args.f);
  meta.saveMetadata();
  console.log('Init stub')
  await poc.initStub(data, meta);
}

let  argHandle = () => {
  const parser = new ArgumentParser();
  parser.add_argument('txHash', { help: 'Transaction hash', nargs:'?' , default: '' });
  parser.add_argument('-f', { help: 'force pull mode', action: 'store_true' });
  parser.add_argument('-r', { help: 'RPC URL', type: 'str', default: ''});
  parser.add_argument('-k', { help: 'API Key', type: 'str', default: ''});
  parser.add_argument('-e', { help: 'API Endpoint', type: 'str', default: ''});
  parser.add_argument('--auto-merge', { help: 'Enable auto-merge feature', action: 'store_true'});
   
  return parser.parse_args()
}

let initEnv = async (args) => {
  ENV.RPC_URL = args.r==''?process.env.ETH_RPC_URL:args.r;
  if(!ENV.RPC_URL || ENV.RPC_URL == ''){
    console.error('RPC_URL not found, please specify through `export ETH_RPC_URL={RPC_URL}` or `-r {RPC_URL}`')
    process.exit(1);
  }
  ENV.EXPLORER_API_KEY = args.k==''?process.env.ETHERSCAN_API_KEY:args.k;
  if(!ENV.EXPLORER_API_KEY || ENV.EXPLORER_API_KEY == ''){
    console.error('EXPLORER_API_KEY not found, please specify through `export ETHERSCAN_API_KEY={EXPLORER_API_KEY}` or `-k {EXPLORER_API_KEY}`')
    process.exit(1);
  }
  ENV.API_ENDPOINT = args.e;
  ENV.CHAIN_ID = await utils.getChainID(ENV.RPC_URL);
  ENV.API_ENDPOINT = getChainEndpoint(ENV.API_ENDPOINT, ENV.CHAIN_ID);
  if(!ENV.API_ENDPOINT || ENV.API_ENDPOINT == ''){
    console.error('API_ENDPOINT not found, please specify through `-e {API_ENDPOINT}`, e.g., -e https://api.etherscan.io/api')
    process.exit(1);
  }
  ENV.FEATURES.AUTO_MERGE = {enabled: args.auto_merge, duped:{}};
  console.debug(`END POINT at ${ENV.API_ENDPOINT}`);
}

function getChainEndpoint(endpoint, chainId){
  let data = JSON.parse(fs.readFileSync(__dirname+'/chain_list.json', 'utf-8'));
  if(endpoint == ''){
    if(chainId in data){
      if(data[chainId].api != ''){
        return data[chainId].api;
      }else{
        console.error(`Chain #${chainId} (${data[chainId].name}) not found.`)
        console.error(`Please use '-e' to specify the API endpoint of the block explorer. ${data[chainId].explorer}`)
        process.exit(1);
      }
    }else{
      console.error(`Chain #${chainId} (${data[chainId].name}) not found.`)
      console.error(`Please use '-e' to specify the API endpoint of the block explorer.`)
      process.exit(1);
    }
  }
  return endpoint;
}

let createFolder = () => {
  const path = process.cwd() + '/POC';
  if(!fs.existsSync(path)){
    fs.mkdirSync(path);
  }
  return path;
}

main();