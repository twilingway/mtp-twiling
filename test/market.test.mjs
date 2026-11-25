import test from 'node:test';
import assert from 'node:assert/strict';
import { quotation, dayChange, resolveWatchlist, normaliseCandles } from '../public/market-model.js';

test('signed nano quotation and missing prices retain their financial meaning', () => {
  assert.equal(quotation({units:'-1',nano:-250000000}),-1.25);
  assert.equal(quotation({units:'0',nano:125000000}),.125);
  assert.equal(quotation(null),null);
  assert.equal(quotation({units:'not-a-price'}),null);
  assert.deepEqual(dayChange(100,null),{change:null,changePercent:null});
  assert.deepEqual(dayChange(100,0),{change:null,changePercent:null});
  const result=dayChange(90,100);
  assert.equal(result.change,-10);
  assert.ok(Math.abs(result.changePercent+10)<1e-10);
});

test('watchlist selects MOEX share and nearest non-expired NG without replacing missing indices', () => {
  const result=resolveWatchlist([
    {ticker:'SBER',classCode:'SPBXM',uid:'foreign'},
    {ticker:'SBER',classCode:'TQBR',uid:'moex'},
  ],[
    {ticker:'NGV6',uid:'expired',expirationDate:'2026-10-28T00:00:00Z'},
    {ticker:'NGZ6',uid:'later',expirationDate:'2026-12-28T00:00:00Z'},
    {ticker:'NGX6',uid:'next',expirationDate:'2026-11-28T00:00:00Z'},
    {ticker:'SNGZ6',uid:'different-product',expirationDate:'2026-11-25T00:00:00Z'},
  ],[],new Date('2026-11-24T00:00:00Z'));
  assert.equal(result.find((r)=>r.symbol==='SBER').uid,'moex');
  assert.equal(result.find((r)=>r.symbol==='NG').uid,'next');
  assert.match(result.find((r)=>r.symbol==='NG').note,/не склейка/);
  assert.equal(result.find((r)=>r.symbol==='IMOEX').availability,'unavailable');
  assert.equal(result.find((r)=>r.symbol==='IMOEX').price,null);
});

test('history is chronological, duplicate-free and never fills missing bars', () => {
  const bar=(time,close)=>({time,open:{units:'10'},high:{units:'12'},low:{units:'9'},close:{units:String(close)},volume:'45'});
  const result=normaliseCandles([bar('2026-11-24T08:00:00Z',11),bar('2026-11-21T08:00:00Z',10),bar('2026-11-24T08:00:00Z',12),bar('bad-date',5)]);
  assert.equal(result.length,2);
  assert.equal(result[0].timestamp,Date.parse('2026-11-21T08:00:00Z'));
  assert.equal(result[1].close,12);
  assert.equal(result[0].volume,45);
});
