const { exec } = require("child_process"); 
const fs = require('fs');

class Mapper{
  constructor(srcPath) {
    this.srcPath = srcPath;
    this.funcSig = {};
  }
  
  #extractInterface = async (filePath, addr) => {
    return new Promise((resolve)=>{
      let res = [];
      fs.readFile(filePath, 'utf-8', (err,data)=>{
        if(err) console.error(err);
        for(const match of data.matchAll(/interface (\S*)(?: is [^{]*)?\s*{((?:[^{}]*(?:{[^{}]*}[^{}]*)*))}/g)){
          let content = match[2]
          content = content.replaceAll(/\r?\n/g,'').split(';').filter((e)=>/function \w+\(/.test(e)).map((e)=> e.replace(/^.*function /,'function ').replaceAll(/\s+/g,' '))
          for(const i of content){
            res.push([match[1], i, addr])
          }
        }
        resolve(res);
      })
    }).then((data)=>{
      return new Promise(async (resolve)=>{
        let prom = [];
        for(const i in data){
          let e = data[i];
          let funcSigPart = e[1].substring(9, e[1].indexOf(')')+1);
          prom.push(new Promise((resolve)=>{
            exec(`cast sig "${funcSigPart}"`, function(error,stdout,stderr){
              e.push(stdout.trim());
              resolve();
            })
          }));
        }
        await Promise.all(prom);
        resolve(data);
      })
    })
  }
  loadSigFromMeta = async (metadata) =>{
    console.log('START:  Loading function signatures');
    let prom = [];
    let sig = {}; // {sig: {address: [{fullfunc, interfaceName}]}
    let count = Object.keys(metadata.loadedSrc).length;
    for(const addr of Object.keys(metadata.loadedSrc)){
      let src = metadata.loadedSrc[addr]
      if(src.path != ''){
        let tmp = this.#extractInterface(src.path, addr);
        prom.push(tmp)
      }
      if(src.interface != ''){
        prom.push(this.#extractInterface(src.interface, addr))
      }
      if(--count%5==0 || count<=0) // Batch await
      await Promise.all(prom);
    }
    for(const p of prom){
      await p.then((data)=>{
        for(const e of data){
          let s = e.pop();
          if(s in sig){
            if(e[2] in sig[s]){
              sig[s][e[2]].push({interfaceName:e[0], functionSig:e[1]});
            }else{
              sig[s][e[2]] = [{interfaceName:e[0], functionSig:e[1]}];
            }
          }else{
            sig[s] = {};
            sig[s][e[2]] = [{interfaceName:e[0], functionSig:e[1]}];
            
          }
        }
      })
    }
    this.funcSig = sig;
    console.log('FINISH: Loading function signatures');
  }

  pickOne = (sig) => {
    return this.funcSig[sig][Object.keys(this.funcSig[sig])[0]];
  }
}
module.exports = {Mapper};