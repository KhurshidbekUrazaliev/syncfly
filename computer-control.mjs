import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
const exec=promisify(execFile);
const sessions=new Map(), requests=new Map();
let desktopBusy=false;
export const computerTools=[
 ...['read_file','list_folder','write_file','create_folder','move_path'].map(name=>({name,description:'Request orchestrator approval to '+name.replaceAll('_',' ')+'. Use absolute PC paths. Overwriting an existing file requires its SHA-256 from read_file. No action runs before approval.',inputSchema:{type:'object',properties:{path:{type:'string'},destination:{type:'string'},text:{type:'string'},expectedSha256:{type:'string'},reason:{type:'string'}},required:['path','reason']}})),
 {name:'screenshot',description:'Request orchestrator approval to capture the desktop. Returns a PNG screenshot.',inputSchema:{type:'object',properties:{reason:{type:'string'}},required:['reason']}},
 {name:'click',description:'Request approval to click a screen coordinate.',inputSchema:{type:'object',properties:{x:{type:'integer'},y:{type:'integer'},button:{enum:['left','right']},reason:{type:'string'}},required:['x','y','reason']}},
 {name:'type_text',description:'Request approval to type literal text into the focused application.',inputSchema:{type:'object',properties:{text:{type:'string'},reason:{type:'string'}},required:['text','reason']}},
 {name:'press_key',description:'Request approval to press a key or shortcut.',inputSchema:{type:'object',properties:{key:{enum:['ENTER','TAB','ESC','BACKSPACE','DELETE','UP','DOWN','LEFT','RIGHT','CTRL+L','CTRL+A','CTRL+C','CTRL+V','CTRL+T','CTRL+W','ALT+TAB']},reason:{type:'string'}},required:['key','reason']}},
 {name:'scroll',description:'Request approval to scroll the focused application.',inputSchema:{type:'object',properties:{amount:{type:'integer',minimum:-10,maximum:10},reason:{type:'string'}},required:['amount','reason']}},
 {name:'open_browser',description:'Request approval to open an HTTP(S) URL in Chrome.',inputSchema:{type:'object',properties:{url:{type:'string'},reason:{type:'string'}},required:['url','reason']}},
];
export function controlSession(user,task,approve){const token=randomBytes(32).toString('hex');sessions.set(token,{userId:user.id,taskId:task.id,title:task.title,provider:task.provider,approve,active:true});return token;}
export function pendingControls(userId){return [...requests.values()].filter(r=>r.userId===userId&&r.status==='pending'&&!r.approve).map(({id,taskId,title,provider,tool,args,createdAt,native})=>({id,taskId,title,provider,tool,args,createdAt,native}));}
export function requestNativeApproval(user,task,details){
 return new Promise(resolve=>{
  const id=randomUUID();const r={id,userId:user.id,taskId:task.id,title:task.title,provider:task.provider,tool:'Agent permission',args:details,native:true,status:'pending',createdAt:new Date().toISOString(),resolve:result=>{clearTimeout(r.timer);requests.delete(id);resolve(result?.allowed===true);}};
  r.timer=setTimeout(()=>r.resolve({allowed:false}),300000);requests.set(id,r);
 });
}
export function revokeControls(taskId){for(const s of sessions.values())if(s.taskId===taskId)s.active=false;for(const r of requests.values())if(r.taskId===taskId&&r.status==='pending'){r.status='denied';r.resolve({isError:true,content:[{type:'text',text:'Computer access was revoked.'}]});}}
export function requestControl(token,tool,args){
 const s=sessions.get(token);if(!s?.active)throw Object.assign(new Error('Computer access is not enabled for this run.'),{status:403});
 if(!computerTools.some(t=>t.name===tool)||!args||typeof args.reason!=='string'||args.reason.length>1000)throw Object.assign(new Error('Provide a valid computer action and reason.'),{status:400});
 if([...requests.values()].some(r=>r.taskId===s.taskId&&r.status==='pending'))throw Object.assign(new Error('Wait for the pending approval.'),{status:409});
 if(JSON.stringify(args).length>12000)throw Object.assign(new Error('Computer request is too large.'),{status:400});
 return new Promise(resolve=>{
  const id=randomUUID();const r={...s,id,tool,args,status:'pending',createdAt:new Date().toISOString(),resolve:result=>{clearTimeout(r.timer);requests.delete(id);resolve(result);}};
  r.timer=setTimeout(()=>{r.status='expired';r.resolve({isError:true,content:[{type:'text',text:'Approval expired. No computer action was performed.'}]});},180000);
  requests.set(id,r);
  if(s.approve)Promise.resolve().then(()=>s.approve({tool,input:args,reason:args.reason})).then(async allowed=>{while(desktopBusy&&r.status==='pending')await new Promise(resolve=>setTimeout(resolve,25));if(r.status==='pending'&&requests.has(id))await decideControl(s.userId,id,allowed&&s.active);}).catch(e=>{if(requests.has(id))r.resolve({isError:true,content:[{type:'text',text:'Orchestrator approval failed: '+e.message}]});});
 });
}
export async function decideControl(userId,id,approve,executor=executeComputer){
 const r=requests.get(id);if(!r||r.userId!==userId||r.status!=='pending')throw Object.assign(new Error('Approval request is no longer available.'),{status:404});
 if(!approve){r.status='denied';r.resolve({isError:true,content:[{type:'text',text:'The approval reviewer denied this action.'}]});return;}
 if(r.native){r.status='approved';r.resolve({allowed:true});return;}
 if(desktopBusy)throw Object.assign(new Error('Another approved action is using the desktop. Try again shortly.'),{status:409});
 r.status='executing';clearTimeout(r.timer);desktopBusy=true;
 try{r.resolve(await executor(r.tool,r.args));}catch(e){r.resolve({isError:true,content:[{type:'text',text:e.message}]});}finally{desktopBusy=false;}
}
const psquote=s=>"'"+String(s).replaceAll("'","''")+"'";
export async function executeComputer(tool,args){
 if(['read_file','list_folder','write_file','create_folder','move_path'].includes(tool))return executeFileAction(tool,args);
 if(process.platform!=='win32')throw new Error('Computer control requires Windows.');
 const source=`using System; using System.Runtime.InteropServices; public class SyncflyInput { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,int d,UIntPtr e); }`;
 let code=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; Add-Type -TypeDefinition ${psquote(source)}; `;
 if(tool==='screenshot')code+=`$r=[System.Windows.Forms.SystemInformation]::VirtualScreen; $b=New-Object Drawing.Bitmap $r.Width,$r.Height; $g=[Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($r.Left,$r.Top,0,0,$b.Size); $m=New-Object IO.MemoryStream; $b.Save($m,[Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($m.ToArray()); $g.Dispose(); $b.Dispose(); $m.Dispose();`;
 else if(tool==='click'){
  if(!Number.isInteger(args.x)||!Number.isInteger(args.y)||Math.abs(args.x)>32768||Math.abs(args.y)>32768||!['left','right',undefined].includes(args.button))throw new Error('Invalid click coordinates or button.');
  const down=args.button==='right'?8:2,up=args.button==='right'?16:4;
  code+=`[SyncflyInput]::SetCursorPos(${args.x},${args.y})|Out-Null; [SyncflyInput]::mouse_event(${down},0,0,0,[UIntPtr]::Zero); [SyncflyInput]::mouse_event(${up},0,0,0,[UIntPtr]::Zero);`;
 }else if(tool==='type_text'){
  if(typeof args.text!=='string'||args.text.length>8000)throw new Error('Text is too long.');
  const escaped=args.text.replace(/[+^%~()\[\]{}]/g,c=>'{'+c+'}').replace(/\r?\n/g,'{ENTER}');
  code+=`[System.Windows.Forms.SendKeys]::SendWait(${psquote(escaped)});`;
 }else if(tool==='press_key'){
  const keys={ENTER:'{ENTER}',TAB:'{TAB}',ESC:'{ESC}',BACKSPACE:'{BACKSPACE}',DELETE:'{DELETE}',UP:'{UP}',DOWN:'{DOWN}',LEFT:'{LEFT}',RIGHT:'{RIGHT}','CTRL+L':'^l','CTRL+A':'^a','CTRL+C':'^c','CTRL+V':'^v','CTRL+T':'^t','CTRL+W':'^w','ALT+TAB':'%{TAB}'};
  if(!keys[args.key])throw new Error('Unsupported key.');code+=`[System.Windows.Forms.SendKeys]::SendWait(${psquote(keys[args.key])});`;
 }else if(tool==='scroll'){
  if(!Number.isInteger(args.amount)||Math.abs(args.amount)>10)throw new Error('Invalid scroll amount.');code+=`[SyncflyInput]::mouse_event(2048,0,0,${args.amount*120},[UIntPtr]::Zero);`;
 }else if(tool==='open_browser'){
  const url=new URL(args.url);if(!['https:','http:'].includes(url.protocol))throw new Error('Only HTTP(S) URLs are supported.');
  const candidates=[path.join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env.LOCALAPPDATA||'','Google/Chrome/Application/chrome.exe')];
  let chrome;for(const file of candidates)try{await fs.access(file);chrome=file;break;}catch{}
  if(!chrome)throw new Error('Google Chrome is not installed.');
  code+=`Start-Process -FilePath ${psquote(chrome)} -ArgumentList @(${psquote(url.href)}) -WindowStyle Normal;`;
 }else throw new Error('Unsupported computer action.');
 const {stdout}=await exec('powershell.exe',['-NoProfile','-STA','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,timeout:20000,maxBuffer:20e6});
 return {content:tool==='screenshot'?[{type:'image',mimeType:'image/png',data:stdout.trim()}]:[{type:'text',text:'Approved action completed.'}]};
}
export async function executeFileAction(tool,args){
 if(typeof args.path!=='string'||!path.isAbsolute(args.path))throw new Error('An absolute PC path is required.');
 const target=path.resolve(args.path);let result;
 if(tool==='read_file'){
  const stat=await fs.stat(target);if(stat.size>1024*1024)throw new Error('Read files up to 1 MB using this tool.');
  const bytes=await fs.readFile(target);result={path:target,text:bytes.toString('utf8'),sha256:createHash('sha256').update(bytes).digest('hex')};
 }else if(tool==='list_folder'){const entries=await fs.readdir(target,{withFileTypes:true});result=entries.slice(0,500).map(e=>({name:e.name,folder:e.isDirectory()}));}
 else if(tool==='create_folder'){await fs.mkdir(target,{recursive:true});result='Folder created.';}
 else if(tool==='write_file'){
  if(typeof args.text!=='string'||args.text.length>8000)throw new Error('Provide up to 8,000 characters of text.');
  let existing;try{existing=await fs.readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(existing&&createHash('sha256').update(existing).digest('hex')!==args.expectedSha256)throw new Error('Read the existing file first and provide its current SHA-256 before requesting an overwrite.');
  await fs.writeFile(target,args.text,{flag:existing?'w':'wx'});result='File saved.';
 }else if(tool==='move_path'){
  if(typeof args.destination!=='string'||!path.isAbsolute(args.destination))throw new Error('An absolute destination is required.');
  try{await fs.lstat(args.destination);throw new Error('Destination already exists.');}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.rename(target,args.destination);result='Path moved.';
 }else throw new Error('Unsupported file action.');
 return {content:[{type:'text',text:JSON.stringify(result)}]};
}
