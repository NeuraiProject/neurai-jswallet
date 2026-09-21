const { expect } = require('chai');
const { decimalToSatoshis } = require('@neuraiproject/neurai-create-transaction/amounts');
const { estimateTransactionSize } = require('@neuraiproject/neurai-create-transaction');
const { createOfflineWallet, p2pkhScript, assetTransferScript, makeStubRpc, parseTransaction } = require('./markerTestUtils');
const RECIPIENT = 'tVJpKx3HhMMqp9tpok35py8am4uZqT1g6B';

async function setup(network = 'xna-test', rate = '0.01', assets = false) {
  const wallet = await createOfflineWallet({ network });
  const address = wallet.getAddresses()[0];
  const baseUtxos = [{ address, assetName: 'XNA', satoshis: '100000000', script: p2pkhScript(address), txid: '11'.repeat(32), outputIndex: 0 }];
  const assetUtxos = assets ? [{ ...baseUtxos[0], assetName: 'FEE/REGRESSION', script: assetTransferScript(address, 'FEE/REGRESSION', 200000000n), satoshis: '200000000', txid: '22'.repeat(32) }] : [];
  wallet.rpc = makeStubRpc({ baseUtxos, assetUtxos, blockchainInfo: { asset_marker: 'xna' }, handlers: {
    estimatesmartfee: () => rate === null ? { errors: ['Insufficient data or no feerate found'] } : { feerate: rate },
  } });
  return wallet;
}

describe('RPC fees per 1,000 virtual bytes', () => {
  it('charges 193,000 sats for a 193-vbyte legacy sendMax estimate at 0.01 XNA/kB', async () => {
    const wallet = await setup();
    const result = await wallet.createTransaction({ toAddress: RECIPIENT, sendMax: true });
    expect(decimalToSatoshis(result.debug.fee)).to.equal(193000n);
    expect(parseTransaction(result.debug.signedTransaction).outputs[0].valueSats).to.equal(99807000n);
  });

  for (const network of ['xna-test', 'xna-pq-test']) {
    for (const assets of [false, true]) {
      it(`covers signed virtual size for ${network}, assets=${assets}`, async () => {
        const wallet = await setup(network, '0.01', assets);
        const result = await wallet.createTransaction({ toAddress: RECIPIENT, amount: 0.5, ...(assets ? { assetName: 'FEE/REGRESSION' } : {}) });
        const tx = parseTransaction(result.debug.signedTransaction);
        const { vsize } = estimateTransactionSize(tx);
        const paid = 100000000n - tx.outputs.reduce((sum, o) => sum + o.valueSats, 0n);
        expect(paid).to.equal(decimalToSatoshis(result.debug.fee));
        expect(paid >= BigInt(vsize) * 1000n).to.equal(true);
        expect(paid - BigInt(vsize) * 1000n <= 4000n).to.equal(true);
        expect(wallet.rpc.calls.sendrawtransaction).to.equal(undefined);
      });
    }
  }

  it('rounds a fractional satoshi upward with bigint arithmetic', async () => {
    const wallet = await setup('xna-test', '0.00001001');
    const result = await wallet.createTransaction({ toAddress: RECIPIENT, sendMax: true });
    expect(decimalToSatoshis(result.debug.fee)).to.equal(194n);
  });

  for (const rate of [null, 0]) {
    it(`uses the documented fallback when the node has no usable estimate (${rate})`, async () => {
      const wallet = await setup('xna-test', rate);
      const result = await wallet.createTransaction({ toAddress: RECIPIENT, sendMax: true });
      expect(decimalToSatoshis(result.debug.fee)).to.equal(965000n);
    });
  }
});
