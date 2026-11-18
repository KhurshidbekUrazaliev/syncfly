import readline from 'node:readline';
import { computerTools } from './computer-control.mjs';
const lines=readline.createInterface({input:process.stdin});
const send=(id,result,error)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,...(error?{error}:{result})})+'\n');
lines.on('line',async line=>{let r;try{r=JSON.parse(line);if(r.id===undefined)return;
 if(r.method==='initialize')return send(r.id,{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'syncfly-computer',version:'1.0.0'},instructions:'Every computer action requires separate user approval in Syncfly. Wait for approval; never try to bypass a denial.'});
 if(r.method==='ping')return send(r.id,{});
 if(r.method==='tools/list')return send(r.id,{tools:computerTools});
 if(r.method==='tools/call'){
  const response=await fetch(process.env.SYNCFLY_CONTROL_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Syncfly-Control':process.env.SYNCFLY_CONTROL_TOKEN},body:JSON.stringify({tool:r.params.name,args:r.params.arguments}),signal:AbortSignal.timeout(190000)});
  const result=await response.json();return send(r.id,response.ok?result:{isError:true,content:[{type:'text',text:result.error||'Computer request failed.'}]});
 }
 send(r.id,null,{code:-32601,message:'Unknown method'});
 }catch(e){if(r?.id!==undefined)send(r.id,null,{code:-32603,message:e.message});}});
