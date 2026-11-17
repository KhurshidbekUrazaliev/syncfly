import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('desktop first account, local origins, closed registration and empty workspace',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'syncfly-desktop-'));
 const port=4398, base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),RELAY_DATA_DIR:dir,RELAY_EXECUTION:'docker',RELAY_PUBLIC_URL:`http://localhost:${port}`,RELAY_ALLOW_SIGNUP:'false',RELAY_INVITE_CODE:'desktop-test-code'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{child.kill();await new Promise(resolve=>child.once('exit',resolve));await rm(dir,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Start timeout')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Exit ${code}`));});});
 const send=(pathname,body,origin=base)=>fetch(base+pathname,{method:body?'POST':'GET',headers:{origin,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
 assert.deepEqual(await (await send('/api/auth/config')).json(),{needsSetup:true,registrationOpen:true,invitationRequired:true});
 const account={name:'Owner',email:'owner@example.test',password:'desktop-test-password',invitation:'desktop-test-code'};
 assert.equal((await send('/api/auth/register',{...account,invitation:''})).status,403);
 assert.equal((await send('/api/auth/register',account,'https://untrusted.example')).status,403);
 const attempts=await Promise.all([send('/api/auth/register',account),send('/api/auth/register',{...account,email:'second@example.test'})]);
 assert.deepEqual(attempts.map(r=>r.status).sort(),[200,403]);
 const cookie=attempts.find(r=>r.ok).headers.get('set-cookie').split(';')[0];
 const state=await (await fetch(base+'/api/state',{headers:{cookie}})).json();
 for(const key of ['projects','tasks','events','assets','connections'])assert.deepEqual(state[key],[]);
 assert.deepEqual(await (await send('/api/auth/config')).json(),{needsSetup:false,registrationOpen:false,invitationRequired:true});
 assert.equal((await send('/api/auth/register',{...account,email:'third@example.test'})).status,403);
 assert.equal((await send('/api/auth/login',{email:'owner@example.test',password:account.password},`http://localhost:${port}`)).status,attempts[0].ok?200:401);
 assert.equal((await send('/api/auth/config',null,'http://localhost:1234')).status,403);
});
