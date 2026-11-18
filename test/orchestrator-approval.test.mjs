import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDecision,reviewPermission} from '../orchestrator-approval.mjs';
import {controlSession,requestControl,revokeControls,pendingControls} from '../computer-control.mjs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('approval reviewer requires an explicit valid result',()=>{
 assert.deepEqual(parseDecision(JSON.stringify({type:'result',result:'{"approve":true,"reason":"Run tests"}'})),{approve:true,reason:'Run tests'});
 for(const value of ['{}',JSON.stringify({type:'result',is_error:true,result:'{"approve":true}'}),JSON.stringify({type:'result',result:'{"approve":"yes"}'})])assert.throws(()=>parseDecision(value));
});
test('delegated computer requests execute after review without user prompts, and revocation wins',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'syncfly-delegated-'));
 try{
  let decide;const task={id:'delegated',title:'test',provider:'claude'};
  const token=controlSession({id:'u'},task,()=>new Promise(r=>decide=r));
  const target=path.join(dir,'result.txt');const pending=requestControl(token,'write_file',{path:target,text:'approved',reason:'test'});
  await new Promise(r=>setImmediate(r));assert.equal(pendingControls('u').length,0);await assert.rejects(readFile(target));decide(true);assert.ok(!(await pending).isError);assert.equal(await readFile(target,'utf8'),'approved');
  const denied=requestControl(token,'write_file',{path:path.join(dir,'denied.txt'),text:'no',reason:'test'});await new Promise(r=>setImmediate(r));revokeControls(task.id);decide(true);assert.equal((await denied).isError,true);await assert.rejects(readFile(path.join(dir,'denied.txt')));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('reviewer timeout kills child and cannot approve',async()=>{
 let killed=false;await assert.rejects(reviewPermission({}, {project:{},task:{},timeout:10,launch:()=>{const c=new EventEmitter();c.stdout=new PassThrough();c.kill=()=>killed=true;return c;}}),/timed out/);assert.equal(killed,true);
});
test('repository rate-limit text is not an account failure; completed Codex tasks recover',async()=>{
 const {taskFailure,migrateParallelPlans}=await import('../task-workflow.mjs');
 assert.equal(taskFailure([{text:'lib/rate-limit.ts provides Upstash Redis (rate limits)'}],'fallback'),'fallback');
 const state={tasks:[{provider:'codex',status:'failed',error:'This provider reached its usage limit.',logs:[{text:'lib/rate-limit.ts'},{text:'[turn.completed]'}]}]};migrateParallelPlans(state);assert.equal(state.tasks[0].status,'review');assert.equal(state.tasks[0].error,null);
 assert.match(taskFailure([{text:"You've hit your usage limit"}],'fallback'),/usage limit/);
});
