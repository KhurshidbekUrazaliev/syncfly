import { reviewPermission } from './orchestrator-approval.mjs';
import { uploadContext, readContext, removeContext, stageContext, apiContextParts } from './shared-context.mjs';
import http from 'node:http';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolveNativeCLI } from './native-cli.mjs';
import { antigravityEvent } from './antigravity.mjs';
import { accountById, createProviderAccount, accountEnvironment, loginInstructions, openLoginTerminal } from './provider-accounts.mjs';
import { prepareIntegration, checkIntegration, git } from './integration.mjs';
import { githubStatus, repositoryInfo, cloneGitHub, publishIntegration, ghExecutable } from './github.mjs';
import { pendingControls, requestControl, decideControl, revokeControls } from './computer-control.mjs';
import { setupComputer } from './computer-setup.mjs';
import { spawnACP } from './acp-runner.mjs';
import { spawnClaude } from './claude-runner.mjs';
import { requestNativeApproval } from './computer-control.mjs';
import { taskFailure } from './task-workflow.mjs';

const exec = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
import { context, cloud, ROOT_DATA, dataDir, state, keys, active, activeTaskCount, initCloud, authenticate, authRoute, registrationInfo, runnerAvailable, prepareRunner, spawnAgent, execAgent, loginStart, stopContainer } from './cloud.mjs';
let PORT = Number(process.env.PORT || 4310);
const HOST = process.env.RELAY_BIND || '127.0.0.1';
let writes = Promise.resolve();
export const providers = [
  { id: 'claude', name: 'Claude Code', subtitle: 'Anthropic', type: 'cli', commands: ['claude'], login: 'claude auth login', capabilities: ['Code', 'Research', 'Review'], color: 'clay' },
  { id: 'codex', name: 'Codex', subtitle: 'OpenAI', type: 'cli', commands: ['codex'], login: 'codex login', capabilities: ['Code', 'Debug', 'Review'], color: 'mint' },
  { id: 'antigravity', name: 'Antigravity', subtitle: 'Google', type: 'cli', commands: ['agy'], login: 'agy', capabilities: ['Research', 'Code', 'Review'], color: 'blue' },
  { id: 'cursor', name: 'Cursor Agent', subtitle: 'Cursor', type: 'cli', commands: ['agent', 'cursor-agent'], login: 'agent login', capabilities: ['Code', 'Debug', 'Review'], color: 'violet' },
  { id: 'gemini-image', name: 'Gemini API', subtitle: 'Google AI Studio · API', type: 'api', capabilities: ['Image generation', 'Planning'], color: 'blue' },
];
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function clean(value, max = 10000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function persist() {
 const data=JSON.stringify(state,null,2),dir=dataDir();
 const operation=writes.then(async()=>{
  const temporary=path.join(dir,'state-'+randomUUID()+'.tmp');await fs.writeFile(temporary,data,{mode:0o600});
  try{for(let attempt=0;;attempt++){try{await fs.rename(temporary,path.join(dir,'state.json'));break;}catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=10)throw e;await new Promise(resolve=>setTimeout(resolve,50*(attempt+1)));}}}
  finally{await fs.rm(temporary,{force:true}).catch(()=>{});}
 });
 writes=operation.catch(e=>console.error('Workspace save failed:',e.message));return operation;
}
function event(text, taskId = null, kind = 'info') { state.events.unshift({ id: randomUUID(), text, taskId, kind, at: new Date().toISOString() }); state.events = state.events.slice(0, 300); persist(); }
function redact(s) { let v = String(s); for (const key of Object.values(context.getStore()?.keys || {})) if (key) v = v.split(key).join('[REDACTED]'); return v.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''); }
function log(task, value) { task.logs ||= []; task.logs.push({ at: new Date().toISOString(), text: redact(value).slice(0, 16000) }); task.logs = task.logs.slice(-500); persist(); }
async function executable(p) { if (cloud) return await runnerAvailable() ? p.commands?.[0] : null; return resolveNativeCLI(p.commands); }
async function inventory() { return Promise.all(providers.map(async p => ({ ...p, installed: p.type === 'api' || !!await executable(p), connected: state.connections.includes(p.id), keyConfigured: p.id === 'gemini-image' && !!keys.gemini, authStatus: p.id === 'antigravity' && state.connections.includes(p.id) ? 'CLI enabled; login checked when run' : undefined }))); }
async function verify(id, accountId = '') {
  const account = accountById(state, accountId, id);
  const profileEnv = await accountEnvironment(dataDir(), account);
  const p = providers.find(p => p.id === id); if (!p || p.type !== 'cli') fail('Unknown CLI provider.');
  const bin = await executable(p); if (!bin) fail(`${p.name} is not installed or is not on PATH. Install its official CLI first.`);
  const check = (args) => cloud ? execAgent(id, args) : exec(bin.file, [...bin.args, ...args], { timeout: 10000, windowsHide: true, env: profileEnv });
  try {
    if (id === 'claude') { const { stdout } = await check(['auth', 'status', '--json']); if (!JSON.parse(stdout).loggedIn) fail('Sign in with claude auth login, then try again.'); }
    if (id === 'codex') await check(['login', 'status']);
    if (id === 'cursor') await check(['status']);
    if (id === 'antigravity') await check(['--version']);
  } catch (e) { fail(e.status ? e.message : `Could not verify ${p.name}. Complete its official sign-in in your terminal, then try again.`); }
  if (account) account.verified = true; else if (!state.connections.includes(id)) state.connections.push(id);
  event(`${p.name} ${id === 'antigravity' ? 'enabled (sign-in is checked on first run)' : 'connected'}.`); await persist();
}
export function agentArgs(id, prompt, model = '', readOnly = false) {
  const args = id === 'claude' ? ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', readOnly ? 'plan' : 'acceptEdits']
    : id === 'codex' ? ['exec', '--json', '--sandbox', readOnly ? 'read-only' : 'workspace-write', prompt]
    : id === 'antigravity' ? ['-p', prompt, '--output-format', 'stream-json', '--mode', readOnly ? 'plan' : 'accept-edits', '--disable-slash-commands']
    : id === 'cursor' ? ['-p', prompt, '--output-format', 'stream-json'] : null;
  if (!args) fail('Unsupported agent.'); if (model || id==='claude') args.push('--model', model || 'sonnet'); return args;
}
export function validateTask(input, current) {
  const title = clean(input.title, 160); if (!title) fail('Give this task a title.');
  const project = current.projects.find(p => p.id === input.projectId); if (!project) fail('Select a project.');
  const provider = clean(input.provider, 40); if (provider && !providers.some(p => p.id === provider)) fail('Choose a supported agent.');
  const dependencies = Array.isArray(input.dependencies) ? [...new Set(input.dependencies)] : [];
  if (dependencies.some(id => !current.tasks.some(t => t.id === id && t.projectId === project.id))) fail('Dependencies must be tasks in this project.');
  const accountId = clean(input.accountId,80); accountById(current,accountId,provider);
  return { title, projectId: project.id, provider, accountId, computerUse: !!input.computerUse, description: clean(input.description), category: clean(input.category, 50) || 'General', priority: ['Low', 'Medium', 'High'].includes(input.priority) ? input.priority : 'Medium', model: clean(input.model, 120), dependencies, dependencyMode:input.dependencyMode==='advisory'?'advisory':'explicit', readOnly: !!input.readOnly, aspectRatio: ['1:1', '16:9', '9:16', '4:3', '3:4'].includes(input.aspectRatio) ? input.aspectRatio : '1:1' };
}
export function imagePayload(prompt, aspectRatio = '1:1') { return { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio } } }; }
export async function generateImage(task, prompt) {
  if (!keys.gemini) fail('Add your Gemini API key in Connections first.');
  const model = task.model || 'gemini-3.1-flash-image';
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) fail('Invalid image model ID.');
  const controller = new AbortController(); active.set(task.id, controller);
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    log(task, `Sending image request to ${model}…`);
    const payload=imagePayload(prompt,task.aspectRatio);payload.contents[0].parts.push(...await apiContextParts(dataDir(),state.projects.find(p=>p.id===task.projectId)));
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys.gemini }, body: JSON.stringify(payload), signal: controller.signal });
    const data = await response.json(); if (!response.ok) fail(data.error?.message || `Google API returned ${response.status}.`);
    let count = 0;
    for (const part of data.candidates?.[0]?.content?.parts || []) {
      if (part.text) log(task, part.text);
      const inline = part.inlineData || part.inline_data;
      if (inline?.data) {
        const mime = inline.mimeType || inline.mime_type;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) continue;
        const id = randomUUID(); const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime]; const filename = `${id}.${ext}`;
        await fs.writeFile(path.join(dataDir(), 'assets', filename), Buffer.from(inline.data, 'base64'), { mode: 0o600 });
        state.assets.unshift({ id, filename, mime, taskId: task.id, projectId: task.projectId, title: task.title, model, at: new Date().toISOString() }); count++;
      }
    }
    if (!count) fail(data.promptFeedback?.blockReason ? `Image blocked: ${data.promptFeedback.blockReason}` : 'The model returned no image. Check the prompt and image model, then retry.');
    if (task.status !== 'cancelled') { task.status = 'review'; log(task, `${count} image${count > 1 ? 's' : ''} saved to Assets.`); event(`Images ready for review: ${task.title}`, task.id, 'success'); }
  } finally { clearTimeout(timer); active.delete(task.id); }
}
export function parsePlan(text) {
  const cleaned = text.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  let plan; try { plan = JSON.parse(cleaned.slice(start, end + 1)); } catch { fail('The lead returned an invalid plan. Retry with a simpler goal or another model.'); }
  if (!Array.isArray(plan.tasks) || plan.tasks.length < 1 || plan.tasks.length > 12) fail('A plan must contain 1–12 tasks.');
  return plan.tasks.map((p,i) => {
    if (!clean(p.title,160) || !providers.some(a => a.id === p.provider)) fail('The plan includes an invalid task or agent.');
    const dependsOn = Array.isArray(p.dependsOn) ? [...new Set(p.dependsOn)] : [];
    if (dependsOn.some(n => !Number.isInteger(n) || n < 0 || n >= i)) fail('Plan dependencies must refer to earlier tasks.');
    return { title: clean(p.title,160), description: clean(p.description), provider: p.provider, accountId: clean(p.accountId,80), category: clean(p.category,50) || 'General', priority: ['High','Medium','Low'].includes(p.priority) ? p.priority : 'Medium', dependsOn };
  });
}
export async function generatePlan(task) {
  if (!keys.gemini) fail('Connect Gemini API first.');
  const controller = new AbortController(); active.set(task.id, controller);
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    let model = task.model;
    if (!model) {
      const list = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': keys.gemini }, signal: controller.signal });
      const catalog = await list.json();
      model = catalog.models?.find(m=>/gemini.*flash/.test(m.name) && !/image|audio|tts|live|lite/.test(m.name) && m.supportedGenerationMethods?.includes('generateContent'))?.name?.replace('models/','') || 'gemini-2.5-flash';
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) fail('Invalid planner model ID.');
    log(task, `Planning with ${model}…`);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':keys.gemini}, body:JSON.stringify({contents:[{parts:[{text:task.planningPrompt},...await apiContextParts(dataDir(),state.projects.find(p=>p.id===task.projectId))]}],generationConfig:{responseMimeType:'application/json'}}), signal:controller.signal });
    const result = await response.json(); if (!response.ok) fail(result.error?.message || 'Planning request failed.');
    const text = (result.candidates?.[0]?.content?.parts || []).filter(p=>!p.thought).map(p=>p.text||'').join('');
    task.plan = parsePlan(text);
    if(task.status !== 'cancelled') { task.status='review'; log(task, `Proposed ${task.plan.length} tasks. Review the assignments before accepting.`); event('Your project plan is ready for review.',task.id,'success'); }
    await persist();
  } finally {clearTimeout(timer); active.delete(task.id);}
}
async function runTask(task) {
  const user = context.getStore(); user.starting ||= new Set();
  if (user.starting.has(task.id)) fail('This task is already starting.');
  const hostLimit = Number(process.env.RELAY_MAX_ACTIVE_TASKS || 0);
  if (hostLimit > 0 && activeTaskCount() >= hostLimit) fail(`All ${hostLimit} task slots are in use. Wait for a task to finish or stop a running task.`);
  if (activeTaskCount([user]) >= 10) fail('Ten tasks are already starting or running.');
  user.starting.add(task.id);
  try { return await runTaskInner(task); } catch(e){if(task.status==='running'&&!active.has(task.id)){task.status='failed';task.error=e.message;await persist();}throw e;} finally { user.starting.delete(task.id); }
}
async function startOrchestrator(project,input={}){
 if(cloud)fail('The integrated orchestrator currently requires the desktop app.');
 if(!project.directory)fail('Connect a Git repository in Project settings first.');
 if(state.tasks.some(t=>t.projectId===project.id&&t.kind==='orchestrate'&&['queued','running'].includes(t.status)))fail('This project already has an orchestrator queued or running.');
 const sources=state.tasks.filter(t=>t.projectId===project.id&&!['orchestrate','plan'].includes(t.kind)&&t.worktree&&['review','done'].includes(t.status)&&(input.sourceTaskIds?input.sourceTaskIds.includes(t.id):!t.integratedBy));
 if(!sources.length)fail('Finish at least one coding task before reviewing and combining work.');
 const provider=input.provider||project.orchestratorProvider||'claude';
 const task={...validateTask({title:'Review, combine, and fix: '+project.name,projectId:project.id,provider,accountId:input.accountId??project.orchestratorAccountId,computerUse:!!input.computerUse,category:'Orchestration',description:'Review completed work, merge worker results, resolve conflicts, and run tests.'},state),id:randomUUID(),kind:'orchestrate',sourceTaskIds:sources.map(t=>t.id),dependencies:[],status:'queued',logs:[],createdAt:new Date().toISOString()};
 state.tasks.push(task);await persist();try{await runTask(task);}catch(e){task.status='failed';task.error=e.message;await persist();throw e;}return task;
}
async function maybeOrchestrate(project){
 if(!project.autoOrchestrate||state.tasks.some(t=>t.projectId===project.id&&(t.status==='running'||context.getStore().starting?.has(t.id))))return;
 if(!state.tasks.some(t=>t.projectId===project.id&&!['orchestrate','plan'].includes(t.kind)&&t.worktree&&!t.integratedBy&&['review','done'].includes(t.status)))return;
 const account=accountById(state,project.orchestratorAccountId,project.orchestratorProvider||'claude');
 if(account?!account.verified:!state.connections.includes(project.orchestratorProvider||'claude'))return;
 await startOrchestrator(project);
}
async function runTaskInner(task) {
  if (active.has(task.id) || task.status === 'running') fail('This task is already running.');
  if (!task.provider) fail('Assign an agent first.');
  if(task.computerUse&&(cloud||task.provider==='gemini-image'))fail('Computer actions require a native desktop coding agent.');
  const selectedAccount = accountById(state, task.accountId, task.provider);
  if (selectedAccount ? !selectedAccount.verified : !state.connections.includes(task.provider)) fail('Connect this agent account in Connections first.');
  if (cloud && selectedAccount) fail('Named accounts currently require the desktop app.');
  if (task.dependencies.some(id => state.tasks.find(t => t.id === id)?.status !== 'done')) fail('This task has an explicit prerequisite. Use Run settings to remove it if this section can work independently.');
  if (active.size >= 10) fail('Ten tasks are already running. Wait for one to finish.');
  const project = state.projects.find(p => p.id === task.projectId);
  let bin, cwd;
  if (task.provider !== 'gemini-image') {
    if (!project.directory && task.kind !== 'plan') fail('Connect a Git repository in Project settings before running coding agents.');
    bin = await executable(providers.find(p => p.id === task.provider)); if (!bin) fail('Agent CLI is unavailable.');
    // Every attempt receives its own worktree; retries never reuse partially edited files.
    const branch = `relay/${task.id.slice(0, 8)}-${Date.now()}`;
    cwd = path.join(dataDir(), 'worktrees', branch.replace('/', '-'));
    if (task.kind === 'plan') {
      await fs.mkdir(cwd, { recursive:true });
      await exec('git', ['-c', 'safe.directory=*', 'init', cwd]);
    } else if (cloud) {
      await exec('git', ['-c', 'safe.directory=*', 'clone', '--no-hardlinks', project.directory, cwd], { timeout: 30000 });
      await exec('git', ['-c', 'safe.directory=*', '-C', cwd, 'checkout', '-b', branch], { timeout: 5000 });
      await exec('git', ['-c', 'safe.directory=*', '-C', cwd, 'remote', 'remove', 'origin']);
    } else await exec('git', ['-c', 'safe.directory=*', '-C', project.directory, 'worktree', 'add', '-b', branch, cwd, 'HEAD'], { timeout: 30000 });
    task.worktree = cwd; task.branch = branch;
    if (task.kind !== 'plan') task.baseCommit = (await exec('git', ['-c', 'safe.directory=*', '-C', cwd, 'rev-parse', 'HEAD'])).stdout.trim();
    await prepareRunner(task.provider, cwd);
  }
  task.status = 'running'; task.startedAt = new Date().toISOString(); task.logs = []; task.error = null;
  event(`Started ${task.title}`, task.id, 'running');
  const handoffs = task.dependencies.map(id => { const t = state.tasks.find(t => t.id === id); return `${t.title}:\n${(t.logs || []).map(l => l.text).join('\n').slice(-8000)}`; }).join('\n\n');
  let prompt = task.planningPrompt || `Project: ${project.name}\nShared context: ${project.context || 'None'}\nTask: ${task.title}\nRole: ${task.category}\nInstructions: ${task.description}\n${handoffs ? `Prior task handoffs:\n${handoffs}\n` : ''}Complete only this task. Summarize results and checks. Do not merge branches or deploy. Ask for human review when done.`;
  if(task.kind==='orchestrate'){
    const sources=task.sourceTaskIds.map(id=>state.tasks.find(t=>t.id===id));
    if(sources.some(t=>!t||!['review','done'].includes(t.status)))fail('All source tasks must finish before orchestration.');
    prompt=await prepareIntegration(project,sources,task,dataDir());
  }
  const references=cwd?await stageContext(dataDir(),project,cwd):{prompt:'',cleanup:async()=>{}};
  if(task.dependencyMode==='advisory'&&task.kind!=='orchestrate')prompt+='\nWork independently on your assigned section now. If earlier instructions refer to another worker’s unfinished review or audit, inspect the repository and derive the findings you need yourself. You may edit your own checkout and run checks. State any cross-section assumptions in your handoff; the orchestrator will reconcile the combined result.';
  prompt+=references.prompt;
  if(task.computerUse)prompt+='\nComputer tools are available through syncfly-computer. The orchestrator reviews requests through these tools before each screenshot, click, keystroke, browser action, or change to PC files outside this checkout. Use read_file, list_folder, write_file, create_folder and move_path for approved PC file management. Never bypass a denial.';
  if (task.provider === 'gemini-image') {
    (task.kind === 'plan' ? generatePlan(task) : generateImage(task, `${task.title}\n${task.description}\nProject context: ${project.context || ''}`)).catch(e => { if (task.status !== 'cancelled') { task.status = 'failed'; task.error = redact(e.message); log(task, task.error); event(`Image generation failed: ${task.title}`, task.id, 'error'); } });
  } else {
    let env = await accountEnvironment(dataDir(), selectedAccount); delete env.GEMINI_API_KEY; delete env.GOOGLE_API_KEY; delete env.ANTHROPIC_API_KEY; delete env.OPENAI_API_KEY;
    const containerName = `relay-task-${task.id}-${Date.now()}`;
    task.approvalDenied=false;
    const approve=async details=>{
      if(task.status!=='running')return false;
      log(task,'Orchestrator reviewing: '+(details.reason||details.tool));
      try{
        const reviewer=await executable(providers.find(p=>p.id==='claude'));
        if(!reviewer||cloud)throw new Error('Claude Code approval reviewer requires a local Claude Code connection.');
        const account=accountById(state,project.orchestratorProvider==='claude'?project.orchestratorAccountId||'':'','claude');
        const reviewerEnv=await accountEnvironment(dataDir(),account);
        for(const key of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY'])delete reviewerEnv[key];
        const decision=await reviewPermission(reviewer,{cwd,env:reviewerEnv,project,task,details});
        const allowed=decision.approve&&task.status==='running';
        log(task,'Orchestrator '+(allowed?'approved':'denied')+': '+decision.reason);
        if(!allowed)task.approvalDenied=true;
        return allowed;
      }catch(e){task.approvalDenied=true;log(task,'Orchestrator could not approve: '+e.message);return false;}
    };
    const computer = cloud ? {args:agentArgs(task.provider,prompt,task.model,task.readOnly),env,cleanup:async()=>{}} : await setupComputer(context.getStore(),task,cwd,agentArgs(task.provider,prompt,task.model,task.readOnly),env,ROOT,PORT,approve);
    env=computer.env;
    const child = cloud ? spawnAgent(task.provider, agentArgs(task.provider, prompt, task.model, task.readOnly), cwd, containerName)
      : ['antigravity','cursor'].includes(task.provider)?spawnACP(bin,{cwd,env,provider:task.provider,prompt,model:task.model,readOnly:task.readOnly,approve,mcpServers:computer.mcpServers||[]})
      : task.provider==='claude'?spawnClaude(bin,{cwd,env,args:computer.args,prompt,approve})
      : spawn(bin.file, [...bin.args, ...computer.args], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    if (cloud) task.containerName = containerName; active.set(task.id, child);
    log(task, `Started ${task.provider} in isolated branch ${task.branch}. Claude Code orchestrator handles permission requests automatically.`);
    let buffer = ''; let reportedError = false; let needsPermission = false; let antigravityCompleted = false;
    const handleLine = line => {
      if (!line.trim()) return;
      if (task.provider === 'antigravity') {
        try {
          const parsed = antigravityEvent(JSON.parse(line));
          reportedError ||= parsed.failed; needsPermission ||= parsed.needsPermission; antigravityCompleted ||= parsed.complete;
          if(task.kind === 'plan') { try { task.plan = parsePlan(parsed.text); } catch {} }
          log(task, parsed.text);
        } catch { log(task, line); }
        return;
      }
      try {
        const e = JSON.parse(line);
        if (e.is_error || e.type === 'error' || e.type === 'turn.failed' || e.error) reportedError = true;
        if (e.permission_denials?.length){if(cloud)needsPermission=true;else log(task,'Some provider tools were restricted. Review the output for any incomplete checks.');}
        const content = e.message?.content;
        const text = e.result || e.item?.text || e.item?.aggregated_output || e.delta?.text || e.content || e.message?.text || e.error?.message || (Array.isArray(content) ? content.filter(c => c.type === 'text').map(c => c.text).join('\n') : '') || (e.type==='system'?(e.message||e.subtype||'Agent session initialized'):(e.type ? `[${e.type}]` : line));
        if (task.kind === 'plan' && typeof text === 'string') { try { task.plan = parsePlan(text); } catch {} }
        log(task, typeof text === 'string' ? text : JSON.stringify(text));
      } catch { log(task, line); }
    };
    child.stdout.on('data', chunk => {
      buffer += chunk.toString(); const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) handleLine(line);
    });
    let stderrTail = '';
    child.stderr.on('data', chunk => {
      const text = chunk.toString(); stderrTail = (stderrTail + text).slice(-4000);
      if(task.provider === 'antigravity' && /soft.denied|permission[^\n]*(?:denied|approval)|requires?[^\n]*approval/i.test(stderrTail)) needsPermission = true;
      log(task, text);
    });
    child.on('error', e => { task.status = 'failed'; task.error = e.message; log(task, e.message); });
    const timer = setTimeout(() => { stopTask(task); task.status = 'failed'; task.error = 'Run exceeded the 30-minute limit.'; persist(); }, 1800000);
    child.on('close', async code => {
      await computer.cleanup().catch(()=>{});
      await references.cleanup().catch(()=>{});
      clearTimeout(timer); active.delete(task.id); if (buffer.trim()) handleLine(buffer);
      if (task.provider === 'antigravity' && !antigravityCompleted) reportedError = true;
      if (task.status === 'cancelled' || task.status === 'failed') return;
      task.status = code === 0 && !reportedError && !needsPermission && !task.approvalDenied ? 'review' : 'failed';

      if (task.status === 'failed') task.error = taskFailure(task.logs,needsPermission ? 'An agent action needs approval. Check the orchestrator decision in the task log and retry.' : `Agent exited with ${code ?? 'a signal'} or reported an error. Review the log.`);
      if (task.kind === 'plan' && task.status === 'review') { try { if (!task.plan) task.plan = parsePlan(task.logs.map(l => l.text).join('\n')); } catch(e) { task.status = 'failed'; task.error = e.message; } }
      if(task.kind==='orchestrate'&&task.status==='review'){try{await checkIntegration(task);for(const id of task.sourceTaskIds){const source=state.tasks.find(t=>t.id===id);if(source)source.integratedBy=task.id;}}catch(e){task.status='failed';task.error='Integration needs attention: '+e.message;}}
      task.finishedAt = new Date().toISOString(); event(`${task.status === 'review' ? 'Ready for review' : 'Run failed'}: ${task.title}`, task.id, task.status === 'review' ? 'success' : 'error'); await persist(); if(task.kind!=='orchestrate')maybeOrchestrate(project).catch(e=>event('Orchestrator: '+e.message,null,'error'));
    });
  }
  await persist(); return task;
}
function stopTask(task) { revokeControls(task.id); const run = active.get(task.id); task.status = 'cancelled'; if (run instanceof AbortController) run.abort(); else if (run) { if (cloud && task.containerName) stopContainer(task.containerName); try { process.kill(-run.pid, 'SIGTERM'); } catch { run.kill('SIGTERM'); } } active.delete(task.id); event(`Stopped ${task.title}`, task.id); persist(); }
async function body(req, limit=100000) { let data = ''; for await (const chunk of req) { data += chunk; if (data.length > limit) fail('Request too large.', 413); } try { return data ? JSON.parse(data) : {}; } catch { fail('Invalid JSON.'); } }
function json(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function api(req, res, url) {
  if (req.method !== 'GET') {
    const csrf = context.getStore().csrf;
    const token = req.headers['x-relay-token'] || '';
    if (token.length !== csrf.length || !timingSafeEqual(Buffer.from(token), Buffer.from(csrf))) fail('Reload this local workspace to reconnect.', 403);
    const origin = req.headers.origin; if (origin && ![process.env.RELAY_PUBLIC_URL, `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`].includes(origin)) fail('This origin is not allowed.', 403);
  }
  if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, { ...state, providers: await inventory(), computerRequests: pendingControls(context.getStore().id), maxConcurrentTasks: 10, local: !cloud, execution: cloud ? 'docker' : 'native', user: { id: context.getStore().id, name: context.getStore().name }, csrf: context.getStore().csrf });
  const input = req.method === 'GET' ? {} : await body(req, /\/context$/.test(url.pathname)?36*1024*1024:100000);
  if(url.pathname==='/api/provider-accounts'&&req.method==='POST'){
    if(cloud)fail('Named provider accounts require the desktop app.');
    const account=createProviderAccount(state,input);await accountEnvironment(dataDir(),account);await persist();return json(res,201,account);
  }
  const profile=url.pathname.match(/^\/api\/provider-accounts\/([a-f0-9-]{36})\/(login|verify)$/);
  if(profile&&req.method==='POST'){
    const account=(state.providerAccounts||[]).find(a=>a.id===profile[1]);if(!account)fail('Account not found.',404);
    if(profile[2]==='verify'){await verify(account.provider,account.id);return json(res,200,{ok:true});}
    const cli=await executable(providers.find(p=>p.id===account.provider));if(!cli)fail('Install this provider’s official CLI first.');
    const instructions=await loginInstructions(dataDir(),account,cli);if(input.openTerminal)await openLoginTerminal(instructions.script);return json(res,200,{command:instructions.command});
  }
  if(url.pathname==='/api/github/status'&&req.method==='POST'){state.github=await githubStatus();await persist();return json(res,200,state.github);}
  if(url.pathname==='/api/github/login'&&req.method==='POST'){
    if(cloud)fail('Sign in to GitHub CLI on the deployment host.');
    const script=path.join(dataDir(),'github-login.ps1');await fs.writeFile(script,"& '"+(await ghExecutable()).replaceAll("'","''")+"' auth login --hostname github.com --git-protocol https --web\n");await openLoginTerminal(script);return json(res,200,{ok:true});
  }
  const contextMatch=url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})\/context(?:\/([a-f0-9-]{36}))?$/);
  if(contextMatch){
    const p=state.projects.find(p=>p.id===contextMatch[1]);if(!p)fail('Project not found.',404);
    const user=context.getStore();user.contextWrites ||= new Set();
    if(req.method==='GET'&&contextMatch[2]){const f=await readContext(dataDir(),p,contextMatch[2]);return json(res,200,{...f.file,base64:f.bytes.toString('base64')});}
    if(['POST','DELETE'].includes(req.method)){
      if(user.contextWrites.has(p.id))fail('Another upload is in progress. Retry shortly.',409);user.contextWrites.add(p.id);
      try{const result=req.method==='POST'?await uploadContext(dataDir(),p,input):await removeContext(dataDir(),p,contextMatch[2]);await persist();return json(res,200,result||{ok:true});}finally{user.contextWrites.delete(p.id);}
    }
  }
  const runReady=url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})\/run-ready$/);
  if(runReady&&req.method==='POST'){
    if(!state.projects.some(p=>p.id===runReady[1]))fail('Project not found.',404);
    const candidates=state.tasks.filter(t=>t.projectId===runReady[1]&&['queued','failed'].includes(t.status)&&!['orchestrate','plan'].includes(t.kind)&&t.dependencies.every(id=>state.tasks.find(d=>d.id===id)?.status==='done'));
    const results=await Promise.all(candidates.map(async t=>{try{await runTask(t);return {id:t.id,title:t.title,started:true};}catch(e){return {id:t.id,title:t.title,error:e.message};}}));
    return json(res,200,{results});
  }
  const orchestrate=url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})\/(orchestrate|github)$/);
  if(orchestrate&&req.method==='POST'){
    const project=state.projects.find(p=>p.id===orchestrate[1]);if(!project)fail('Project not found.',404);
    return json(res,200,orchestrate[2]==='github'?await repositoryInfo(project):await startOrchestrator(project,input));
  }
  const publish=url.pathname.match(/^\/api\/tasks\/([a-f0-9-]{36})\/publish$/);
  if(publish&&req.method==='POST'){
    const task=state.tasks.find(t=>t.id===publish[1]);if(!task||task.kind!=='orchestrate'||!['review','done'].includes(task.status))fail('Finish and review an orchestrator run before publishing.');
    const user=context.getStore();user.publishing ||= new Set();if(user.publishing.has(task.id))fail('Publishing is already in progress.');user.publishing.add(task.id);
    try{const result=await publishIntegration(state.projects.find(p=>p.id===task.projectId),task,input.mode);task.publishError=null;event('Published integration: '+task.title,task.id,'success');return json(res,200,result);}catch(e){task.publishError=e.message;fail('GitHub publishing failed: '+e.message);}finally{user.publishing.delete(task.id);await persist();}
  }
  const approval=url.pathname.match(/^\/api\/computer\/requests\/([a-f0-9-]{36})$/);
  if(approval&&req.method==='POST'){await decideControl(context.getStore().id,approval[1],input.approve===true);return json(res,200,{ok:true});}
  const revoke=url.pathname.match(/^\/api\/tasks\/([a-f0-9-]{36})\/revoke-computer$/);
  if(revoke&&req.method==='POST'){const task=state.tasks.find(t=>t.id===revoke[1]);if(!task)fail('Task not found.',404);revokeControls(task.id);task.computerUse=false;await persist();return json(res,200,{ok:true});}
  const login = url.pathname.match(/^\/api\/login\/(claude|codex|antigravity|cursor)(\/input)?$/);
  if (login) {
    if (!cloud) fail('Use the provider CLI in your local terminal.');
    const session = context.getStore().logins.get(login[1]);
    if (req.method === 'GET') return json(res, 200, session ? { output: session.output, running: session.running } : { output: '', running: false });
    if (login[2]) { if (!session?.running) fail('Start sign-in first.'); const code = clean(input.code, 2000); if (!code || /[\r\n]/.test(code)) fail('Enter one authorization code.'); session.child.stdin.write(code + '\n'); return json(res, 200, { ok: true }); }
    return json(res, 200, await loginStart(login[1]));
  }
  if (url.pathname === '/api/plan' && req.method === 'POST') {
    const objective = clean(input.objective); if (!objective) fail('Describe the project goal.');
    const valid = validateTask({ title: 'Plan: ' + objective.slice(0, 80), projectId: input.projectId, description: objective, provider: input.provider, accountId: input.accountId, model: input.model, category: 'Planning', readOnly: true }, state);
    const available = providers.filter(p => state.connections.includes(p.id)||(state.providerAccounts||[]).some(a=>a.provider===p.id&&a.verified));
    const prompt = 'You are the project lead. Divide the goal into 2 to 6 substantial, independently implementable work sections, not a chain of small steps. Examples: frontend, backend, data, testing, documentation. Each worker must read existing code, implement its own section, and test its changes. Define ownership boundaries and expected interfaces so workers can run simultaneously. Do not create a review-then-fix dependency or wait for another agent to produce findings: each worker investigates what its own section needs. The orchestrator combines their branches afterward and repairs integration issues. Use dependsOn: [] for every section; describe cross-section coordination as advisory notes only. Goal: ' + objective + '\nProject context: ' + state.projects.find(p => p.id === input.projectId).context + '\nAvailable agents: ' + JSON.stringify(available.map(p => ({ id: p.id, capabilities: p.capabilities }))) + '\nReturn ONLY a JSON object with tasks array. Each task: title, description, category, provider (one of the available IDs), priority (Low/Medium/High), dependsOn (array of zero-based indexes of earlier tasks). Assign image creation only to gemini-image. Tasks for gemini-image must be image generation, not coding or text. Assign suitable agents. No code changes or tool use needed.';
    const task = { ...valid, id: randomUUID(), status: 'queued', kind: 'plan', planningPrompt: prompt, dependencies: [], logs: [], createdAt: new Date().toISOString() };
    state.tasks.push(task); await persist(); try { await runTask(task); } catch(e) { task.status = 'failed'; task.error = e.message; await persist(); throw e; } return json(res, 200, task);
  }
  if (url.pathname === '/api/connections' && req.method === 'POST') {
    if (input.provider === 'gemini-image') {
      const key = clean(input.key, 300); if (!key) fail('Enter a Gemini API key.');
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) fail('Google could not validate this key. Check the key and API access.');
      keys.gemini = key; await fs.writeFile(path.join(dataDir(), 'secrets.json'), JSON.stringify(keys), { mode: 0o600 });
      if (!state.connections.includes('gemini-image')) state.connections.push('gemini-image'); event('Gemini Images API connected.');
    } else await verify(input.provider,input.accountId);
    await persist(); return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/connections' && req.method === 'DELETE') {
    if (state.tasks.some(t => t.provider === input.provider && t.status === 'running')) fail('Stop this agent’s running tasks before disconnecting.');
    state.connections = state.connections.filter(id => id !== input.provider);
    if (input.provider === 'gemini-image') { delete keys.gemini; await fs.writeFile(path.join(dataDir(), 'secrets.json'), JSON.stringify(keys), { mode: 0o600 }); }
    await persist(); return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/projects' && ['POST', 'PATCH'].includes(req.method)) {
    const name = clean(input.name, 120); if (!name) fail('Give your project a name.');
    let directory = cloud ? '' : clean(input.directory, 1000);
    const repository = clean(input.repository, 1000);
    const existing = state.projects.find(p => p.id === input.id);
    if (existing && repository === existing.repository && !directory) directory = existing.directory;
    if (repository && !directory) {
      let repoUrl; try { repoUrl = new URL(repository); } catch { fail('Enter a valid HTTPS Git repository URL.'); }
      if (repoUrl.protocol !== 'https:' || !['github.com','gitlab.com','bitbucket.org'].includes(repoUrl.hostname) || repoUrl.username || repoUrl.password || repoUrl.port || repoUrl.search || repoUrl.hash) fail('Use an HTTPS repository on GitHub, GitLab, or Bitbucket without embedded credentials. Private GitHub repositories use your connected GitHub account.');
      directory = path.join(dataDir(), 'repos', randomUUID()); await fs.mkdir(path.dirname(directory), { recursive: true });
      try { if(!cloud&&repoUrl.hostname==='github.com')await cloneGitHub(repository,directory);else await exec('git', ['-c', 'safe.directory=*', '-c', 'credential.helper=', '-c', 'http.followRedirects=false', 'clone', '--', repository, directory], { timeout: 90000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }); } catch { fail('Could not clone this repository. Check your GitHub connection and repository access. The repository needs at least one commit.'); }
    }
    if (directory) { if (!path.isAbsolute(directory)) fail('Use an absolute repository path.'); try { const result = await exec('git', ['-c', 'safe.directory=*', '-C', directory, 'rev-parse', '--show-toplevel'], { timeout: 5000 }); directory = result.stdout.trim(); await exec('git', ['-c', 'safe.directory=*', '-C', directory, 'rev-parse', 'HEAD'], { timeout: 5000 }); } catch { fail('Choose an existing Git repository with at least one commit. You may leave the path empty for planning and images.'); } }
    let project = state.projects.find(p => p.id === input.id);
    if (req.method === 'PATCH' && !project) fail('Project not found.', 404);
    const orchestratorProvider=['claude','codex','cursor','antigravity'].includes(input.orchestratorProvider)?input.orchestratorProvider:(project?.orchestratorProvider||'claude');
    accountById(state,input.orchestratorAccountId,orchestratorProvider);
    if (!project) { project = { id: randomUUID(), createdAt: new Date().toISOString() }; state.projects.push(project); }
    Object.assign(project, { name, directory, repository, context: clean(input.context), orchestratorProvider: ['claude','codex','cursor','antigravity'].includes(input.orchestratorProvider)?input.orchestratorProvider:(project.orchestratorProvider||'claude'), orchestratorAccountId: clean(input.orchestratorAccountId,80), autoOrchestrate: input.autoOrchestrate===true, githubBase: clean(input.githubBase,120) });
    accountById(state,project.orchestratorAccountId,project.orchestratorProvider); event(`Project saved: ${name}`); await persist(); return json(res, 200, project);
  }
  if (url.pathname === '/api/tasks' && req.method === 'POST') { const task = { ...validateTask(input, state), id: randomUUID(), status: 'queued', createdAt: new Date().toISOString(), logs: [] }; state.tasks.push(task); event(`Task created: ${task.title}`, task.id); await persist(); return json(res, 201, task); }
  const match = url.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)(?:\/(run|stop|approve|diff|accept-plan))?$/);
  if (match) {
    const task = state.tasks.find(t => t.id === match[1]); if (!task) fail('Task not found.', 404);
    if (req.method === 'POST' && match[2] === 'accept-plan') {
      if (task.kind !== 'plan' || task.status !== 'review' || !task.plan) fail('This plan is not ready for approval.');
      const ids = task.plan.map(() => randomUUID());
      const proposed = task.plan.map((p,i) => ({ ...validateTask({ ...p, accountId:p.accountId||(!state.connections.includes(p.provider)?(state.providerAccounts||[]).find(a=>a.provider===p.provider&&a.verified)?.id:''), projectId: task.projectId, dependencies: [] }, state), id: ids[i], dependencies: [], suggestedDependencies: (p.dependsOn || []).map(index => ids[index]), dependencyMode:'advisory', status: 'queued', logs: [], createdAt: new Date().toISOString() }));
      state.tasks.push(...proposed); task.status = 'done'; event(`Accepted plan: ${proposed.length} tasks created`, task.id, 'success'); await persist(); return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && match[2] === 'run') return json(res, 200, await runTask(task));
    if (req.method === 'POST' && match[2] === 'stop') { stopTask(task); return json(res, 200, task); }
    if (req.method === 'POST' && match[2] === 'approve') { if (task.status !== 'review') fail('Only completed runs can be approved.'); task.status = 'done'; event(`Approved: ${task.title}`, task.id, 'success'); await persist(); return json(res, 200, task); }
    if (req.method === 'PATCH' && !match[2]) { if (task.status === 'running') fail('Stop the task before editing.'); const updated = validateTask({ ...task, ...input }, state); if (updated.dependencies.includes(task.id)) fail('A task cannot depend on itself.'); const reaches = (id, visited = new Set()) => { if (id === task.id) return true; if (visited.has(id)) return false; visited.add(id); return (state.tasks.find(t => t.id === id)?.dependencies || []).some(d => reaches(d, visited)); }; if(updated.dependencies.some(id=>reaches(id))) fail('Dependencies cannot form a cycle.'); Object.assign(task, updated); await persist(); return json(res, 200, task); }
    if (req.method === 'GET' && match[2] === 'diff') { if (!task.worktree) return json(res, 200, { diff: 'No coding worktree for this task.' }); const { stdout } = await exec('git', ['-c', 'safe.directory=*', '-C', task.worktree, 'diff', task.baseCommit || 'HEAD'], { maxBuffer: 2e6 }); const files = await exec('git', ['-c', 'safe.directory=*', '-C', task.worktree, 'ls-files', '--others', '--exclude-standard']); return json(res, 200, { diff: stdout || 'No tracked-file changes.', untracked: files.stdout }); }
  }
  fail('Not found.', 404);
}
export async function start() {
  await initCloud();
  const server = http.createServer(async (req, res) => {
    try {
      const allowedHosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`, ...(process.env.RELAY_PUBLIC_URL ? [new URL(process.env.RELAY_PUBLIC_URL).host] : [])];
      if (!allowedHosts.includes(req.headers.host)) fail('Invalid host.', 403);
      const url = new URL(req.url, `http://${HOST}:${PORT}`);
      if(req.method==='POST'&&url.pathname==='/api/control/tool'){const input=await body(req);return json(res,200,await requestControl(req.headers['x-syncfly-control'],input.tool,input.args));}
      if (req.method === 'GET' && url.pathname === '/api/bootstrap') return json(res, 200, registrationInfo());
      if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/readyz')) { const ready = url.pathname === '/healthz' || await runnerAvailable(); return json(res, ready ? 200 : 503, { status: ready ? 'ok' : 'runner_unavailable' }); }
      if (url.pathname.startsWith('/api/auth/')) return await authRoute(req, res, url, body);
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/')) { const user = await authenticate(req); if (!user) fail('Sign in to access your workspace.', 401); if (url.pathname.startsWith('/api/')) return await context.run(user, () => api(req, res, url)); context.enterWith(user); }
      if (req.method !== 'GET' && req.method !== 'HEAD') fail('Method not allowed.', 405);
      let file;
      if (url.pathname.startsWith('/assets/')) { const name = url.pathname.slice(8); if (!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(name)) fail('Not found.', 404); file = path.join(dataDir(), 'assets', name); }
      else { const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); file = path.resolve(ROOT, 'dist', name); if (!file.startsWith(path.join(ROOT, 'dist') + path.sep)) fail('Not found.', 404); }
      const data = await fs.readFile(file); const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" }); res.end(data);
    } catch (e) { json(res, e.status || (e.code === 'ENOENT' ? 404 : 500), { error: redact(e.status ? e.message : e.code === 'ENOENT' ? 'Not found.' : 'The local service encountered an error. Check your configuration and try again.') }); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => { PORT = server.address().port; resolve(); });
  });
  console.log(`Syncfly workspace: http://${HOST}:${PORT}`);
  process.send?.({ type: 'ready', port: PORT });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start().catch(e => { console.error(e.message); process.exit(1); });
