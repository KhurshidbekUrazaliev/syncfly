import { promises as fs } from 'node:fs';
import path from 'node:path';
import { controlSession, revokeControls } from './computer-control.mjs';
import { resolveNativeCLI } from './native-cli.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
export async function setupComputer(user,task,cwd,args,env,root,port,approve){
 if(!task.computerUse)return {args,env,cleanup:async()=>{}};
 if(process.platform!=='win32')throw Object.assign(new Error('Desktop computer control requires Windows.'),{status:400});
 const token=controlSession(user,task,approve);
 env={...env,SYNCFLY_CONTROL_TOKEN:token,SYNCFLY_CONTROL_URL:`http://127.0.0.1:${port}/api/control/tool`,ELECTRON_RUN_AS_NODE:'1'};
 const server={command:process.execPath,args:[path.join(root,'computer-mcp.mjs')],env:{ELECTRON_RUN_AS_NODE:'1'}};
 if(['antigravity','cursor'].includes(task.provider))return {args,env,mcpServers:[{name:'syncfly-computer',command:server.command,args:server.args,env:[{name:'ELECTRON_RUN_AS_NODE',value:'1'}]}],cleanup:async()=>revokeControls(task.id)};
 let cleanup=async()=>{revokeControls(task.id);};
 if(task.provider==='claude')args=[...args,'--mcp-config',JSON.stringify({mcpServers:{'syncfly-computer':server}}),'--allowedTools','mcp__syncfly-computer__*'];
 else if(task.provider==='codex')args=[...args,'-c',`mcp_servers.syncfly_computer.command=${JSON.stringify(server.command)}`,'-c',`mcp_servers.syncfly_computer.args=${JSON.stringify(server.args)}`,'-c','mcp_servers.syncfly_computer.env_vars=["SYNCFLY_CONTROL_TOKEN","SYNCFLY_CONTROL_URL","ELECTRON_RUN_AS_NODE"]','-c','mcp_servers.syncfly_computer.tool_timeout_sec=200'];
 else {
  const config=path.join(cwd,task.provider==='cursor'?'.cursor/mcp.json':'.agents/mcp_config.json');
  let original=null,parsed={};try{original=await fs.readFile(config,'utf8');parsed=JSON.parse(original);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(parsed.mcpServers?.['syncfly-computer'])throw new Error('This repository already defines a syncfly-computer MCP server. Rename it before enabling computer control.');
  await fs.mkdir(path.dirname(config),{recursive:true});
  await fs.writeFile(config,JSON.stringify({...parsed,mcpServers:{...parsed.mcpServers,'syncfly-computer':server}},null,2));
  cleanup=async()=>{revokeControls(task.id);if(original===null)await fs.rm(config,{force:true});else await fs.writeFile(config,original);};
  if(task.provider==='cursor'){
   const permissions=path.join(cwd,'.cursor/cli.json');let old=null,settings={};try{old=await fs.readFile(permissions,'utf8');settings=JSON.parse(old);}catch(e){if(e.code!=='ENOENT')throw e;}
   const priorCleanup=cleanup;cleanup=async()=>{await priorCleanup();if(old===null)await fs.rm(permissions,{force:true});else await fs.writeFile(permissions,old);};
   try{
    await fs.writeFile(permissions,JSON.stringify({...settings,permissions:{...settings.permissions,allow:[...(settings.permissions?.allow||[]),'Mcp(syncfly-computer:*)']}},null,2));
    const cli=await resolveNativeCLI(['agent','cursor-agent']);if(!cli)throw new Error('Cursor Agent is not installed.');
    await exec(cli.file,[...cli.args,'mcp','enable','syncfly-computer'],{cwd,env,windowsHide:true,timeout:20000});
   }catch(e){await cleanup();throw e;}
  }
 }
 return {args,env,cleanup};
}
