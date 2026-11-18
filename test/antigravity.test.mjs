import test from 'node:test';
import assert from 'node:assert/strict';
import { antigravityEvent, migrateLegacyProvider } from '../antigravity.mjs';
import { agentArgs, providers } from '../server.mjs';

test('Antigravity uses agy and its supported execution modes',()=>{
 assert.deepEqual(providers.find(p=>p.id==='antigravity').commands,['agy']);
 assert.ok(!providers.some(p=>p.id==='gemini'));
 assert.ok(providers.some(p=>p.id==='gemini-image'));
 const prompt='Keep this prompt intact; $(echo not-a-command)';
 assert.deepEqual(agentArgs('antigravity',prompt),['-p',prompt,'--output-format','stream-json','--mode','accept-edits','--disable-slash-commands']);
 assert.ok(agentArgs('antigravity',prompt,'',true).includes('plan'));
});
test('Antigravity stream events expose response text and terminal failures',()=>{
 assert.equal(antigravityEvent({event:'step_update',step_update:{text_delta:'Working'}}).text,'Working');
 const success=antigravityEvent({event:'result',result:{status:'SUCCESS',response:'Completed'}});
 assert.equal(success.complete,true);assert.equal(success.failed,false);assert.equal(success.text,'Completed');
 for(const status of ['ERROR','CANCELED','WAITING','INTERRUPTED','RUNNING','INVALID']){
  const failed=antigravityEvent({event:'result',result:{status,error:'Needs permission approval'}});
  assert.equal(failed.failed,true);assert.equal(failed.complete,false);assert.equal(failed.needsPermission,true);
 }
 assert.equal(antigravityEvent({event:'init'}).complete,false);
});
test('Legacy coding tasks migrate without changing Gemini API or inventing a login',()=>{
 const state={tasks:[{provider:'gemini',plan:[{provider:'gemini'},{provider:'gemini-image'}]},{provider:'gemini-image'}],events:[{provider:'gemini'}],connections:['gemini','gemini-image','codex']};
 migrateLegacyProvider(state);
 assert.equal(state.tasks[0].provider,'antigravity');assert.equal(state.tasks[0].plan[0].provider,'antigravity');
 assert.equal(state.tasks[0].plan[1].provider,'gemini-image');assert.equal(state.tasks[1].provider,'gemini-image');
 assert.deepEqual(state.connections,['gemini-image','codex']);assert.equal(state.events[0].provider,'antigravity');
 assert.deepEqual(migrateLegacyProvider(structuredClone(state)),state);
});
