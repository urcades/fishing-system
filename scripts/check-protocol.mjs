import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { outputs } from './generate.mjs';
const root=new URL('../',import.meta.url);
const lock=JSON.parse(await readFile(new URL('protocol/lock.json',root)));
for(const f of lock.files){
 const bytes=await readFile(new URL(`protocol/${f.file}`,root));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256,f.file);
 if(process.argv.includes('--upstream')){
  const response=await fetch(`https://raw.githubusercontent.com/${f.repository}/${f.commit}/${f.path}`);
  assert.ok(response.ok,`${f.path}: ${response.status}`);
  assert.equal(createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex'),f.sha256,f.file);
 }
}
for(const [path,body] of Object.entries(outputs)) assert.equal(await readFile(new URL(path,root),'utf8'),body,`${path}: run npm run generate`);
console.log('Pinned protocol checksums and generated declarations match.');
