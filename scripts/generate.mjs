// Generate wire declarations and validation data from the pinned protocol schema.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const schema = JSON.parse(await readFile(new URL('protocol/fishing.schema.json',root)));
const parameters = JSON.parse(await readFile(new URL('protocol/parameters.json',root)));
const recommended = Object.fromEntries(Object.entries(parameters).map(([k,v])=>[k,[v.recommendedMin,v.recommendedMax]]));
const quote = JSON.stringify;
function type(s) {
  if(s.$ref) return s.$ref.split('/').at(-1);
  if(s.oneOf) return s.oneOf.map(type).join(' | ');
  if('const' in s) return quote(s.const);
  if(s.enum) return s.enum.map(quote).join(' | ');
  if(s.type==='null') return 'null';
  if(s.type==='number'||s.type==='integer') return 'number';
  if(s.type==='string') return 'string';
  if(s.type==='array') return s.minItems===2&&s.maxItems===2 ? `[${type(s.items)}, ${type(s.items)}]` : `Array<${type(s.items)}>`;
  if(s.type==='object') {
    if(!s.properties) return `Record<string, ${type(s.additionalProperties)}>`;
    return `{ ${Object.entries(s.properties).map(([k,v])=>`${quote(k)}${s.required?.includes(k)?'':'?'}: ${type(v)}`).join('; ')} }`;
  }
  throw new Error(`Unsupported schema: ${quote(s)}`);
}
export const outputs = {
 'src/wire.ts':'// Generated from protocol/fishing.schema.json. Do not edit by hand.\n'+Object.entries(schema.$defs).map(([k,v])=>`export type ${k} = ${type(v)};`).join('\n')+'\n',
 'src/schema.ts':'// Generated validation data; semantic checks live in validation.ts.\nexport const schema = '+JSON.stringify(schema.$defs)+';\nexport const recommended = '+JSON.stringify(recommended)+';\n'
};
if(process.argv[1]===fileURLToPath(import.meta.url)) for(const [name,body] of Object.entries(outputs)) await writeFile(new URL(name,root),body);
