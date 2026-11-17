import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { agentArgs, validateTask, imagePayload, parsePlan, generateImage, generatePlan } from '../server.mjs';
import { context, containerArgs, activeTaskCount } from '../cloud.mjs';

test('host task count includes all users and in-flight starts without counting an overlap twice',()=>{
 assert.equal(activeTaskCount([
  {active:new Map([['a',{}]]),starting:new Set(['a','b'])},
  {active:new Map([['a',{}]])},
 ]),3);
 assert.equal(activeTaskCount([]),0);
});

test('provider arguments preserve prompts as single arguments and retain native permission controls',()=>{
 const prompt='text; $(touch /tmp/never)';
 for(const id of ['claude','codex','gemini','cursor']){const args=agentArgs(id,prompt);assert.ok(args.includes(prompt));assert.ok(!args.some(a=>/dangerously|yolo|--force/.test(a)));}
 assert.ok(agentArgs('codex','hello','',true).includes('read-only'));
 assert.throws(()=>agentArgs('unknown','hello'));
});
test('tasks reject unknown providers, missing projects and cross-project dependencies',()=>{
 const s={projects:[{id:'a'},{id:'b'}],tasks:[{id:'t',projectId:'b'}]};
 assert.throws(()=>validateTask({title:'test',projectId:'a',provider:'bad'},s));
 assert.throws(()=>validateTask({title:'test',projectId:'a',dependencies:['t']},s));
 assert.equal(validateTask({title:'test',projectId:'a',provider:'gemini-image'},s).aspectRatio,'1:1');
});
test('plans validate provider choices and reject forward/cyclic dependencies',()=>{
 const valid={tasks:[{title:'Research',provider:'gemini',dependsOn:[]},{title:'Build',provider:'codex',dependsOn:[0]}]};
 assert.equal(parsePlan('```json\n'+JSON.stringify(valid)+'\n```')[1].dependsOn[0],0);
 assert.throws(()=>parsePlan(JSON.stringify({tasks:[{title:'Bad',provider:'codex',dependsOn:[0]}]})));
 assert.throws(()=>parsePlan('not json'));
 assert.throws(()=>parsePlan(JSON.stringify({tasks:[{title:'Bad',provider:'invented'}]})));
});
test('Gemini image payload requests images with the requested aspect ratio',()=>{
 assert.deepEqual(imagePayload('A mountain','16:9').generationConfig,{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:'16:9'}});
});
test('Gemini image and plan integrations save real response data without persisting API keys to logs',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'relay-core-'));await mkdir(path.join(directory,'assets'));
 const store={directory,keys:{gemini:'test-secret-only'},state:{tasks:[],assets:[],events:[],connections:[],projects:[]},active:new Map()};
 const original=globalThis.fetch;
 try {
  await context.run(store,async()=>{
   const task={id:'img',title:'A test image',projectId:'p',status:'running',model:'test-image'};store.state.tasks.push(task);
   globalThis.fetch=async(url,options)=>{assert.equal(options.headers['x-goog-api-key'],'test-secret-only');return {ok:true,json:async()=>({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:Buffer.from('test-image-bytes').toString('base64')}}]}}]})};};
   await generateImage(task,'test');assert.equal(task.status,'review');assert.equal(store.state.assets.length,1);
   assert.equal(await readFile(path.join(directory,'assets',store.state.assets[0].filename),'utf8'),'test-image-bytes');
   assert.ok(!JSON.stringify(store.state).includes('test-secret-only'));
   const planner={id:'plan',title:'Plan',model:'test-text',status:'running',planningPrompt:'Plan work'};store.state.tasks.push(planner);
   globalThis.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({tasks:[{title:'Create an image',provider:'gemini-image',dependsOn:[]}]})}]}}]})});
   await generatePlan(planner);assert.equal(planner.status,'review');assert.equal(planner.plan.length,1);
   globalThis.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:'No image'}]}}]})});
   await assert.rejects(()=>generateImage({...task,id:'empty',status:'running'},'x'),/no image/);
  });
 }finally{globalThis.fetch=original;}
});
