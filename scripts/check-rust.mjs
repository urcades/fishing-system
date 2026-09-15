// Replay one fixed input sequence independently in both implementations.
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import * as f from '../dist/index.js';
import {resolve} from '../dist/authoring.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const cases=[];
for(const dimensions of [0,1,2])for(const seed of [0,42,0xffffffff]){
 const pattern=['keep','point','hold','wander','opposite'].map((kind,i)=>({behavior:i<2?'surge':i===2?'warning':'rest',duration:.1+i*.07,jitter:.7,pace:.3+i*.6,intensity:.1+i*.2,
 target:kind==='point'?{kind,point:[0,1]}:kind==='wander'?{kind,distance:1}:{kind}}));
 cases.push({seed,config:{mode:dimensions?'tracking':'pressure',dimensions,capture:{kind:'rectangle'},pattern,nibbles:{count:2,duration:.05,gap:.05},maxTicks:600,
 parameters:{waitMin:f.DT,waitMax:f.DT,reelRate:0,escapeRate:0,strength:.2,lineCapacity:10}}});
}
cases.push({seed:42,config:{mode:'hook',dimensions:0,capture:{kind:'rectangle'},parameters:{waitMin:20,waitMax:20,biteWindow:4},maxTicks:2400,nibbles:{count:2,duration:.5,gap:.6}}});
const expected=[];
for(const c of cases){
 let s=f.createState(c.seed,c.config);const initial=s,frames=[],inputs=[];
 while(!f.isTerminal(s)){
  const primary=['ready','bite'].includes(s.phase)?1:s.phase==='struggle'&&s.tick%17<8?1:0;
  const input={primary,steer:s.tick%31/15-1};inputs.push(input);
  const result=f.step(JSON.parse(JSON.stringify(s)),input,c.config);s=result.state;
  frames.push({result,observation:f.observe(s,c.config)});
 }
 c.inputs=inputs;expected.push({initial,frames});
}
const corpus=JSON.parse(await readFile(new URL('../protocol/resolution.json',import.meta.url)));
const profiles=corpus.resolve.map(c=>({definition:{...c.definition,timing:'configured',parameters:{...c.definition.parameters,waitMin:20,waitMax:25}},loadout:c.loadout,seed:c.seed}));
for(const p of profiles){p.loadout=structuredClone(p.loadout);p.loadout.fish.pattern=[{target:{kind:'opposite'},duration:.2}];}
const run=spawnSync('cargo',['run','--quiet','--locked','--manifest-path','test/rust/Cargo.toml'],{
 cwd:root,input:JSON.stringify({cases,profiles}),encoding:'utf8',maxBuffer:64*1024*1024
});
assert.equal(run.status,0,run.stderr);
const actual=JSON.parse(run.stdout);
const integers=new Set(['version','rng','tick','phaseTicks','behaviorTicks','duration','behaviorDuration','segmentIndex','nibblesLeft','dimensions','index','seed']);
function close(a,b,path='root',key=''){
 if(typeof b==='number'&&!integers.has(key))assert.ok(Math.abs(a-b)<=1e-12,`${path}: ${a} vs ${b}`);
 else if(b&&typeof b==='object'){
  assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),path);
  for(const k of Object.keys(b))close(a[k],b[k],`${path}.${k}`,k);
 }else assert.deepEqual(a,b,path);
}
close(actual.traces,expected);
close(actual.profiles,profiles.map(p=>resolve(p.definition,p.loadout,p.seed)));
console.log(`Rust/TypeScript parity: ${cases.length} complete traces, ${cases.reduce((n,c)=>n+c.inputs.length,0)} ticks, all observations and 24 configured profile resolutions.`);
