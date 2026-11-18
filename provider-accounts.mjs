import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
export const profileProviders=['claude','codex','cursor'];
const variables={claude:'CLAUDE_CONFIG_DIR',codex:'CODEX_HOME',cursor:'CURSOR_CONFIG_DIR'};
export function accountById(state,id,provider){
 if(!id)return null;
 const a=(state.providerAccounts||[]).find(a=>a.id===id&&a.provider===provider);
 if(!a)throw Object.assign(new Error('Choose an account belonging to this provider.'),{status:400});
 return a;
}
export function profileDirectory(root,account){
 if(!/^[a-f0-9-]{36}$/.test(account.id)||!profileProviders.includes(account.provider))throw new Error('Invalid account profile.');
 return path.join(root,'provider-accounts',account.id);
}
export async function accountEnvironment(root,account,base=process.env){
 const env={...base};
 env.NODE_USE_SYSTEM_CA ||= '1';
 // A child agent is not a Codex desktop task. Inherited host pipe/sandbox IDs break its launcher.
 for(const key of Object.keys(env))if((key.startsWith('CODEX_')&&!['CODEX_HOME','CODEX_API_KEY'].includes(key))||key.startsWith('BROWSER_USE_ACCESS_')||key==='CLAUDECODE')delete env[key];
 if(!account)return env;
 const dir=profileDirectory(root,account);await fs.mkdir(dir,{recursive:true,mode:0o700});
 for(const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','OPENAI_API_KEY','CODEX_API_KEY','CURSOR_API_KEY'])delete env[key];
 env[variables[account.provider]]=dir;
 if(account.provider==='codex')await fs.writeFile(path.join(dir,'config.toml'),'cli_auth_credentials_store = "file"\n',{flag:'wx',mode:0o600}).catch(e=>{if(e.code!=='EEXIST')throw e;});
 return env;
}
export function createProviderAccount(state,input){
 if(!profileProviders.includes(input.provider))throw Object.assign(new Error('Separate account profiles are supported for Claude Code, Codex, and Cursor.'),{status:400});
 const name=String(input.name||'').trim().slice(0,80);if(!name)throw Object.assign(new Error('Name this account, for example Claude Max or Codex Work.'),{status:400});
 const account={id:randomUUID(),provider:input.provider,name,verified:false,createdAt:new Date().toISOString()};
 (state.providerAccounts ||= []).push(account);return account;
}
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export async function loginInstructions(root,account,cli){
 const env=await accountEnvironment(root,account);
 const args=account.provider==='claude'?['auth','login','--claudeai']:['login'];
 const command=`$env:ELECTRON_RUN_AS_NODE = '1'\n`+['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','OPENAI_API_KEY','CODEX_API_KEY','CURSOR_API_KEY'].map(key=>`Remove-Item Env:${key} -ErrorAction SilentlyContinue`).join('\n')+`\n$env:${variables[account.provider]} = ${quote(env[variables[account.provider]])}\n& ${[cli.file,...cli.args,...args].map(quote).join(' ')}`;
 const script=path.join(profileDirectory(root,account),'sign-in.ps1');
 await fs.writeFile(script,"$ErrorActionPreference = 'Stop'\n"+command+'\n',{mode:0o600});
 return {command,script};
}
export async function openLoginTerminal(script){
 if(process.platform!=='win32')throw Object.assign(new Error('Copy the sign-in command into your terminal.'),{status:400});
 const code=`Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-NoExit','-ExecutionPolicy','Bypass','-File',${quote('"'+script+'"')}) -WindowStyle Normal`;
 await exec('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,timeout:10000});
}
