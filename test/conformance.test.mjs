import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as f from '../dist/index.js';
import {resolve,select,validateRecommended} from '../dist/authoring.js';
const load=async name=>JSON.parse(await readFile(new URL(`../protocol/${name}.json`,import.meta.url)));
const legacy=v=>Array.isArray(v)?v.map(legacy):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['segmentIndex','nibblesLeft','pattern','nibbles','maxTicks'].includes(k)).map(([k,x])=>[k,k==='version'&&x===2?1:legacy(x)])):v;
const upgrade=s=>({...s,version:2,segmentIndex:0,nibblesLeft:0});
const discrete=new Set(['version','rng','tick','phaseTicks','behaviorTicks','duration','behaviorDuration','segmentIndex','nibblesLeft','dimensions','index','seed']);
export function close(a,b,path='root',key=''){
 if(typeof b==='number'&&!discrete.has(key))assert.ok(Math.abs(a-b)<=1e-12,`${path}: ${a} != ${b}`);
 else if(b&&typeof b==='object'){
  assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),path);
  for(const k of Object.keys(b))close(a[k],b[k],`${path}.${k}`,k);
 }else assert.deepEqual(a,b,path);
}
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
const corpus=await load('trajectories');
test('all 12 historical traces / 8,080 ticks, every event, purity and JSON resume',()=>{
 for(const c of corpus.traces){
  const config=freeze(c.config),points=new Map(c.checkpoints.map(p=>[p.at,p]));
  let state=freeze(f.createState(c.seed,config));close(legacy(state),points.get(0).state);
  for(const [i,input] of c.inputs.entries()){
   const before=JSON.stringify(state),r=f.step(state,freeze(input),config);
   assert.equal(JSON.stringify(state),before);
   f.validateState(r.state,config);
   if(points.has(i+1)){const p=points.get(i+1);close(legacy(r.state),p.state,`${c.id}/${i+1}`);assert.deepEqual(r.events,p.events);}
   else assert.deepEqual(r.events,[]);
   assert.deepEqual(f.step(JSON.parse(JSON.stringify(state)),input,config),r);
   state=freeze(r.state);
  }assert.ok(f.isTerminal(state));
 }
});
test('eight original outcome and timer boundaries',()=>{
 for(const c of corpus.steps)close(legacy(f.step(upgrade(c.state),c.input,c.config)),c.expected,c.id);
});
test('canonical geometry including holes and partial overlaps',async()=>{
 for(const c of await load('geometry')){
  f.validateCapture(c.capture);
  close(f.alignment(c.capture,[c.fishX,c.fishY],[c.tackleX,c.tackleY],c.size,c.radius),c.expected,c.id);
 }
});
test('optional authoring matches 24 resolutions and 12 weighted draws',async()=>{
 const r=await load('resolution');
 for(const c of r.resolve)close(legacy(resolve(c.definition,c.loadout,c.seed)),c.expected,c.id);
 for(const c of r.select)close(select(c.pool,c.bait,c.seed),c.expected,c.id);
});
test('historical invalid inputs with explicitly widened window bound',async()=>{
 for(const c of await load('invalid')){
  let run;
  if(c.op==='config')run=()=>f.createConfig(c.config);
  if(c.op==='create')run=()=>f.createState(c.seed,c.config);
  if(c.op==='step')run=()=>f.step(c.id==='unsupported-version'?c.state:upgrade(c.state),c.input,c.config);
  if(c.op==='resolve')run=()=>resolve(c.definition,c.loadout,c.seed);
  if(c.op==='select')run=()=>select(c.pool,c.bait,c.seed);
  assert.ok(run,c.id);
  if(c.id==='invalid-profile')assert.doesNotThrow(run);else assert.throws(run,undefined,c.id);
 }
});
test('hand-derived false-bite, timeout and adjacent-surge checkpoints',async()=>{
 function subset(a,b){if(b&&typeof b==='object'&&!Array.isArray(b)){for(const k of Object.keys(b))subset(a[k],b[k]);}else close(a,b);}
 for(const c of (await load('extensions')).cases){
  let s=f.createState(c.seed,c.config);
  for(const [i,u] of c.inputs.entries()){
   const r=f.step(s,u,c.config);s=r.state;
   for(const check of c.checks)if(check.tick===i+1){subset(s,check.state);assert.deepEqual(r.events,check.events);}
  }
 }
});
test('unknown fields, nonfinite values and invalid extension programs are rejected',()=>{
 const base={mode:'tracking',dimensions:2,capture:{kind:'rectangle'}};
 for(const extra of [{pattern:Array(17).fill({})},{pattern:[{pace:11}]},{pattern:[{target:{kind:'hold',distance:1}}]},
 {pattern:[{target:{kind:'point',point:[0,2]}}]},{nibbles:{count:1.5}},{nibbles:{count:9}},{maxTicks:36001},{parameters:{strength:NaN}}])assert.throws(()=>f.createConfig({...base,...extra}));
 const s=f.createState(0,base);assert.throws(()=>f.step(s,{primary:Infinity},base));
 assert.throws(()=>f.createState(-1,base));assert.throws(()=>f.createState(.5,base));
 assert.deepEqual(f.random(0),[1013904223,1013904223/4294967296]);
});
test('zero rates remain bounded through a complete 36,000-tick encounter',()=>{
 const c=f.createConfig({mode:'pressure',dimensions:0,capture:{kind:'rectangle'},maxTicks:36000,
  parameters:{waitMin:f.DT,waitMax:f.DT,reelRate:0,escapeRate:0,strength:0,baseTension:0,fatigue:0,recovery:0},
  pattern:[{duration:600,jitter:1}]});
 let s=f.createState(42,c);
 while(!f.isTerminal(s))s=f.step(s,{primary:s.phase==='ready'||s.phase==='bite'?1:0},c).state;
 assert.equal(s.tick,36000);assert.equal(s.reason,'timeout');
 assert.deepEqual([s.progress,s.tension,s.energy],[.25,0,1]);
 assert.deepEqual(f.step(s,{primary:1},c).state,s);
});

test('recommended tuning remains optional',()=>{
 assert.doesNotThrow(()=>validateRecommended({}));
 assert.throws(()=>validateRecommended({strength:100}));
 assert.doesNotThrow(()=>f.createConfig({mode:'hook',dimensions:0,capture:{kind:'rectangle'},parameters:{strength:100}}));
});
