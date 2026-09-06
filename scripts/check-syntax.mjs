import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const root=fileURLToPath(new URL('../',import.meta.url));
let modules=0;
let scripts=0;
for(const name of fs.readdirSync(path.join(root,'src'))){
  if(!name.endsWith('.mjs'))continue;
  execFileSync(process.execPath,['--check',path.join(root,'src',name)],{stdio:'pipe'});
  modules++;
}
for(const name of fs.readdirSync(path.join(root,'public'))){
  if(!name.endsWith('.html'))continue;
  const html=fs.readFileSync(path.join(root,'public',name),'utf8');
  const classic=[];
  for(const [full,attributes,source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    if(/\bsrc\s*=/.test(attributes))continue;
    if(/\btype\s*=\s*["']module["']/i.test(attributes)){
      execFileSync(process.execPath,['--input-type=module','--check'],{input:source,stdio:['pipe','pipe','pipe']});
    }else if(!/\btype\s*=/.test(attributes)||/\btype\s*=\s*["'](?:text|application)\/javascript["']/i.test(attributes)){
      new vm.Script(source,{filename:name+':script-'+(scripts+1)});
      classic.push(source);
    }else continue;
    scripts++;
  }
  // Classic script tags share their global lexical scope.
  new vm.Script(classic.join('\n;\n'),{filename:name});
}
console.log(`JavaScript geldig: ${modules} servermodules en ${scripts} paginascripts.`);
