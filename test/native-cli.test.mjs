import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveNativeCLI, resolveCursorInstallation } from '../native-cli.mjs';
test('Windows resolves native executables and npm JS entries without a command shell',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'syncfly-cli-'));
 const root=path.join(dir,'node_modules','@openai','codex');await fs.mkdir(root,{recursive:true});
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({bin:{codex:'cli.js'}}));
 await fs.writeFile(path.join(root,'cli.js'),'');
 const resolved=await resolveNativeCLI(['codex'],{platform:'win32',searchPath:dir,node:'bundled-node'});
 assert.deepEqual(resolved,{file:'bundled-node',args:[path.join(root,'cli.js')]});
 await fs.writeFile(path.join(dir,'codex.exe'),'',{mode:0o755});
 assert.deepEqual(await resolveNativeCLI(['codex'],{platform:'win32',searchPath:dir}),{file:path.join(dir,'codex.exe'),args:[]});
});
test('Cursor Windows launcher resolves the newest complete bundled runtime',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'syncfly-cursor-'));
 for(const version of ['2026.9.9-abcdef','2026.11.13-abcdef','2026.11.17-12-30-00-abcdef','2026.11.18-abcdef','.staged']){
  const dir=path.join(root,'versions',version);await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'node.exe'),'',{mode:0o755});
  if(version!=='2026.11.18-abcdef')await fs.writeFile(path.join(dir,'index.js'),'');
 }
 const expected=path.join(root,'versions','2026.11.17-12-30-00-abcdef');
 assert.deepEqual(await resolveCursorInstallation(root),{file:path.join(expected,'node.exe'),args:[path.join(expected,'index.js')]});
 assert.deepEqual(await resolveNativeCLI(['agent'],{platform:'win32',searchPath:root}),{file:path.join(expected,'node.exe'),args:[path.join(expected,'index.js')]});
 assert.equal(await resolveCursorInstallation(path.join(root,'missing')),null);
});
