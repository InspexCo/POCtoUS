const axios = require('axios');
const rateLimit = require('axios-rate-limit');
const { exec } = require("child_process"); 
const fs = require('fs');

const http = rateLimit(axios.create(), { maxRequests: 3, perMilliseconds: 1000, maxRPS: 3 })

var ENV;

async function setEnv(env){
  ENV = env;
}

async function getContractName(address) { // redundant might optimize latte
  return http.get(`${ENV.API_ENDPOINT}?module=contract&action=getsourcecode&address=${address}&apikey=${ENV.EXPLORER_API_KEY}`)
  .then(result=>{
    if(result.data.status == 1){
      return result.data.result[0].ContractName;
    }else{
      return null;
    }
  })
}

async function getImpl(address) {
  return new Promise((resolve, reject)=>{
    exec(`cast --abi-decode "func()(address)" $(cast storage --rpc-url ${ENV.RPC_URL} ${address} 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc || cast storage --rpc-url ${ENV.RPC_URL} ${address} 0X360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc)`, function(error,stdout,stderr){
      if(error) reject(`Cannot get address of (${address})\n${error}`);
      if (stdout.trim() === '0x0000000000000000000000000000000000000000'){
        resolve(address)
      }else{
        resolve(stdout.trim());
      }
    });
  })
}

async function extractAddresses(data, pullDataFlag=false){
  let strData = JSON.stringify(data)
  const re = /(?<=to":")(0x[0-9a-f]{40})(?=")/g;
  let tmp = strData.match(re);
  let address = new Map();
  tmp.forEach((e)=>{
    address.set(e,{name:"", impl:""})
  })
  if(pullDataFlag){
    await Promise.all(Array.from(address).map(async (k)=>{
      let [name, impl] = await Promise.all([getContractName(k[0]), getImpl(k[0])]).then(result=>{ return [result[0], result[1]]})
      impl = impl=='0x0000000000000000000000000000000000000000'?k:impl;
      name = name==null?"":name;
      let tmp = address.get(k[0]);
      tmp.name = name;
      tmp.impl = impl;
    }))
  }
  return address
}

async function pullData(txHash) {
  return axios({
    method: 'post',
    url: ENV.RPC_URL,
    data: {
      method: "debug_traceTransaction",
      params: [
        txHash,
        {
          tracer: "callTracer"
        }
      ],
      id: 1,
      jsonrpc: "2.0"
    }
  }).then(async (res) => {
    if(res.status == 200){
      if(res.data.error){
        console.error(res.data.error)
        process.exit(1);
      }
      let addressMapping = await extractAddresses(res.data, true);
      let blockData = await getBlockData(txHash);
      console.log("Writing a cache file");
      fs.writeFileSync(__dirname+`/../cache/RPC-${txHash.slice(0,10)}-packed.json`,JSON.stringify({block: blockData, addresses: JSON.stringify(JSON.stringify(Array.from(addressMapping.entries()))), trace: res.data.result}),'utf-8');
      console.log("Finish writing a cache file");
      return {block: blockData, addresses: addressMapping, trace: res.data.result};
    }else{
      console.log('Failed to get data')
      process.exit(1);
    }
  })
}

async function loadData(file){
  let raw = fs.readFileSync(file);
  let parsed = JSON.parse(raw);
  let parsedAddresses = JSON.parse(parsed.addresses);
  parsed.addresses = new Map(JSON.parse(parsedAddresses));
  console.log('Finish Loading');
  return parsed;
}

async function getBlockData(txHash){
  let res = {};
  return new Promise((resolve, reject)=>{
    exec(`cast tx --rpc-url ${ENV.RPC_URL} ${txHash}`, function(error,stdout,stderr){
      if(error) throw new Error(error);
      let lines = stdout.trim().split('\n');
      for(const line of lines){
        let data = line.split(/ +/)
        res[data[0]] = data[1];
      }
      resolve(res);
    })
  });
}

module.exports = {setEnv, pullData, loadData};