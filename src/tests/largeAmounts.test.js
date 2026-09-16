const {expect}=require('chai');
const {decimalToSatoshis}=require('@neuraiproject/neurai-create-transaction/amounts');
const {createOfflineWallet,p2pkhScript,makeStubRpc,parseTransaction,assetTransferScript,assetOutputsOf}=require('./markerTestUtils');
const RECIPIENT='tVJpKx3HhMMqp9tpok35py8am4uZqT1g6B';
async function funded(amounts, assets=[]) {
 const wallet=await createOfflineWallet();
 const address=wallet.getAddresses()[0];
 const baseUtxos=amounts.map((satoshis,i)=>({address,assetName:'XNA',satoshis:String(satoshis),script:p2pkhScript(address),txid:(i+1).toString(16).padStart(64,'0'),outputIndex:0}));
 const assetUtxos=assets.map((satoshis,i)=>({address,assetName:'LARGE',satoshis:String(satoshis),script:assetTransferScript(address,'LARGE',satoshis),txid:(i+100).toString(16).padStart(64,'0'),outputIndex:0}));
 wallet.rpc=makeStubRpc({baseUtxos,assetUtxos,blockchainInfo:{asset_marker:'xna'},handlers:{getaddressbalance:()=>({balance:String(amounts.reduce((a,b)=>a+b,0n))})}});
 return wallet;
}
function conserved(result){
 const total=result.debug.UTXOs.filter(u=>u.assetName==='XNA').reduce((n,u)=>n+BigInt(u.satoshis),0n);
 const outputs=parseTransaction(result.debug.signedTransaction).outputs;
 expect(outputs.reduce((n,o)=>n+o.valueSats,0n)+decimalToSatoshis(result.debug.fee)).to.equal(total);
 return outputs;
}
describe('exact large wallet amounts (offline)',()=>{
 for(const raw of [9007199254740991n,9007199254740992n,9007199254740993n,10000000000000001n,10555217616498300n]){
  it(`signs and conserves ${raw} raw units`,async()=>{
   const wallet=await funded([raw+100000000n]);
   const text=(raw/100000000n)+'.'+(raw%100000000n).toString().padStart(8,'0');
   const result=await wallet.createTransaction({toAddress:RECIPIENT,amount:text});
   expect(conserved(result)[0].valueSats).to.equal(raw);
   expect(wallet.rpc.calls.sendrawtransaction).to.equal(undefined);
  });
 }
 it('keeps a large fractional balance and change exact',async()=>{
  const wallet=await funded([10000000000000001n]);
  expect(await wallet.getBalance()).to.equal('100000000.00000001');
  const result=await wallet.createTransaction({toAddress:RECIPIENT,amount:1});
  const outputs=conserved(result);
  expect(decimalToSatoshis(result.debug.xnaChangeAmount)).to.equal(outputs[1].valueSats);
 });
 it('sendMax conserves MAX_MONEY with one output and exact reported amount',async()=>{
  const wallet=await funded([2100000000000000000n]);
  const result=await wallet.createTransaction({toAddress:RECIPIENT,sendMax:true});
  const outputs=conserved(result);
  expect(outputs.length).to.equal(1);
  expect(decimalToSatoshis(result.debug.amount)).to.equal(outputs[0].valueSats);
 });
 it('sums small UTXOs and refines the fee when selecting another input',async()=>{
  const wallet=await funded([100000000n,1103516n,2000000n]);
  const result=await wallet.createTransaction({toAddress:RECIPIENT,amount:1});
  conserved(result);
  expect(result.debug.UTXOs.length).to.equal(3);
 });
 it('keeps asset quantity separate from zero XNA nValue',async()=>{
  const wallet=await funded([100000000n],[10000000000000002n]);
  const result=await wallet.createTransaction({toAddress:RECIPIENT,assetName:'LARGE',amount:'100000000.00000001'});
  conserved(result);
  const outs=assetOutputsOf(result.debug.signedTransaction);
  expect(outs.reduce((n,o)=>n+o.split.assetTransfer.amountRaw,0n)).to.equal(10000000000000002n);
  expect(outs.every(o=>o.valueSats===0n)).to.equal(true);
 });
 it('rejects numeric inputs that may already have lost fractional units',async()=>{
  const wallet=await funded([20000000000000000n]);
  let error; try {await wallet.createTransaction({toAddress:RECIPIENT,amount:100000000.00000001});}catch(e){error=e;}
  expect(error).to.be.instanceOf(Error);
 });
});
