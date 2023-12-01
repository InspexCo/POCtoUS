const utils = require('./utils.js');
const fs = require('fs');

class Metadata{
  constructor(rootPath, txHash){
    this.rootPath = rootPath;
    this.txHash = txHash;
    this.meta = this.loadMetadata(txHash);
  }
  loadMetadata = (txHash)=>{
    console.log('Loading Metadata');
    let raw = fs.readFileSync(this.rootPath+'/.metadata.json', 'utf-8');
    let meta = JSON.parse(raw);
    if(!(txHash in meta.tx)) meta.tx[txHash] = this.getBlankMeta()
    console.log('Finish Loading');
    return meta.tx[txHash];
  }
  saveMetadata = ()=>{
    console.log('Saving Metadata');
    let raw = fs.readFileSync(this.rootPath+'/.metadata.json', 'utf-8');
    let meta = JSON.parse(raw);
    meta.tx[this.txHash] = this.meta;
    fs.writeFileSync(this.rootPath+'/.metadata.json' , JSON.stringify(meta), 'utf-8');
    console.log('Metadata Saved');
  }
  getBlankMeta = ()=>{
    return {
      srcPath: this.rootPath+'/src_poc/'+utils.getTxHashTmpName(this.txHash),
      addresses:{}, // address:{name:'', hasSrc:'bool', hasInterface:'bool', isCreated:'bool', impl:'address', isProxy:'bool', }
      loadedSrc:{}, // address:{path:'', interface:'stringArrayOfInternalOfInterface'}
      createAddress: [],
      allName: []
    };
  }
  #determineNickname = ()=>{
    let _address = this.meta.addresses;
    let allName = this.meta.allName;
    for(const a of Object.keys(_address)){
      if(_address[a].name == ''){
        _address[a].nickname = `${_address[a].isCreated?'C':'A'}_${a.slice(0,8)}_${utils.sumAddress(a)}`;
      }else{
        _address[a].nickname = _address[a].name+ (allName[_address[a].name]>1?`_${a.slice(0,8)}`:'');
      }
    }
  }
  populatedAddresses = (addresses, trace)=>{
    console.log('Populating metadata')
    let _address = this.meta.addresses;
    let createdAddress = utils.getCreatedAddresses(trace);
    let nameTrack = {}
    for(const a of addresses.keys()){
      if(a in _address){
        _address[a].name = addresses.get(a).name;
        _address[a].impl = addresses.get(a).impl;
        _address[a].isCreated = createdAddress.includes(a);
        _address[a].isProxy = addresses.get(a).impl!=a;
      }else{
        _address[a] = {name:addresses.get(a).name, nickname:addresses.get(a).name, hasSrc:null, hasInterface:null, hasABI:null, isCreated:createdAddress.includes(a), impl:addresses.get(a).impl, isProxy:addresses.get(a).impl!=a}
      }
      nameTrack[_address[a].name] = nameTrack[_address[a].name]+1||1;
    }
    this.meta.allName = nameTrack;
    this.#determineNickname();
    console.log('Finish populating metadata')
  }
  getVarName = (address)=>{
    if(!(address in this.meta.addresses)) return address;
    let nickname = this.meta.addresses[address].nickname;
    return nickname.slice(0,2)=='C_'?nickname:'C.'+nickname;
  }
  getNickName = (address)=>{
    return this.meta.addresses[address].nickname;
  }
  isContractLoaded = (contract)=>{
    return contract in this.meta.loadedSrc;
  }
  get addresses() {
    return this.meta.addresses
  }
  get srcPath() {
    return this.meta.srcPath;
  }
  get loadedSrc() {
    return this.meta.loadedSrc;
  }
  get loadedSrcSize(){
    return Object.keys(this.meta.loadedSrc).length;
  }
  get verifiedAddress() {
    let _address = this.meta.addresses;
    let res = []
    for(const a of Object.keys(_address)){
      if(_address[a].name != '') res.push(a)
    }
    return res
  }
  get allName() {
    return Object.keys(this.meta.allName);
  }
  set loadedContract(newContract) {
    if(this.isContractLoaded(newContract.address)){
      console.debug('No new entries')
    }else{
      console.debug('Add new entries')
      this.meta.loadedSrc[newContract.address] = {path: newContract.path, interface: newContract.interface}
      this.meta.addresses[newContract.address].hasSrc = true;
      this.meta.addresses[newContract.address].hasInterface = newContract.interface != '';
    }
  }
}

module.exports = {Metadata};