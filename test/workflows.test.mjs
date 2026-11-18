import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProviderAccount, accountEnvironment, accountById } from '../provider-accounts.mjs';
import { git, prepareIntegration, checkIntegration, commitIntegration } from '../integration.mjs';
import { controlSession, requestControl, pendingControls, decideControl, revokeControls, executeFileAction } from '../computer-control.mjs';
import { uploadContext, readContext, stageContext, contextPath, removeContext } from '../shared-context.mjs';
import { repoSlug } from '../github.mjs';
const temporary=()=>fs.mkdtemp(path.join(os.tmpdir(),'syncfly-workflow-'));
test('named subscriptions isolate credentials and reject another provider',async()=>{
 const root=await temporary(),state={};const a=createProviderAccount(state,{provider:'codex',name:'Work'}),b=createProviderAccount(state,{provider:'codex',name:'Personal'});
 const base={CODEX_HOME:'old',OPENAI_API_KEY:'do-not-inherit'};
 const ea=await accountEnvironment(root,a,base),eb=await accountEnvironment(root,b,base);
 assert.notEqual(ea.CODEX_HOME,eb.CODEX_HOME);assert.equal(ea.OPENAI_API_KEY,undefined);assert.equal(base.OPENAI_API_KEY,'do-not-inherit');
 assert.match(await fs.readFile(path.join(ea.CODEX_HOME,'config.toml'),'utf8'),/"file"/);
 assert.throws(()=>accountById(state,a.id,'claude'));assert.throws(()=>accountById({},a.id,'codex'));
 const c=createProviderAccount(state,{provider:'claude',name:'Max'});assert.ok((await accountEnvironment(root,c,{})).CLAUDE_CONFIG_DIR);
});
test('combine worker snapshots without changing original checkouts',async()=>{
 const root=await temporary(),repo=path.join(root,'repo');await fs.mkdir(repo);await git(repo,['init']);await fs.writeFile(path.join(repo,'base.txt'),'base');await git(repo,['add','.']);await git(repo,['commit','-m','base']);
 const sources=[];
 for(let i=0;i<2;i++){const cwd=path.join(root,'worker'+i);await git(repo,['worktree','add','-b','worker'+i,cwd]);await fs.writeFile(path.join(cwd,'new'+i+'.txt'),'result'+i);sources.push({id:String(i),title:'Worker '+i,worktree:cwd,logs:[]});}
 const cwd=path.join(root,'integration');await git(repo,['worktree','add','-b','integration',cwd]);const task={title:'Integrated work',worktree:cwd};
 await prepareIntegration({name:'Test'},sources,task,root);await checkIntegration(task);
 assert.equal(await fs.readFile(path.join(cwd,'new0.txt'),'utf8'),'result0');assert.equal(await fs.readFile(path.join(cwd,'new1.txt'),'utf8'),'result1');
 assert.match(await git(sources[0].worktree,['status','--porcelain']),/\?\? new0/);
 await fs.writeFile(path.join(cwd,'repair.txt'),'repaired');assert.match(await commitIntegration(task),/^[a-f0-9]{40}$/);
 assert.equal(await git(cwd,['status','--porcelain']),'');
});
test('computer actions require owner approval; deny and revoke never execute',async()=>{
 const token=controlSession({id:'owner'},{id:'task',title:'Test',provider:'claude'});let executions=0;
 let pending=requestControl(token,'write_file',{path:'C:/example.txt',text:'hello',reason:'Requested edit'});let id=pendingControls('owner')[0].id;
 await assert.rejects(decideControl('other',id,true,()=>{executions++;}));assert.equal(executions,0);
 await decideControl('owner',id,false,()=>{executions++;});assert.equal((await pending).isError,true);assert.equal(executions,0);
 pending=requestControl(token,'screenshot',{reason:'Inspect layout'});id=pendingControls('owner')[0].id;
 await decideControl('owner',id,true,async()=>{executions++;return {content:[{type:'text',text:'fixture'}]};});assert.equal((await pending).content[0].text,'fixture');assert.equal(executions,1);
 await assert.rejects(decideControl('owner',id,true));pending=requestControl(token,'screenshot',{reason:'Inspect'});revokeControls('task');assert.equal((await pending).isError,true);assert.throws(()=>requestControl(token,'screenshot',{reason:'Retry'}));
});
test('approved file actions create, read, safely overwrite and move',async()=>{
 const root=await temporary(),file=path.join(root,'note.txt');await executeFileAction('write_file',{path:file,text:'before'});
 await assert.rejects(executeFileAction('write_file',{path:file,text:'after'}),/SHA-256/);
 const read=JSON.parse((await executeFileAction('read_file',{path:file})).content[0].text);
 await executeFileAction('write_file',{path:file,text:'after',expectedSha256:read.sha256});
 await executeFileAction('create_folder',{path:path.join(root,'extra')});await executeFileAction('move_path',{path:file,destination:path.join(root,'extra/note.txt')});
 assert.equal(await fs.readFile(path.join(root,'extra/note.txt'),'utf8'),'after');
});
test('shared context retains binary files and directories, excludes traversal',async()=>{
 const root=await temporary(),project={id:'project'},cwd=path.join(root,'run');await fs.mkdir(cwd);
 for(const name of ['../bad','C:/bad','a/../../bad','con.txt','a./b','a\\..\\b'])assert.throws(()=>contextPath(name));
 const bytes=Buffer.from([0,255,23,48]);const file=await uploadContext(root,project,{name:'references/images/design.png',base64:bytes.toString('base64')});
 assert.deepEqual((await readContext(root,project,file.id)).bytes,bytes);
 const staged=await stageContext(root,project,cwd);assert.match(staged.prompt,/design.png/);
 const folder=(await fs.readdir(cwd))[0];assert.deepEqual(await fs.readFile(path.join(cwd,folder,file.name)),bytes);await staged.cleanup();assert.deepEqual(await fs.readdir(cwd),[]);
 await removeContext(root,project,file.id);assert.equal(project.contextFiles.length,0);
});
test('GitHub repository parsing supports private repo identifiers without embedded credentials',()=>{assert.equal(repoSlug('https://github.com/org/private.git'),'org/private');assert.equal(repoSlug('git@github.com:org/private.git'),'org/private');assert.throws(()=>repoSlug('https://token@github.com/org/private'));});
test('orchestrator cannot finish while worker merges still conflict',async()=>{
 const root=await temporary(),repo=path.join(root,'repo');await fs.mkdir(repo);await git(repo,['init']);await fs.writeFile(path.join(repo,'shared.txt'),'original\n');await git(repo,['add','.']);await git(repo,['commit','-m','base']);
 const sources=[];for(let i=0;i<2;i++){const worktree=path.join(root,'worker'+i);await git(repo,['worktree','add','-b','worker'+i,worktree]);await fs.writeFile(path.join(worktree,'shared.txt'),'worker '+i+'\n');sources.push({id:String(i),title:'Worker',worktree});}
 const worktree=path.join(root,'integration');await git(repo,['worktree','add','-b','integration',worktree]);const task={worktree};const prompt=await prepareIntegration({name:'Conflicting work'},sources,task,root);
 assert.match(prompt,/merge has conflicts/);await assert.rejects(checkIntegration(task),/unresolved/);
 await fs.writeFile(path.join(worktree,'shared.txt'),'Combined and repaired\n');await git(worktree,['add','.']);await git(worktree,['commit','-m','Resolve worker conflict']);await checkIntegration(task);
});
