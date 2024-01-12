const fs = require('fs');
const path = require('path');
const utils = require('./utils.js');
const { guessAbiEncodedData } = require('@openchainxyz/abi-guesser');

var fileParams = {
  path: '', // abolute path of the test file
  imports: [], // list of path of file that willl be imported in the test file
  targetContract: [], // each comtains the sol code of a traced contract {name:"", code:""}
}

var FEATURES;

var contractTemplate = '';

function initParam(path, _f){
  fileParams.path = path;
  contractTemplate = copyAndReplaceFile(__dirname+'/template/contract.template.sol','',{});
  FEATURES = _f;
}

function copyAndReplaceFile(src, dst, replacer, postProcess=null){
  let data = fs.readFileSync(src, 'utf-8');

  for (const [k, v] of Object.entries(replacer)) {
    data = data.replaceAll(`{${k}}`, v);
  }

  if(postProcess){
    postProcess(data).then((data)=>{
      if(dst != ''){
        fs.writeFileSync(dst, data, 'utf-8');
        console.log(`Created: ${dst}`);
      }
    });
  }else{
    if(dst != ''){
      fs.writeFileSync(dst, data, 'utf-8');
      console.log(`Created: ${dst}`);
    }
    return data
  }
}

function registerImportFile(filePath){
  if(fileParams.path == '') throw new Error('Init the path first');
  fileParams.imports.push(`import "./${path.relative(fileParams.path, filePath)}";`)
}

function addressReplace(src, metadata, origin){
  return src.replaceAll(/0x[0-9a-fA-F]{40}/g,(m)=>{
    let a = m.toLowerCase();
    let meta = metadata.addresses[a]
    return meta?origin==a?'address(this)':meta.isCreated?meta.nickname:'C.'+meta.nickname:m;
  })
}

function registerContract(genContractCode, metadata, address, createdAddress, structTracker){
  let auxParams = preRegisterContract(genContractCode, metadata, address, createdAddress, structTracker);
  let replacer = {'CONTRACT_NAME':'', 'AUX_VAR':'', 'FUNCTIONS':'', 'STRUCTS':''};
  let res = contractTemplate.slice(0);
  for(const c of genContractCode){
    let tmp = `\n\t${c[2]}\n\t${c[0]}{\n\t\t${c[1]}\n\t}\n`;
    replacer.FUNCTIONS += tmp;
  }
  replacer.CONTRACT_NAME = 'C_'+metadata.getNickName(address);
  for(const a of createdAddress){
    replacer.AUX_VAR += `address ${a};\n\t`
  }
  for(const v of auxParams.variables){
    replacer.AUX_VAR += `${v};\n\t`
  }

  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let struct = [];
  for(const s in structTracker){
    let count = 0;
    let elements = [];
    const len = characters.length;
    s.split(',').map((e)=>{
      elements.push(`${e} ${characters[count++ % len]};`)
    })
    struct.push(`struct ${structTracker[s]}{\n\t\t${elements.join('\n\t\t')}\n\t}`)
  }
  replacer.STRUCTS += struct.join('\n\n\t');

  for (const [k, v] of Object.entries(replacer)) {
    res = res.replaceAll(`{${k}}`, v);
  }
  res = addressReplace(res, metadata, address);

  fileParams.targetContract.push(res);
}

async function createConstantFile(metadata, dst){
  let addr = metadata.addresses;
  let res = [];
  for(const a in addr){
    let name = addr[a].nickname;
    res.push(`address constant ${name} = `.padEnd(45, ' ') + `${await utils.toChecksumAddress(a)};`)
  }
  copyAndReplaceFile(__dirname+'/template/lib.constant.template.sol', dst, {
    CONSTANT_SECTION: res.join('\n\t')
  });
  registerImportFile(dst);
}

function createInterfaceFile(metadata, dst, usedInterface){
  let importInterface = [];
  let customInterface = '';
  let interfaceDict = {}
  let sigDup = {}
  for(const p of usedInterface){
    let q = p[1];
    if(q.interfaceName in interfaceDict){
      if(!(q.functionSig in interfaceDict[q.interfaceName]) && !(p[0] in sigDup[q.interfaceName])){
        interfaceDict[q.interfaceName][q.functionSig] = true;
        sigDup[q.interfaceName][p[0]] = true;
      }
    }else{
      interfaceDict[q.interfaceName] = {};
      interfaceDict[q.interfaceName][q.functionSig] = true;
      sigDup[q.interfaceName] = sigDup[q.interfaceName] || {};
      sigDup[q.interfaceName][p[0]] = true;
    }
  }
  
  for(const i in interfaceDict){
    let tmp = `interface ${i} {\n\t`;
    for(const f in interfaceDict[i]){
      tmp += `${f};\n\t`
    }
    tmp = tmp.slice(0,tmp.length-1);
    customInterface += tmp +'}\n\n'
  }

  copyAndReplaceFile(__dirname+'/template/interface.aggregate.template.sol', dst, {
    IMPORT_FILES: importInterface.join('\n'),
    CUSTOM_INTERFACE: customInterface
  });
  registerImportFile(dst);
}

function generateStruct(params, tracker){
  let strParam = JSON.stringify(params);
  let tup = strParam.match(/tuple\(([^\)]+)\)/);
  if(tup){
    let base = tup[1]
    if(!(base in tracker)) {
      let name = 'S_' + utils.getRandString(5);
      tracker[base] = name;
    }
    return [JSON.parse(strParam.replace(tup[0],tracker[base])), base]
  }
  return [params, null]
}

async function generateTargetContractCode(analyzedCall, metadata, tAddress, mapper, usedInterface, unknownSig){
  console.log(`Generate contract: ${tAddress}`)
  let aCall = analyzedCall[tAddress];
  let runNumber = 0;
  let createdAddress = [];
  let structTracker = {};
  metadata.addresses[tAddress]
  let res = [];
  for(const sig in aCall){
    for(const _call of aCall[sig].call){
      // Generate function signature
      let functionSig;
      let functionBody = [];
      let functionDesc = [];
      let outType;
      let value = _call.in.value;
      if(sig=='CREATE'){
        functionSig = `constructor()${aCall[sig].payable?' payable':''}`;
      }else if(sig=='0x'){
        functionSig = `fallback() external${aCall[sig].payable?' payable':''}`;
        functionDesc.push('// This function MAY duplicated. Please merge them manually, if there are any.');
        let desc = `// ${metadata.getVarName(_call.in.from)} -> ${value=='0'?'':`{value: ${value}}`}(${utils.toHexString(_call.in.input)})`;
        functionDesc.push(desc);
      }else{
        let decodedCall = {};
        let hasReturn = false;
        let desc;
        
        if(sig in mapper.funcSig){ // If we have the sig in the loaded sourcecode
          let tmp = mapper.pickOne(sig)[0].functionSig;
          usedInterface.push([sig,mapper.pickOne(sig)[0]]);
          outType = tmp.match(/\(([^\)]*)\)$/)
          tmp = tmp.replace(/\)$/,' retr)')
          let name = tmp.match(/function ([^\s\()]+)\(/)[1]
          functionSig = tmp;
          let decodedInOut = await utils.decodeInAndOutFunction(tmp, _call.in.input);
          let filteredNull = utils.filterNullByte(decodedInOut[0])
          desc = `// ${metadata.getVarName(_call.in.from)} -> ${name}${value=='0'?'':`{value: ${value}}`}`;
          desc += `(${filteredNull.join(',')})`
          if(outType){
            decodedCall.out = [outType[1]]
            hasReturn = true
          }
        }else{
          decodedCall = await utils.guessABI(_call.in); // better make a cache
          let decodedOut = [];
          if(_call.in.output != ''){
            decodedOut = guessAbiEncodedData(_call.in.output)[0]; // better make a cache
            decodedCall.out = decodedOut.type == typeof []?decodedOut.type:[decodedOut.type];
            if(decodedCall.out[0].includes('tuple'))
            [decodedCall.out, _] = generateStruct(decodedCall.out, structTracker)
          }
          let name = decodedCall.name
          let paramType = decodedCall.type
          if(name == ''){ // for now, give a temp name. The right func def should be in the sourcecode file // TODO: fetch interfac from main source code. ALT: chung it into fallback
            name = `TMP_${decodedCall.sig}`
            let calldata = `0x${_call.in.input.slice(10)}`
            let newStruct;
            try{
              let gessParam = guessAbiEncodedData(calldata)[0]
              paramType = typeof gessParam.type == typeof []?gessParam.type:[gessParam.type]
              if(paramType[0].includes('tuple')){
                if(paramType[0].includes('tuple()')) paramType = ['bytes memory']
                else [paramType, newStruct] = generateStruct(paramType, structTracker)
              }
            }catch(e){
              console.error('Fail: guessing calldata type')
              paramType = ['bytes memory']
            }
            let sigTocalculate = newStruct?`${name}(${utils.formatTypes(utils.paramReplace(paramType,structTracker[newStruct],`(${newStruct})`))})`:`${name}(${utils.formatTypes(paramType)})`;
            let newSig = await utils.getFuncSig(sigTocalculate);
            unknownSig[decodedCall.sig] = newSig;
            functionDesc.push(`// Change signature: ${decodedCall.sig} -> ${newSig}`);
          }
          let decodedInOut = await utils.decodeInAndOutFunction(`function ${name}(${utils.formatTypes(paramType, true)})`, _call.in.input);
          let filteredNull = utils.filterNullByte(decodedInOut[0])
          desc = `// ${metadata.getVarName(_call.in.from)} -> ${name}${value=='0'?'':`{value: ${value}}`}`;
          desc += `(${filteredNull.join(',')})`
          functionSig = `function ${name}(${utils.formatTypes(paramType, true)}) external${aCall[sig].payable?' payable':''}${decodedCall.out.length==0?'':` returns(${utils.formatTypes(decodedCall.out)} retr)`}`;
          hasReturn = decodedCall.out.length!=0;
        }

        if(aCall[sig].call.length > 1)
          functionDesc.push('// This function is duplicated. Please merge them manually, for now.');
        if(hasReturn)
          functionBody.push(`retr = abi.decode(${utils.toHexString(_call.in.output)}, (${utils.formatTypes(decodedCall.out)}));`)
        functionDesc.push(desc);
      }
      // Generate function body
      for(const _out of _call.out){
        let outSig = _out.input.slice(0,10)
        let value = utils.hexToDecString(_out.value||0);
        let callTo = _out.to==tAddress?'address(this)':metadata.getVarName(_out.to);
        if(_out.type == 'CREATE'){
          // CASE CREATE
          let tmpVar = metadata.getVarName(_out.to);
          createdAddress.push(tmpVar);
          let body = `${tmpVar} = address(new C_${callTo}${value==0?'':`{value: ${value}}`}());`
          functionBody.push(body);
        }else if(outSig == '0x'){
          // CASE FALLBACK
          let body = `(success,) = address(${callTo}).call${value==0?'':`{value: ${value}}`}("");`;
          functionBody.push(body);
        }else{
          if(outSig in mapper.funcSig){
            if(_out.to in mapper.funcSig[outSig]){
              // CASE 1
              let data = mapper.funcSig[outSig][_out.to][0];
              usedInterface.push([outSig,data]);
              let name = data.functionSig.slice(9, data.functionSig.indexOf('('))
              let decodedInOut = await utils.decodeInAndOutFunction(data.functionSig, _out.input); // some input address needed to be mapped
              let outData = utils.filterNullByte(decodedInOut[0]);
              let body = `${decodedInOut[1]?(decodedInOut[1]||'').includes(',')?`(${utils.randonTupleParamName(decodedInOut[1])}) = `:decodedInOut[1].split(' ').length==3?`${decodedInOut[1]} = `:`${decodedInOut[1]} retr_${runNumber++} = `:''}${data.interfaceName}(${callTo}).${name}${value==0?'':`{value: ${value}}`}(${outData.join(',')});`
              functionBody.push(body);
            }else{
              // CASE 2
              let data = mapper.pickOne(outSig)[0]; // Could be improved
              usedInterface.push([outSig,data]);
              let name = data.functionSig.slice(9, data.functionSig.indexOf('('))
              let decodedInOut = await utils.decodeInAndOutFunction(data.functionSig, _out.input); // some input address needed to be mapped
              let outData = utils.filterNullByte(decodedInOut[0]);
              let body = `${decodedInOut[1]?`${decodedInOut[1]} retr_${runNumber++} = `:''}${data.interfaceName}(${callTo}).${name}${value==0?'':`{value: ${value}}`}(${outData.join(',')});`
              functionBody.push(body + ' // Inaccurate interface name');
            }
          }else{
            // CASE 3
            // let decodedCall = await utils.guessABI(_out);
            
            // if(decodedCall.name != ''){
            // If we can guess the ABI
            // }else{ // Give up on decoding
            let body = `(success, ) = address(${callTo}).${_out.type.toLowerCase()}${value==0?'':`{value: ${value}}`}(${utils.toHexString(_out.input)});`;
            functionBody.push(body + ' // Cannot decode');
            // }
          }
        }
      }
      let [commit,fsig,body,desc] = preCommitFunc(functionSig, functionBody.join('\n\t\t'), functionDesc.join('\n\t'), aCall, sig);
      if(commit) res.push([fsig,body,desc]);
    }
  }
  registerContract(res, metadata, tAddress, createdAddress, structTracker)
}

function preRegisterContract(genContractCode, metadata, address, createdAddress, structTracker){
  let auxParams = {variables:[]}

  if(FEATURES.AUTO_MERGE.enabled){
    for(const [s,v] of Object.entries(FEATURES.AUTO_MERGE.duped)){
      let c = 0;
      let varSig = `count_${s}`;
      let tmp = v.body.map((e)=>{return `if(${varSig} == ${c++}){\n\t\t\t${e.replaceAll('\t\t','\t\t\t')}\n\t\t}`}).join(' else ') + `\n\t\t${varSig}++;`
      genContractCode.push([v.head, tmp, `// This function is automatically merged`])

      auxParams.variables.push(`uint256 ${varSig}`)
    }
  }
  return auxParams
}

function preCommitFunc(fsig,body,desc, call, sig){
  commit = true;
  if(FEATURES.AUTO_MERGE.enabled){
    if(call[sig].call.length > 1){
      if(sig in FEATURES.AUTO_MERGE.duped){
        FEATURES.AUTO_MERGE.duped[sig].body.push(body);
      }else{
        FEATURES.AUTO_MERGE.duped[sig] = {};
        FEATURES.AUTO_MERGE.duped[sig].head = fsig;
        FEATURES.AUTO_MERGE.duped[sig].body = [body];
      }
      commit = false;
    }
  }
  return [commit,fsig,body,desc];
}

async function writeTestFile(dst, metadata, trace, blockData, unknownSig){
  let sender = trace.from;
  let target = trace.to;
  let initialCall = '';
  let importFiles = [];
  let value = utils.hexToDecString(trace.value||0);
  let vName = metadata.getNickName(target);
  initialCall += `target = address(new C_${vName}${value==0?'':`{value: ${value}}`}());\n\t\t`
  if(trace.type != 'CREATE'){
    initialCall += `(success, ) = address(target).call${value==0?'':`{value: ${value}}`}(${utils.toHexString(trace.input)});\n`;
    initialCall += '\t\tassertTrue(success);'
  }
  importFiles.push(`import "./${path.relative(fileParams.path,metadata.srcPath)}/interface.aggregate.sol";`);
  importFiles.push(`import "./${path.relative(fileParams.path,metadata.srcPath)}/lib.constant.sol";`);

  let postProcess = async (data)=>{
    for(const k in unknownSig){
      let newSig = unknownSig[k];
      data = data.replaceAll(`hex"${k.slice(2)}`, `hex"${newSig.slice(2)}`)
    }
    return data;
  }

  copyAndReplaceFile(__dirname+'/template/template.t.sol', dst, {
    "EOA": await utils.toChecksumAddress(sender),
    "TARGET": await utils.toChecksumAddress(target),
    "TX_HASH": blockData["hash"],
    "BLOCK_NUMBER": blockData["blockNumber"],
    "TARGET_CONTRACTS": fileParams.targetContract.join('\n'),
    "IMPORT_FILES": importFiles.join('\n'),
    "INITIAL_CALL": initialCall
  }, postProcess)
}

module.exports = {initParam, writeTestFile, createConstantFile, createInterfaceFile, generateTargetContractCode, registerContract};