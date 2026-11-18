import { promises as fs, constants } from 'node:fs';
import path from 'node:path';

// Launch npm CLIs through their JS entry point, never through cmd.exe.
// This preserves prompts as one argument, including shell metacharacters.
const packages = { codex: '@openai/codex', claude: '@anthropic-ai/claude-code' };
export async function resolveCursorInstallation(root) {
  const candidates=[root];
  try {
    const versions=(await fs.readdir(path.join(root,'versions'),{withFileTypes:true}))
      .filter(e=>e.isDirectory()&&/^\d{4}\.\d{1,2}\.\d{1,2}(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/.test(e.name))
      .map(e=>e.name).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
    candidates.push(...versions.map(v=>path.join(root,'versions',v)));
  } catch {}
  for(const dir of candidates) {
    const file=path.join(dir,'node.exe'), entry=path.join(dir,'index.js');
    try { await fs.access(file,constants.X_OK);await fs.access(entry);return {file,args:[entry]}; } catch {}
  }
  return null;
}
export async function resolveNativeCLI(commands, { platform=process.platform, searchPath=process.env.PATH || '', node=process.execPath }={}) {
  const dirs=searchPath.split(path.delimiter).map(d=>d.replace(/^"|"$/g,'')).filter(Boolean);
  if(platform==='win32'&&process.env.APPDATA) dirs.push(path.join(process.env.APPDATA,'npm'));
  if(platform==='win32'&&process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA,'agy','bin'));
  if(platform==='win32'&&process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA,'cursor-agent'));
  for(const command of commands || []) for(const dir of dirs) {
    const candidate=path.join(dir,command+(platform==='win32'?'.exe':''));
    try { await fs.access(candidate,constants.X_OK);return {file:candidate,args:[]}; }catch{}
    if(platform==='win32'&&['agent','cursor-agent'].includes(command)) {
      const cursor=await resolveCursorInstallation(dir);
      if(cursor)return cursor;
    }
    if(platform==='win32'&&packages[command]) {
      const root=path.join(dir,'node_modules',packages[command]);
      try {
        const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
        const entry=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.[command];
        if(!entry)continue;
        const script=path.resolve(root,entry);
        if(!script.startsWith(root+path.sep))continue;
        await fs.access(script);
        return {file:node,args:[script]};
      }catch{}
    }
  }
  return null;
}
