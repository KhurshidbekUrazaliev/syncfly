import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnACP } from '../acp-runner.mjs';
import { migrateParallelPlans, taskFailure } from '../task-workflow.mjs';
import { accountEnvironment } from '../provider-accounts.mjs';
import { requestNativeApproval,pendingControls,decideControl,revokeControls } from '../computer-control.mjs';
const fixture=path.resolve('desktop/acp-fixture.cjs');
test('ACP edits wait for approval; denial never writes; approved run finishes',async()=>{
 for(const allow of [false,true]){
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'syncfly-acp-'));let approvals=0;
  const child=spawnACP({file:process.execPath,args:[fixture]},{cwd,env:process.env,provider:'antigravity',prompt:'Write result',approve:async details=>{approvals++;await assert.rejects(fs.access(path.join(cwd,'native-result.txt')));assert.match(details.reason,/native-result/);return allow;}});
  let output='';child.stdout.on('data',x=>output+=x);const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});assert.equal(approvals,1);assert.equal(code,allow?0:1);
  if(allow)assert.equal(await fs.readFile(path.join(cwd,'native-result.txt'),'utf8'),'Native approval passed');else await assert.rejects(fs.access(path.join(cwd,'native-result.txt')));
 }
});
test('native approvals retain user ownership and revoke denies a waiting command',async()=>{
 let pending=requestNativeApproval({id:'native-owner'},{id:'native-task',provider:'claude',title:'Task'},{reason:'Run test',command:'node verify.cjs'});
 const r=pendingControls('native-owner')[0];assert.equal(r.native,true);await assert.rejects(decideControl('other',r.id,true));await decideControl('native-owner',r.id,true);assert.equal(await pending,true);
 pending=requestNativeApproval({id:'native-owner'},{id:'native-task',provider:'claude',title:'Task'},{reason:'Run test'});revokeControls('native-task');assert.equal(await pending,false);
});
test('legacy AI ordering becomes advisory while explicit user prerequisites survive',()=>{
 const state={tasks:[{id:'plan',kind:'plan',status:'done',projectId:'p',plan:[{title:'Backend',provider:'codex'},{title:'Frontend',provider:'claude'}]},{id:'a',projectId:'p',title:'Backend',provider:'codex',dependencies:[]},{id:'b',projectId:'p',title:'Frontend',provider:'claude',dependencies:['a']},{id:'manual',projectId:'p',title:'Deploy',provider:'codex',dependencies:['b'],dependencyMode:'explicit'}]};
 migrateParallelPlans(state);assert.deepEqual(state.tasks[2].dependencies,[]);assert.deepEqual(state.tasks[2].suggestedDependencies,['a']);assert.deepEqual(state.tasks[3].dependencies,['b']);
 state.tasks[2].dependencies=['a'];state.tasks[2].dependencyMode='explicit';migrateParallelPlans(state);assert.deepEqual(state.tasks[2].dependencies,['a']);
});
test('child agents keep sign-in location without inheriting the desktop launcher',async()=>{
 const env=await accountEnvironment('.',null,{CODEX_HOME:'profile',CODEX_WINDOWS_REGISTERED_CORE:'desktop',CODEX_SESSION_ID:'id',CODEX_SHELL:'desktop-shell',BROWSER_USE_ACCESS_PIPE_PATH:'pipe',PATH:'tools'});
 assert.equal(env.CODEX_HOME,'profile');assert.equal(env.PATH,'tools');assert.equal(env.CODEX_WINDOWS_REGISTERED_CORE,undefined);assert.equal(env.CODEX_SHELL,undefined);assert.equal(env.NODE_USE_SYSTEM_CA,'1');
});
test('account errors expose actionable cause instead of generic exit status',()=>{
 assert.match(taskFailure([{text:"You're out of usage credits"}],'exit 1'),/another model or account/);
 assert.match(taskFailure([{text:'Add a payment method to continue'}],'exit 0'),/requires billing/);
});
test('cancelling an ACP worker closes without writing to an ended output stream',async()=>{
 const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'syncfly-acp-stop-'));
 const child=spawnACP({file:process.execPath,args:[fixture]},{cwd,env:process.env,provider:'cursor',prompt:'Concurrent worker'});
 child.stdout.resume();const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.stdout.on('error',reject);child.on('close',resolve);setTimeout(()=>child.kill(),150);});assert.notEqual(code,0);
});
