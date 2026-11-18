import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
export const gitEnv={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_AUTHOR_NAME:'Syncfly',GIT_AUTHOR_EMAIL:'syncfly@localhost',GIT_COMMITTER_NAME:'Syncfly',GIT_COMMITTER_EMAIL:'syncfly@localhost'};
export const git=async(cwd,args,options={})=>(await exec('git',['-c','safe.directory=*','-C',cwd,...args],{env:gitEnv,timeout:60000,maxBuffer:4e6,windowsHide:true,...options})).stdout.trim();
export async function snapshotTask(task,root){
 const index=path.join(root,'snapshot-'+randomUUID()+'.index');
 const env={...gitEnv,GIT_INDEX_FILE:index};
 try{
  const head=await git(task.worktree,['rev-parse','HEAD']);
  await git(task.worktree,['read-tree','HEAD'],{env});
  await git(task.worktree,['add','-A','--','.',':(exclude).syncfly-context-*'],{env});
  const tree=await git(task.worktree,['write-tree'],{env});
  return await git(task.worktree,['commit-tree',tree,'-p',head,'-m',`Syncfly worker snapshot: ${task.title}`],{env});
 }finally{await fs.rm(index,{force:true});await fs.rm(index+'.lock',{force:true});}
}
export async function prepareIntegration(project,sources,task,root){
 const snapshots=[];
 for(const source of sources){
  const hash=await snapshotTask(source,root);
  await git(task.worktree,['fetch','--no-tags','--',source.worktree,hash]);
  snapshots.push({id:source.id,title:source.title,commit:hash});
 }
 let conflict=false;
 for(const snapshot of snapshots){
  if(conflict)break;
  try{await git(task.worktree,['merge','--no-edit','--no-ff',snapshot.commit]);}
  catch(e){if(await git(task.worktree,['diff','--name-only','--diff-filter=U']))conflict=true;else throw e;}
 }
 task.snapshots=snapshots;
 return `You are the project orchestrator. Review, combine, and repair these completed worker results in your current integration branch.\nProject: ${project.name}\nContext: ${project.context||''}\nWorker snapshots: ${JSON.stringify(snapshots)}\n${conflict?'A merge has conflicts. Resolve them and complete the merge, then merge any remaining snapshot commits.':'Worker snapshots were merged. Inspect their combined result carefully.'}\nAnalyze each worker summary, inspect the actual diff, fix integration problems, run the relevant tests, and summarize tests and remaining risks. Ensure every listed snapshot is merged, including any not yet merged after a conflict. Do not publish, push, or merge to the remote base branch; publishing is handled by Syncfly after review.\nWorker summaries:\n${sources.map(t=>`${t.title}:\n${(t.logs||[]).map(l=>l.text).join('\n').slice(-6000)}`).join('\n\n')}`;
}
export async function checkIntegration(task){
 if(await git(task.worktree,['diff','--name-only','--diff-filter=U']))throw new Error('The integration still contains unresolved merge conflicts.');
 for(const snapshot of task.snapshots||[])await git(task.worktree,['merge-base','--is-ancestor',snapshot.commit,'HEAD']);
}
export async function commitIntegration(task){
 await checkIntegration(task);
 await git(task.worktree,['add','-A','--','.',':(exclude).syncfly-context-*']);
 if(await git(task.worktree,['status','--porcelain']))await git(task.worktree,['commit','-m',`Syncfly: ${task.title}`]);
 return git(task.worktree,['rev-parse','HEAD']);
}
