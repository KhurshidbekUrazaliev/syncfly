import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export const context = new AsyncLocalStorage();
export const cloud = process.env.RELAY_EXECUTION !== 'native';
export const ROOT_DATA = path.resolve(process.env.RELAY_DATA_DIR || '.runtime');
const users = new Map();
export function activeTaskCount(workspaces = users.values()) {
  let count = 0;
  for (const user of workspaces) count += new Set([...user.active.keys(), ...(user.starting || [])]).size;
  return count;
}
const sessions = new Map();
const buckets = new Map();
let accounts = [];
let authWrites = Promise.resolve();
export function dataDir() { const user = context.getStore(); if (!user) throw new Error('No authenticated workspace'); return user.directory; }
export const state = new Proxy({}, { get:(_,k)=>context.getStore()?.state[k], set:(_,k,v)=>(context.getStore().state[k]=v,true), ownKeys:()=>Reflect.ownKeys(context.getStore().state), getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true}) });
export const keys = new Proxy({}, { get:(_,k)=>context.getStore()?.keys[k], set:(_,k,v)=>(context.getStore().keys[k]=v,true), deleteProperty:(_,k)=>delete context.getStore().keys[k], ownKeys:()=>Reflect.ownKeys(context.getStore().keys), getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true}) });
export const active = new Proxy(new Map(), { get:(_,k)=>{ const map=context.getStore()?.active;return typeof map?.[k]==='function'?map[k].bind(map):map?.[k];} });
export async function initCloud(){await fs.mkdir(ROOT_DATA,{recursive:true,mode:0o700});try{accounts=JSON.parse(await fs.readFile(path.join(ROOT_DATA,'accounts.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
async function registerAccount(input, email, password) {
 const operation = authWrites.then(async () => {
  if (process.env.RELAY_ALLOW_SIGNUP === 'false' && accounts.length) throw Object.assign(new Error('Registration is closed. Sign in, or ask the owner to open invitations.'), {status:403});
  if (accounts.some(a => a.email === email)) throw Object.assign(new Error('This email is already registered. Sign in instead.'), {status:409});
  const salt=randomBytes(16).toString('hex');
  const account={id:randomUUID(),email,name:String(input.name||'My workspace').trim().slice(0,80),salt,hash:scryptSync(password,salt,64).toString('hex')};
  const updated=[...accounts,account];
  await fs.writeFile(path.join(ROOT_DATA,'accounts.tmp'),JSON.stringify(updated),{mode:0o600});
  await fs.rename(path.join(ROOT_DATA,'accounts.tmp'),path.join(ROOT_DATA,'accounts.json'));
  accounts=updated;
  return account;
 });
 authWrites=operation.catch(()=>{});
 return operation;
}
async function loadUser(account){if(users.has(account.id))return users.get(account.id);const directory=path.join(ROOT_DATA,'users',account.id);await fs.mkdir(path.join(directory,'assets'),{recursive:true,mode:0o700});await fs.mkdir(path.join(directory,'worktrees'),{recursive:true});await fs.mkdir(path.join(directory,'auth'),{recursive:true,mode:0o700});let state={projects:[],tasks:[],events:[],assets:[],connections:[]},keys={};try{state=JSON.parse(await fs.readFile(path.join(directory,'state.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}try{keys=JSON.parse(await fs.readFile(path.join(directory,'secrets.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}for(const t of state.tasks)if(t.status==='running'){t.status='failed';t.error='Server restarted. Review the previous work before retrying.';}
 const u={id:account.id,name:account.name,directory,state,keys,active:new Map(),logins:new Map(),csrf:randomBytes(32).toString('hex')};users.set(account.id,u);return u;}
function cookie(req){return req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('relay_session='))?.slice(14);}
export async function authenticate(req){const token=cookie(req),session=sessions.get(token);if(!session||session.expires<Date.now()){if(token)sessions.delete(token);return null;}const a=accounts.find(a=>a.id===session.userId);return a?loadUser(a):null;}
export async function authRoute(req,res,url,body){
 const origin=req.headers.origin;const expected=new URL(process.env.RELAY_PUBLIC_URL||`http://${req.headers.host}`).origin;
 const respond=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 const local=new URL(expected);
 const allowed=[expected];
 if(local.protocol==='http:'&&['localhost','127.0.0.1'].includes(local.hostname)) allowed.push(`http://${local.hostname==='localhost'?'127.0.0.1':'localhost'}${local.port?':'+local.port:''}`);
 if(origin&&!allowed.includes(origin))return respond(403,{error:'Open Syncfly at its configured address: '+expected});
 if(req.method==='GET'&&url.pathname==='/api/auth/config')return respond(200,{needsSetup:accounts.length===0,registrationOpen:accounts.length===0||process.env.RELAY_ALLOW_SIGNUP!=='false',invitationRequired:Boolean(process.env.RELAY_INVITE_CODE)});
 if(req.method!=='POST')return respond(405,{error:'Method not allowed.'});
 if(url.pathname==='/api/auth/logout'){sessions.delete(cookie(req));res.setHeader('Set-Cookie','relay_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return respond(200,{ok:true});}
 if(!['/api/auth/login','/api/auth/register'].includes(url.pathname))return respond(404,{error:'Not found.'});
 const ip=req.socket.remoteAddress;const bucket=buckets.get(ip)||{count:0,at:Date.now()};if(Date.now()-bucket.at>60000){bucket.count=0;bucket.at=Date.now();}bucket.count++;buckets.set(ip,bucket);if(bucket.count>20)return respond(429,{error:'Too many sign-in attempts. Try again in a minute.'});
 const input=await body(req);const email=String(input.email||'').trim().toLowerCase();const password=String(input.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12||password.length>256)return respond(400,{error:'Use a valid email and a password of 12–256 characters.'});
 let a=accounts.find(a=>a.email===email);
 if(url.pathname.endsWith('register')){
   const invitation = process.env.RELAY_INVITE_CODE;
   if (invitation) { const supplied = Buffer.from(String(input.invitation || '')); const expected = Buffer.from(invitation); if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return respond(403,{error:'A valid invitation code is required to create an account.'}); }
   try { a=await registerAccount(input,email,password); } catch(e) { if(e.status)return respond(e.status,{error:e.message});throw e; }
 }else{const computed=scryptSync(password,a?.salt||'dummy-salt',64);if(!a||!timingSafeEqual(computed,Buffer.from(a.hash,'hex')))return respond(401,{error:'Email or password is incorrect.'});}
 const token=randomBytes(32).toString('hex');sessions.set(token,{userId:a.id,expires:Date.now()+86400000});const secure=expected.startsWith('https:')?'; Secure':'';res.setHeader('Set-Cookie',`relay_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure}`);return respond(200,{ok:true});
}
export async function runnerAvailable(){if(!cloud)return true;try{await exec('docker',['image','inspect','--format','{{.Id}}',process.env.RELAY_RUNNER_IMAGE||'relay-runner:latest'],{timeout:5000,maxBuffer:2000});return true;}catch{return false;}}
function hostPath(p){const hostRoot=process.env.RELAY_HOST_DATA_DIR;if(!hostRoot)throw new Error('RELAY_HOST_DATA_DIR must be the absolute host data path.');const relative=path.relative(ROOT_DATA,p);if(relative.startsWith('..'))throw new Error('Invalid workspace mount.');return path.join(hostRoot,relative);}
export function containerArgs(provider,cwd,{interactive=false,name}={}){
 const user=context.getStore();const auth=path.join(user.directory,'auth',provider); // Directory is prepared by prepareRunner.
 const args=['run','--rm','--init','--name',name||`relay-${randomUUID()}`,'--label','relay.managed=true','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory','2g','--cpus','2','--user','1000:1000','--read-only','--tmpfs','/tmp:rw,nosuid,size=512m','-e','HOME=/home/agent','-e','TERM=dumb','--mount',`type=bind,src=${hostPath(auth)},dst=/home/agent`];
 if(cwd)args.push('--mount',`type=bind,src=${hostPath(cwd)},dst=/workspace`,'-w','/workspace');
 else args.push('--tmpfs','/workspace:rw,uid=1000,gid=1000,size=128m','-w','/workspace');
 if(interactive)args.push('-i');args.push(process.env.RELAY_RUNNER_IMAGE||'relay-runner:latest');return args;
}
export async function prepareRunner(provider,cwd){if(!cloud)return;const auth=path.join(dataDir(),'auth',provider);await fs.mkdir(auth,{recursive:true,mode:0o700});await fs.chown(auth,1000,1000);if(cwd)await exec('chown',['-R','1000:1000',cwd]);}
export function spawnAgent(provider,args,cwd,name){if(!cloud)return null;return spawn('docker',[...containerArgs(provider,cwd,{name}),provider==='cursor'?'agent':provider,...args],{stdio:['ignore','pipe','pipe']});}
export async function execAgent(provider,args){await prepareRunner(provider);return exec('docker',[...containerArgs(provider),provider==='cursor'?'agent':provider,...args],{timeout:20000,maxBuffer:100000});}
export async function loginStart(id){const user=context.getStore();if(user.logins.get(id)?.running)throw new Error('Sign-in is already running.');await prepareRunner(id);const commands={claude:'claude auth login',codex:'codex login --device-auth',gemini:'gemini',cursor:'agent login'};if(!commands[id])throw new Error('Unsupported provider.');const name=`relay-login-${randomUUID()}`;const args=containerArgs(id,null,{interactive:true,name});args.push('script','-q','-c',commands[id],'/dev/null');const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});const login={child,name,output:'',running:true};user.logins.set(id,login);const append=b=>{login.output=(login.output+b.toString().replace(/\x1b\[[0-9;?]*[a-zA-Z]/g,'')).slice(-18000);};child.stdout.on('data',append);child.stderr.on('data',append);child.on('error',e=>{append(e.message);login.running=false;});child.on('close',()=>{login.running=false;clearTimeout(timer);});const timer=setTimeout(()=>{exec('docker',['stop','-t','2',name]).catch(()=>{});login.running=false;},600000);return {ok:true};}
export async function stopContainer(name){if(name)await exec('docker',['stop','-t','3',name],{timeout:10000}).catch(()=>{});}
