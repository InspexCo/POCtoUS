const { exec } = require("child_process"); 
const axios = require('axios');
const fs = require('fs');


async function toChecksumAddress(address) {
  return new Promise((resolve)=>{
    exec(`cast to-checksum ${address}`, function(error,stdout,stderr){
      resolve(stdout.trim());
    })
  })
}

function hexToDecString(hex){
  return BigInt(hex).toString();
}

function stripANSIColor(orig){
  return orig.replaceAll(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,'').replaceAll(/ \[[^\]]+\]/g,'');
}
async function decodeInAndOutFunction(funcSig, inputHex){
  let dataPart = inputHex.slice(10);
  let inputSig = /^function ([^\(]+\([^\)]*\))[^\(]*(\([^\)]+\))?$/.exec(funcSig);
  let outType;
  if(inputSig[2])
  outType = inputSig[2].slice(1,inputSig[2].length-1)

  return new Promise((resolve)=>{
    exec(`cast ad --input "${inputSig[1]}" ${dataPart}`, function(error,stdout,stderr){
      let out = stripANSIColor(stdout.trim()).split('\n')
      resolve([out,outType])
    })
  })
}

function sumAddress(addr){ // my little hash
  let _addr = addr.slice(2);
  let res = 0;
  for(const c in _addr){
    res += parseInt(_addr[c],16)
  }
  return res.toString(16);
}

function analyzeContractCall(root, res){
  let to = root.to;
  let sig = root.type=='CREATE'?'CREATE':root.input.slice(0,10);
  let value = hexToDecString(root.value || '0x0');
  let callOut = [];
  if('calls' in root){
    callOut.push(...root.calls.map(e=>{
      let {calls:_, ...filtered} = e;
      return filtered;
    }))
  }
  if(to in res){
    if(sig in res[to]){
      res[to][sig].payable = res[to][sig].payable || value>0;
      res[to][sig].call.push({in: {input:root.input, value: value, output: root.output||'', from: root.from}, out: callOut});
    }else{
      res[to][sig] = {payable: value>0, call: [{ in: {input:root.input, value: value, output: root.output||'', from: root.from}, out: callOut}] };
    }
  }else{
    res[to] = {};
    res[to][sig] = {payable: value>0, call: [{ in: {input:root.input, value: value, output: root.output||'', from: root.from}, out: callOut}] };
  }
  if('calls' in root){
    for(const c of root.calls){
      analyzeContractCall(c,res);
    }
  }
}

async function guessABI(call){
  let calldata = call.input;
  let sig = calldata.slice(0,10);
  let data = await axios.get(`https://sig.eth.samczsun.com/api/v1/signatures?function=${sig}`).then(async result=>{
    let res = {name:"", type:[], param:[], out:[]};
    if(result.data.ok){
      for(const funcSig of result.data.result.function[sig]){
        let param = funcSig.name.slice(funcSig.name.indexOf('(')+1,funcSig.name.length-1).split(',');// Not work in a complex datatype
        let name = funcSig.name.slice(0, funcSig.name.indexOf('('));
        if(calldata.length == 10){// No parameters
          if(param[0].length == 0) {
            res.name = name;
            break;
          }
        }else{
          let decodedparam = await new Promise((resolve)=>{
            exec(`cast --abi-decode --input "${funcSig.name}" "${calldata}"`, function(error,stdout,stderr){
              resolve(stripANSIColor(stdout.trim()).split('\n'));
            })
          });
          if(decodedparam.length == param.length){
            res.name = name;
            res.type = param;
            res.param = decodedparam;
            break;
          }else{
            console.log('GuessABI: Complex Input, do not support, for now')
          }
        }
      }
    }
    res.sig = sig;
    res.view = call.type == 'STATICCALL';
    res.payable = !res.view && (call.value != '0x0' || (res.payable || false));
    res.value = hexToDecString(call.value||'0x0');
    return res;
  });
  return data;
} 

function getTmpInterfaceName(address) {
  return `I${address.slice(0,12)}`;
}

function formatTypes(types, tmpParam=false){
  const memoryType = ["string", "bytes"];
  let paramCount = 0;
  let res = [];

  for(const t of types){
    if(memoryType.includes(t) || t.includes("[]")){
      res.push(`${t} memory`+(tmpParam?` param${paramCount++}`:''));
    }else{
      res.push(t+(tmpParam?` param${paramCount++}`:''));
    }
  }
  return res.join(',');
}

function formatInputWithType(inputData, inputType){
  // TODO: handle complex datatype
  let res = [];
  for(let i=0; i<inputType.length; i++){
    if(inputType[i] == 'string'){
      res.push(`"${inputData[i]}"`);
    }else if(inputType[i] == 'bytes'){
      res.push(toHexString(inputData[i]));
    }else{
      res.push(inputData[i]);
    }
  }
  return res.join(',');
}

function toHexString(hex){
  if(hex.length <= 2) return `""`;
  return `hex"${hex.slice(2)}"`;
}

function getTxHashTmpName(txHash){
  return txHash.slice(0,10);
}

function truncSig(bytesWith0x){
  return bytesWith0x.slice(0,10);
}

function isJsonSrc(item) { // don't sweat it
  return item[0]=='{'&&item[item.length-1]=='}'
}

function getFileNameFromPath(path){
  return path.split(/[/\/]/).pop();
}

function JSONSrcHandler(jsonSrc){
  let parsed;
  try{
    parsed = JSON.parse(jsonSrc.slice(1,-1))
  }catch(error){
    console.error('Error parsed this file: SKIP')
    return '';
  }
  if(parsed.language != 'Solidity') return jsonSrc;
  let source = parsed.sources;
  let index = [];
  let chunk = [];
  for(const s of Object.keys(source)){
    let tmp = {s:getFileNameFromPath(s), d:[], id:[], v:false}
    let importLine = source[s].content.matchAll(/import [^"]*"([^"]*)";/g)
    if(importLine){
      for(const i of importLine){
        tmp.d.push(getFileNameFromPath(i[1]));
      }
    }
    chunk.push(source[s].content.replaceAll(/import [^"]*"([^"]*)";/g, "// import \"$1\";").replaceAll('SPDX-License-Identifier','(SPDX)-License-Identifier'));
    index.push(tmp);
  }
  for(const i of index){
    for(const dep of i.d){
      for(const [j,j_e] of index.entries()){
        if(j_e.s == dep)
          i.id.push(j);
      }
    }
  }
  let _topoSort = (target, src, idx)=>{
    if(src[idx].v) return
    src[idx].v = true;
    let id = [...src[idx].id]
    if(src[idx].d.length == 0){ // library
      target.unshift(idx)
      return
    }
    while(id.length>0){
      _topoSort(target, src, id.pop())
    }
    target.push(idx)
  }
  let sortIdx = [];
  for(const [i,_] of index.entries()){
    _topoSort(sortIdx, index, i);
  }
  let sortChunk = sortIdx.map(e=>{
    return chunk[e];
  })
  return sortChunk.join('\n');
}

function srcFlatten(code){
  let chunk = [];
  let dependency = {};
  let tmp = [];
  for(const line of code.split(/\r?\n/)){
    if(line.includes('pragma solidity')){
      chunk.push(tmp);
      tmp = [];
    }
    tmp.push(line);
  }
  chunk.push(tmp);
  chunk.shift();

  for(const i of chunk.keys()){
    let chunkTmp = {c:[], d:[], id:[], v:false}
    chunk[i] = chunk[i].join('\n')
    let c = chunk[i].matchAll(/contract ([\w\d_]+) (is )?([\w\d_, ]+)?\s*{/g);
    if(c){
      let depTmp = new Set();
      for(const j of c){
        // console.log(j)
        chunkTmp.c.push(j[1])
        if(j[3]){
          let deps = j[3].replaceAll(/\s/g,'').split(',');
          for(const d of deps){
            if(!chunkTmp.c.includes(d)) // prevent internal resolved dependency case
            depTmp.add(d);
          }
        }
      }
      chunkTmp.d = Array.from(depTmp);

    }
    dependency[i] = chunkTmp;;
  }

  for(const c_i of Object.keys(dependency)){ // bigO? complexity? what are those? I am naive
    for(const dep of dependency[c_i].d){
      for(const cd_i of Object.keys(dependency)){
        if(dependency[cd_i].c.includes(dep)){
          dependency[c_i].id.push(cd_i)
        }
      }
    }
  }
  let _topoSort = (target, src, idx)=>{
    if(src[idx].v) return
    src[idx].v = true;
    let id = [...src[idx].id]
    if(src[idx].c.length == 0){ // library
      target.unshift(idx)
      return
    }
    while(id.length>0){
      _topoSort(target, src, id.pop())
    }
    target.push(idx)
  }
  let resIdx = [];
  for(const c_i of Object.keys(dependency)){
    _topoSort(resIdx,dependency, c_i)
  }
  if(resIdx.length != chunk.length)
    console.error('There is an error about the contract flattening')
  let sortChunk = resIdx.map(e=>{
    return chunk[e];
  })
  return sortChunk.join('\n');
}
async function getFuncSig(funcSig){
  return new Promise((resolve)=>{
    exec(`cast sig "${funcSig}"`, function(error,stdout,stderr){
      if(error) throw error;
      resolve(stdout.trim())
    })
  })
}
function getCreatedAddresses(traceRoot){
  let res = [];
  if(traceRoot.type == 'CREATE'){
    res.push(traceRoot.to)
  }
  if('calls' in traceRoot){
    for(const c of traceRoot.calls){
      res.push(...getCreatedAddresses(c));
    }
  }
  return res;
}
function filterNullByte(src){
  return src.map((e)=>{
    return e=='0x'?`""`:e;
  })
}
function outFileDebug(data, id=''){
  fs.writeFileSync(__dirname+'/tmp'+id,data,'utf-8');
  console.log(`DEBUG: file create at ${__dirname+'/tmp'}`)
}

function inFileDebug(id=''){
  return fs.readFileSync(__dirname+'/tmp'+id,'utf-8');
}

function getChainID(rpc){
  return axios({
    method: 'post',
    url: rpc,
    data: {
      method: "eth_chainId",
      params: [],
      id: 1,
      jsonrpc: "2.0"
    }
  }).then((res)=>{
    return parseInt(res.data.result,16)
  })
}

function getRandString(len){
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let res = ''
  while(res.length<len){
    res += characters.charAt(Math.floor(Math.random() * 62));
  }
  return res
}

function randonTupleParamName(params){
  let res = params.split(',').map((e)=>{
    let rnd = getRandString(4);
    return e.trim()+'_'+rnd;
  }).join(', ');
  return res
}

function paramReplace(param, target, replacer){
  return JSON.parse(JSON.stringify(param).replace(target, replacer))
}

module.exports = {paramReplace, getRandString, randonTupleParamName, getChainID, toChecksumAddress, hexToDecString, guessABI, getTmpInterfaceName, formatInputWithType, formatTypes, toHexString, getTxHashTmpName, truncSig, srcFlatten, isJsonSrc, JSONSrcHandler,outFileDebug,inFileDebug,getCreatedAddresses, sumAddress, analyzeContractCall, decodeInAndOutFunction, filterNullByte, getFuncSig, randonTupleParamName};