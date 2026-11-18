import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { git, commitIntegration } from './integration.mjs';
const exec=promisify(execFile);
export async function ghExecutable(){if(process.platform==='win32'){for(const dir of (process.env.PATH||'').split(path.delimiter).concat(['C:/Program Files/GitHub CLI'])){const file=path.join(dir.replace(/^"|"$/g,''),'gh.exe');try{await fs.access(file);return file;}catch{}}}return 'gh';}
const gh=async(args,options={})=>(await exec(await ghExecutable(),args,{timeout:60000,maxBuffer:2e6,windowsHide:true,...options})).stdout.trim();
export async function githubStatus(){try{return {connected:true,login:await gh(['api','user','--jq','.login'])};}catch{return {connected:false,message:'Install GitHub CLI and run gh auth login in PowerShell.'};}}
export function repoSlug(value){const match=String(value||'').match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);if(!match)throw Object.assign(new Error('Connect a GitHub repository URL in Project settings.'),{status:400});return match[1];}
export async function repositoryInfo(project){
 const remote=project.repository||await git(project.directory,['remote','get-url','origin']);
 const slug=repoSlug(remote);
 const info=JSON.parse(await gh(['repo','view',slug,'--json','nameWithOwner,defaultBranchRef,viewerPermission,url']));
 return {...info,slug};
}
export async function cloneGitHub(repository,directory){const slug=repoSlug(repository);await gh(['repo','clone',slug,directory]);}
export async function publishIntegration(project,task,mode){
 if(!['push','pr','merge'].includes(mode))throw Object.assign(new Error('Choose Push, Create PR, or Merge PR.'),{status:400});
 const info=await repositoryInfo(project);
 const head=await commitIntegration(task);task.commit=head;
 const remote='https://github.com/'+info.slug+'.git';
 // Use gh's credential helper for this command, without changing global Git configuration.
 const helper=(await ghExecutable()).replaceAll('\\','/').replaceAll("'","'\\''");
 await git(task.worktree,['-c','credential.helper=','-c',`credential.helper=!'${helper}' auth git-credential`,'push',remote,`HEAD:refs/heads/${task.branch}`]);
 task.pushed=true;
 if(mode==='push')return {commit:head,branch:task.branch};
 const base=project.githubBase||info.defaultBranchRef?.name;if(!base)throw new Error('Choose a GitHub base branch.');
 if(!task.pullRequest){
  const found=JSON.parse(await gh(['pr','list','--repo',info.slug,'--head',task.branch,'--base',base,'--state','open','--json','url']));
  if(found.length)task.pullRequest=found[0].url;
  else{
   const bodyFile=path.join(path.dirname(task.worktree),task.id+'-pr.txt');
   await fs.writeFile(bodyFile,`Combined work reviewed by ${task.provider}.\n\n`+(task.logs||[]).map(l=>l.text).join('\n').slice(-12000));
   try{task.pullRequest=await gh(['pr','create','--repo',info.slug,'--head',task.branch,'--base',base,'--title',task.title,'--body-file',bodyFile]);}finally{await fs.rm(bodyFile,{force:true});}
  }
 }
 if(mode==='merge'){
  await gh(['pr','merge',task.pullRequest,'--repo',info.slug,'--squash','--match-head-commit',head]);
  const pr=JSON.parse(await gh(['pr','view',task.pullRequest,'--repo',info.slug,'--json','state']));
  task.merged=pr.state==='MERGED';
  if(!task.merged)throw new Error('GitHub has not merged this PR. Check required reviews and status checks.');
 }
 return {commit:head,branch:task.branch,pullRequest:task.pullRequest,merged:!!task.merged};
}
