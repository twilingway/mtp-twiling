import test from'node:test';
import assert from'node:assert/strict';
import{fibPrice,drawingGeometry,drawingLayer,hitDrawing,lineEnds,DEFAULT_FIB_LEVELS}from'../public/drawing-model.js';
import{validateBackup}from'../public/backup-format.js';
test('Fibonacci ratios follow anchor direction, reverse and three-point extension',()=>{
  const points=[{timestamp:1,value:50},{timestamp:2,value:100}];
  assert.equal(fibPrice(points,0),100);assert.equal(fibPrice(points,1),50);assert.equal(fibPrice(points,.5),75);
  assert.equal(fibPrice(points,-.5),125);assert.equal(fibPrice(points,.236),88.2);assert.equal(fibPrice(points,0,true),50);
  assert.equal(fibPrice([...points,{timestamp:3,value:80}],1.618,false,true),160.9);
});
test('drawing projection excludes disabled levels; hit-testing finds anchors and actual lines',()=>{
  const d={id:'f',name:'fibonacciLine',points:[{timestamp:10,value:30},{timestamp:70,value:80}],settings:{extendLeft:false,extendRight:false,levelStyles:[{value:0,enabled:true,color:'#787b86'},{value:.5,enabled:false,color:'#f44336'},{value:1,enabled:true,color:'#787b86'}]}};
  const project=p=>({x:p.timestamp,y:p.value});const geometry=drawingGeometry(d,project,500,400);
  assert.equal(geometry.levels.length,2);assert.equal(geometry.from,10);assert.equal(geometry.to,70);
  assert.deepEqual(hitDrawing([d],{x:40,y:80},project,500,400),{id:'f',handle:-1});
  assert.equal(hitDrawing([d],{x:40,y:55},project,500,400),null);
  assert.equal(hitDrawing([{...d,visible:false}],{x:40,y:80},project,500,400),null);
  assert.equal(DEFAULT_FIB_LEVELS.length,24);
  assert.deepEqual(lineEnds({x:20,y:40},{x:40,y:60},100,100,'rayLine'),[{x:20,y:40},{x:100,y:120}]);
});
test('drawing backups reject unsafe level colours and invalid timeframe visibility',()=>{
  const drawing={id:'f',name:'fibonacciLine',points:[{timestamp:1,value:20},{timestamp:2,value:30}],settings:{levelStyles:DEFAULT_FIB_LEVELS},visibility:{minutes:{enabled:true,from:1,to:59}}};
  const backup={application:'personal-terminal',schemaVersion:1,drawings:[{symbol:'GAZP',items:[drawing]}],images:[],history:[]};
  assert.equal(validateBackup(backup),backup);
  assert.throws(()=>validateBackup({...backup,drawings:[{symbol:'GAZP',items:[{...drawing,settings:{levelStyles:[{value:0,enabled:true,color:'url(secret)'}]}}]}]}));
  assert.throws(()=>validateBackup({...backup,drawings:[{symbol:'GAZP',items:[{...drawing,visibility:{days:{enabled:true,from:50,to:1}}}]}]}));
});

test('drawing hits follow the front and back paint order', () => {
  const normal = {
    id: 'normal',
    name: 'segment',
    points: [{ timestamp: 10, value: 20 }, { timestamp: 100, value: 20 }]
  };
  const front = { ...normal, id: 'front', layer: 'front' };
  const back = { ...normal, id: 'back', layer: 'back' };
  const project = (point) => ({ x: point.timestamp, y: point.value });
  const hit = (items) => hitDrawing(items, { x: 40, y: 20 }, project, 200, 100)?.id;

  assert.equal(drawingLayer(normal), 'front');
  assert.equal(drawingLayer(back), 'back');
  assert.equal(hit([normal, back]), 'normal');
  assert.equal(hit([normal, front, back]), 'front');
  assert.equal(hit([front, normal, back]), 'normal');
  assert.equal(hit([back]), 'back');
});
