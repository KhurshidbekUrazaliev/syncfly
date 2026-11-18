import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import readline from 'node:readline';
export function spawnClaude(cli,{cwd,env,args,prompt,approve=async()=>false}){
 const parameters=[...args];const at=parameters.indexOf('-p');if(at>=0&&parameters[at+1]===prompt)parameters.splice(at+1,1);
 parameters.push('--input-format','stream-json','--permission-prompt-tool','stdio');
 const proc=spawn(cli.file,[...cli.args,...parameters],{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 const child=new EventEmitter();child.pid=proc.pid;child.stdout=new PassThrough();child.stderr=proc.stderr;child.kill=()=>proc.kill();
 proc.stdin.on('error',e=>{if(e.code!=='EPIPE')child.emit('error',e);});
 const send=m=>{if(!proc.stdin.destroyed)proc.stdin.write(JSON.stringify(m)+'\n');};
 proc.on('error',e=>child.emit('error',e));proc.on('close',code=>{child.stdout.end();child.emit('close',code);});
 readline.createInterface({input:proc.stdout}).on('line',async line=>{
  let e;try{e=JSON.parse(line);}catch{child.stdout.write(line+'\n');return;}
  if(e.type==='control_request'){
   const r=e.request;let allowed=false;try{if(r?.subtype==='can_use_tool')allowed=await approve({reason:'Claude requests '+r.tool_name,cwd,tool:r.tool_name,input:r.input});}catch{}
   send({type:'control_response',response:{subtype:'success',request_id:e.request_id,response:allowed?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Not approved by the user.'}}});return;
  }
  child.stdout.write(line+'\n');if(e.type==='result')proc.stdin.end();
 });
 proc.once('spawn',()=>send({type:'user',message:{role:'user',content:prompt},parent_tool_use_id:null,session_id:''}));
 return child;
}
