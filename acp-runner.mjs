import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import readline from 'node:readline';

// ACP keeps the process interactive so native permissions can be answered in Syncfly.
export function spawnACP(cli,{cwd,env,provider,prompt,model,readOnly=false,mcpServers=[],approve=async()=>false}){
 const args=provider==='cursor'?['--trust','acp']:['acp'];
 const processChild=spawn(cli.file,[...cli.args,...args],{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 const child=new EventEmitter();child.pid=processChild.pid;child.stdout=new PassThrough();child.stderr=processChild.stderr;child.kill=()=>processChild.kill();
 processChild.stdin.on('error',e=>{if(e.code!=='EPIPE')child.emit('error',e);});
 let serial=0,finished=false,closed=false,terminalCode=null,sessionId,denied=false,bufferedText='';const pending=new Map();
 const send=value=>{if(!processChild.stdin.destroyed)processChild.stdin.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');};
 const emit=(text,final=false,error=false)=>child.stdout.write(JSON.stringify(provider==='antigravity'?(final?{event:'result',result:{status:error?'FAILED':'SUCCESS',response:text}}:{event:'step_update',step_update:{text_delta:text}}):{type:final?'result':'item.completed',is_error:error,...(final?{result:text}:{item:{text}})})+'\n');
 const call=(method,params,timeout=60000)=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out.'));},timeout);pending.set(id,{resolve,reject,timer});send({id,method,params});});
 const finish=(code,message)=>{if(finished||closed)return;finished=true;terminalCode=code;if(bufferedText)emit(bufferedText);emit(message,true,!!code);processChild.kill();};
 processChild.on('error',e=>{child.emit('error',e);});
 processChild.on('close',code=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Agent process stopped.'));}pending.clear();child.stdout.end();child.emit('close',terminalCode??code??1);});
 readline.createInterface({input:processChild.stdout}).on('line',async line=>{
  let m;try{m=JSON.parse(line);}catch{emit(line);return;}
  if(m.id!==undefined&&!m.method){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message+(m.error.data?' '+JSON.stringify(m.error.data):''))):p.resolve(m.result);}return;}
  if(m.method==='session/request_permission'){
   const p=m.params,once=p.options?.find(o=>o.kind==='allow_once');
   let allowed=false;try{allowed=!!once&&await approve({reason:p.toolCall?.title||'Agent requests permission',cwd,toolCall:p.toolCall,options:p.options});}catch{}
   if(!allowed)denied=true;
   send({id:m.id,result:{outcome:allowed?{outcome:'selected',optionId:once.optionId}:{outcome:'cancelled'}}});return;
  }
  if(m.method==='session/update'){
   const u=m.params?.update||{};
   if(['agent_message_chunk','agent_thought_chunk'].includes(u.sessionUpdate)&&u.content?.text){bufferedText+=u.content.text;if(bufferedText.length>1000||bufferedText.includes('\n')){emit(bufferedText);bufferedText='';}}
   else if(['tool_call','tool_call_update'].includes(u.sessionUpdate)){const texts=(u.content||[]).map(c=>c.content?.text||c.text||(c.type==='diff'?`Edited ${c.path}`:'')).filter(Boolean);emit([u.title,u.status,...texts].filter(Boolean).join('\n'));}
   return;
  }
  if(m.id!==undefined)send({id:m.id,error:{code:-32601,message:'Client capability not supported'}});
 });
 queueMicrotask(async()=>{try{
  const init=await call('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'Syncfly',version:'0.2.1'}});
  if(init.protocolVersion!==1)throw new Error('Unsupported ACP protocol version '+init.protocolVersion);
  const session=await call('session/new',{cwd,mcpServers},90000);sessionId=session.sessionId;
  if(readOnly){const mode=session.modes?.availableModes?.find(m=>/plan|read.only/i.test(m.id+' '+m.name));if(!mode)throw new Error('This agent does not expose a read-only mode. Use a coding task or another provider.');await call('session/set_mode',{sessionId,modeId:mode.id});}
  if(model)await call('session/set_model',{sessionId,modelId:model});
  const result=await call('session/prompt',{sessionId,prompt:[{type:'text',text:prompt}]},1800000);
  const failed=denied||!['end_turn','stop_sequence'].includes(result.stopReason);finish(failed?1:0,failed?(denied?'An agent action was denied or its approval expired.':'Agent stopped: '+result.stopReason):'Agent turn completed.');
 }catch(e){finish(1,e.message);}});
 return child;
}
