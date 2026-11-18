const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root=path.resolve(__dirname,'..');
const testDir=fs.mkdtempSync(path.join(root,'.desktop-test-e2e-'));
const executablePath=process.env.SYNCFLY_TEST_EXE || path.join(root,'node_modules/electron/dist/electron.exe');
const packaged=!!process.env.SYNCFLY_TEST_EXE;
if(packaged){const mcp=execFileSync(executablePath,[path.join(path.dirname(executablePath),'resources','app.asar','computer-mcp.mjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n',encoding:'utf8',timeout:20000});assert.ok(JSON.parse(mcp.trim()).result.tools.some(t=>t.name==='write_file'));}
const env={...process.env,SYNCFLY_SMOKE_DATA:testDir};delete env.ELECTRON_RUN_AS_NODE;
const cliRoot=path.join(testDir,'cli','node_modules','@openai','codex');
fs.mkdirSync(cliRoot,{recursive:true});
// A harmless --version-only executable for the Antigravity installation check.
fs.copyFileSync(process.execPath,path.join(testDir,'cli','agy.exe'));
if(process.env.SYNCFLY_TEST_REAL_CURSOR!=='1'){
 const cursorFixture=path.join(testDir,'cli','versions','2026.11.17-abcdef');fs.mkdirSync(cursorFixture,{recursive:true});
 fs.copyFileSync(process.execPath,path.join(cursorFixture,'node.exe'));
 fs.copyFileSync(path.join(__dirname,'acp-fixture.cjs'),path.join(cursorFixture,'index.js'));
 fs.writeFileSync(path.join(cursorFixture,'package.json'),JSON.stringify({type:'commonjs'}));
}
fs.writeFileSync(path.join(cliRoot,'package.json'),JSON.stringify({bin:{codex:'cli.cjs'}}));
fs.writeFileSync(path.join(cliRoot,'cli.cjs'),`if(process.argv[2]==='login')console.log('Logged in (test fixture)');else if(process.argv.join(' ').includes('Concurrent worker'))setTimeout(()=>console.log('Completed'),120000);else{require('fs').writeFileSync('test-result.txt','Verified local task execution');console.log(JSON.stringify({type:'item.completed',item:{text:'Test fixture completed the task.'}}));}`);
fs.appendFileSync(path.join(cliRoot,'cli.cjs'),`if(process.argv.join(' ').includes('Computer fixture'))fetch(process.env.SYNCFLY_CONTROL_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Syncfly-Control':process.env.SYNCFLY_CONTROL_TOKEN},body:JSON.stringify({tool:'read_file',args:{path:process.cwd()+'/test-result.txt',reason:'Test approval gate'}})}).then(r=>r.json()).then(r=>console.log(JSON.stringify({type:'item.completed',item:{text:JSON.stringify(r)}})));`);
const claudeRoot=path.join(testDir,'cli','node_modules','@anthropic-ai','claude-code');fs.mkdirSync(claudeRoot,{recursive:true});
fs.writeFileSync(path.join(claudeRoot,'package.json'),JSON.stringify({bin:{claude:'cli.cjs'}}));
fs.writeFileSync(path.join(claudeRoot,'cli.cjs'),`if(process.argv[2]==='auth')console.log(JSON.stringify({loggedIn:true}));else if(process.argv.includes('--tools')){console.log(JSON.stringify({type:'result',result:JSON.stringify({approve:true,reason:'Fixture approval'})}));}else{const fs=require('fs');if(!fs.readdirSync('.').some(f=>f.startsWith('.syncfly-context-')))process.exit(2);fs.writeFileSync('integration-review.txt','Reviewed combined changes with uploaded context');console.log(JSON.stringify({type:'result',result:'Integration fixture reviewed worker changes.'}));}`);
const originalPath=env.Path||env.PATH;delete env.Path;env.PATH=path.join(testDir,'cli')+path.delimiter+originalPath;
const repo=path.join(testDir,'repository');fs.mkdirSync(repo);
execFileSync('git',['init',repo],{stdio:'ignore'});fs.writeFileSync(path.join(repo,'README.md'),'Desktop test repository');
execFileSync('git',['-C',repo,'add','.']);execFileSync('git',['-C',repo,'-c','user.name=Desktop Test','-c','user.email=test@example.test','commit','-m','Initial test commit'],{stdio:'ignore'});
let desktop;
async function launch(){desktop=await _electron.launch({executablePath,args:[...(packaged?[]:[root]),'--test-mode'],env,timeout:60000});const page=await desktop.firstWindow();page.setDefaultTimeout(15000);await page.locator('#auth-form').waitFor();return page;}
async function auth(page,email,password,enter=false){await page.locator('[name=email]').fill(email);await page.locator('[name=password]').fill(password);if(enter)await page.locator('[name=password]').press('Enter');else await page.getByRole('button',{name:/^(Create account|Sign in)$/}).click();}
(async()=>{
 try {
  let page=await launch();
  await page.screenshot({path:path.join(testDir,'welcome.png')});
  assert.equal(await page.locator('[name=invitation]').count(),0);
  assert.equal(await page.getByText('Launchpad website').count(),0);
  await page.locator('[name=name]').fill('Desktop Test');
  await auth(page,'desktop@example.test','short');
  await page.getByRole('alert').filter({hasText:'12–256'}).waitFor();
  await auth(page,'desktop@example.test','desktop-test-password-123');
  await page.getByRole('heading',{name:'Your first project starts here'}).waitFor();
  assert.equal(await page.getByText('Example workspace').count(),0);
  await page.getByRole('button',{name:'Create project',exact:true}).last().click();
  await page.locator('#project-form [name=name]').fill('My real project');
  await page.locator('#project-form [name=context]').fill('Persistent desktop project.');
  await page.locator('#project-form [name=directory]').fill(repo);
  await page.locator('[data-action=save-project]').click();
  await page.getByRole('heading',{name:'My real project',exact:true}).waitFor();
  await page.locator('[data-action=new-task]').first().click();
  await page.locator('#task-form [name=title]').fill('My first real task');
  await page.locator('#task-form [name=provider]').selectOption('codex');
  await page.locator('[data-action=save-task]').click();
  await page.locator('.task-card').filter({hasText:'My first real task'}).click();
  await page.locator('[data-task-action=run]').click();
  await page.getByRole('alert').filter({hasText:'Connect this agent'}).waitFor();
  await page.locator('.modal-header [data-action=close]').click();
  await page.locator('[data-page=connections]').click();
  await page.getByRole('heading',{name:'Your AI team'}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Gemini CLI',exact:true}).count(),0);
  await page.getByRole('heading',{name:'Antigravity',exact:true}).waitFor();
  await page.locator('[data-connect=antigravity]').click();
  await page.getByRole('button',{name:'Enable Antigravity',exact:true}).click();
  await page.locator('.connection-card').filter({has:page.getByRole('heading',{name:'Antigravity',exact:true})}).getByText('● Enabled',{exact:true}).waitFor();
  await page.locator('[data-connect=cursor]').click();
  await page.locator('[data-save-connection=cursor]').click();
  await page.locator('.connection-card').filter({has:page.getByRole('heading',{name:'Cursor Agent',exact:true})}).getByText('● Connected',{exact:true}).waitFor();
  await page.locator('[data-connect=codex]').click();
  await page.locator('[data-save-connection=codex]').click();
  await page.locator('.connection-card').filter({has:page.getByRole('heading',{name:'Codex',exact:true})}).getByText('● Connected',{exact:true}).waitFor();
  await page.locator('[data-action=switch]').click();
  await page.locator('.task-card').filter({hasText:'My first real task'}).click();
  await page.locator('[data-task-action=run]').click();
  await page.locator('[data-task-action=approve]').waitFor({timeout:25000});
  await page.locator('[data-task-action=diff]').click();
  await page.getByText('test-result.txt',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Back to task'}).click();
  await page.locator('[data-task-action=approve]').click();
  await page.locator('.modal-header [data-action=close]').click();
  await page.getByRole('button',{name:'Account',exact:true}).click();
  await page.getByRole('heading',{name:'Your account'}).waitFor();
  await page.locator('.modal-header [data-action=close]').click();
  await page.locator('[data-action=logout]').click();
  await page.locator('#auth-form').waitFor();
  await auth(page,'desktop@example.test','incorrect-password-123',true);
  await page.getByRole('alert').filter({hasText:'incorrect'}).waitFor();
  await auth(page,'desktop@example.test','desktop-test-password-123',true);
  await page.locator('[data-action=switch]').click();
  await page.getByRole('heading',{name:'My real project',exact:true}).waitFor();
  await page.screenshot({path:path.join(testDir,'workspace.png')});
  await desktop.close(); desktop=null;
  page=await launch();
  await auth(page,'desktop@example.test','desktop-test-password-123');
  await page.getByRole('heading',{name:'My real project',exact:true}).waitFor();
  assert.equal(await page.locator('.task-card').count(),1);
  const state=await page.evaluate(()=>fetch('/api/state').then(r=>r.json()));
  assert.equal(state.projects.length,1);assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].status,'done');
  // Exercise new controls without opening provider logins or touching real PC files.
  await page.locator('[data-tab=context]').click();
  await page.locator('[data-context-upload]:not([webkitdirectory])').setInputFiles({name:'reference.txt',mimeType:'text/plain',buffer:Buffer.from('Extra reference for integration')});
  await page.getByText('reference.txt · 1 KB',{exact:true}).waitFor();
  const contextFolder=path.join(testDir,'extra-context');fs.mkdirSync(path.join(contextFolder,'images'),{recursive:true});fs.writeFileSync(path.join(contextFolder,'images','sample.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
  await page.locator('[data-context-upload][webkitdirectory]').setInputFiles(contextFolder);
  await page.getByText('extra-context/images/sample.png · 1 KB',{exact:true}).waitFor();
  await page.locator('[data-page=connections]').click();
  await page.locator('[data-workflow=add-account]').click();await page.locator('#provider-account-form [name=name]').fill('Claude Max fixture');await page.locator('[data-workflow=save-account]').click();
  await page.locator('[data-workflow=account-verify]').click();await page.getByText('Claude Code · Verified',{exact:true}).waitFor();
  await page.locator('[data-action=switch]').click();await page.locator('[data-workflow=orchestrate]').click();
  assert.equal(await page.locator('#orchestrator-form [name=provider]').inputValue(),'claude');
  await page.locator('#orchestrator-form [name=accountId]').selectOption({label:'Claude Max fixture'});
  await page.locator('[data-workflow=start-orchestrator]').click();await page.locator('[data-workflow=publish][data-mode=pr]').waitFor({timeout:30000});
  await page.locator('[data-task-action=diff]').click();await page.getByText('integration-review.txt',{exact:false}).waitFor();
  await page.locator('.modal-header [data-action=close]').click();
  await page.locator('[data-tab=board]').click();await page.locator('[data-action=new-task]').first().click();await page.locator('#task-form [name=title]').fill('Computer fixture');await page.locator('#task-form [name=provider]').selectOption('codex');await page.locator('#task-form [name=computerUse]').check();await page.locator('[data-action=save-task]').click();
  await page.locator('.task-card').filter({hasText:'Computer fixture'}).click();await page.locator('[data-task-action=run]').click();
  // Computer request is reviewed automatically by the orchestrator fixture.
  await page.waitForFunction(async()=>{const s=await fetch('/api/state').then(r=>r.json());return s.tasks.find(t=>t.title==='Computer fixture')?.status==='review';});
  await page.locator('[data-task-action=approve]').waitFor();
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('[data-workflow=computer-approvals]').count(),0);
  await page.locator('.modal-header [data-action=close]').click();
  if(process.env.SYNCFLY_TEST_REAL_CURSOR!=='1'){
   await page.locator('[data-action=new-task]').first().click();await page.locator('#task-form [name=title]').fill('Native approval fixture');await page.locator('#task-form [name=provider]').selectOption('cursor');await page.locator('#task-form [name=dependency]').selectOption({label:'My first real task'});await page.locator('[data-action=save-task]').click();
   await page.locator('.task-card').filter({hasText:'Native approval fixture'}).click();await page.locator('[data-workflow=run-settings]').click();await page.locator('[data-workflow=clear-prerequisites]').click();await page.locator('[data-workflow=save-run-settings]').click();
   await page.evaluate(async()=>{const s=await fetch('/api/state').then(r=>r.json());const t=s.tasks.find(t=>t.title==='Native approval fixture');const r=await fetch('/api/tasks/'+t.id+'/run',{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':s.csrf},body:'{}'});if(!r.ok)throw new Error(await r.text());});
   for(let attempt=0;attempt<60;attempt++){const status=await page.evaluate(async()=>{const s=await fetch('/api/state').then(r=>r.json());return s.tasks.find(t=>t.title==='Native approval fixture')?.status;});if(status==='review')break;if(status==='failed')throw new Error('Native fixture failed');await page.waitForTimeout(500);}
   const native=await page.evaluate(async()=>{const s=await fetch('/api/state').then(r=>r.json());return s.tasks.find(t=>t.title==='Native approval fixture');});assert.deepEqual(native.dependencies,[]);assert.equal(fs.readFileSync(path.join(native.worktree,'native-result.txt'),'utf8'),'Native approval passed');
   await page.locator('[data-task-action=approve]').waitFor();
   await page.waitForTimeout(1000);
   assert.ok(native.logs.some(l=>l.text.includes('Orchestrator approved')));
   await page.locator('.modal-header [data-action=close]').click();
  }
  await page.screenshot({path:path.join(testDir,'workflows.png')});
  // No real provider calls: use only fixture CLIs for simultaneous execution.
  if(process.env.SYNCFLY_TEST_REAL_CURSOR!=='1'){
   const parallel=await page.evaluate(async()=>{
    const state=await fetch('/api/state').then(r=>r.json());
    const call=async(url,body)=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':state.csrf},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
    const tasks=[];
    for(let i=0;i<11;i++)tasks.push((await call('/api/tasks',{title:'Concurrent worker '+i,projectId:state.projects[0].id,provider:i%2?'cursor':'codex',dependencies:[]})).data);
    try{
     const starts=await Promise.all(tasks.slice(0,10).map(t=>call('/api/tasks/'+t.id+'/run',{})));
     const running=(await fetch('/api/state').then(r=>r.json())).tasks.filter(t=>t.status==='running').length;
     const overflow=await call('/api/tasks/'+tasks[10].id+'/run',{});
     await Promise.all(tasks.slice(0,10).map(t=>call('/api/tasks/'+t.id+'/stop',{})));
     const resumed=await call('/api/tasks/'+tasks[10].id+'/run',{});
     await call('/api/tasks/'+tasks[10].id+'/stop',{});
     const dependent=(await call('/api/tasks',{title:'Blocked dependent',projectId:state.projects[0].id,provider:'codex',dependencies:[tasks[0].id]})).data;
     const blocked=await call('/api/tasks/'+dependent.id+'/run',{});
     return {starts:starts.map(r=>r.status),running,overflow,resumed:resumed.status,blocked};
    }finally{for(const t of tasks)await call('/api/tasks/'+t.id+'/stop',{});}
   });
   assert.deepEqual(parallel.starts,Array(10).fill(200));assert.equal(parallel.running,10);
   assert.equal(parallel.overflow.status,400);assert.match(parallel.overflow.data.error,/10 task slots/);
   assert.equal(parallel.resumed,200);assert.equal(parallel.blocked.status,400);assert.match(parallel.blocked.data.error,/prerequisite/);
  }
  await page.locator('[data-action=logout]').click();
  await page.getByRole('button',{name:'Create a new account'}).click();
  await page.locator('[name=name]').fill('Second User');
  await auth(page,'second@example.test','second-test-password-123');
  await page.getByRole('heading',{name:'Your first project starts here'}).waitFor();
  console.log(JSON.stringify({passed:true,checks:['registration click','password validation','empty workspace','project creation','task creation','unconnected provider error','connections','Antigravity enable','Cursor Windows connection','fixture CLI run','diff review','task approval','account button','logout','Enter-key login','restart persistence','shared files and folder uploads','named Claude account','orchestrator combines worker changes','orchestrator computer approval','orchestrator native edit approval','run settings remove prerequisite','ten concurrent fixture agents','capacity recovery','dependency enforcement','second account isolation'],testDir},null,2));
 }finally{if(desktop)await desktop.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});



