const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const { fork, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

let backend, window, quitting = false;
const smoke = process.argv.includes('--smoke-test');
if (smoke || process.argv.includes('--test-mode')) app.setPath('userData', path.resolve(process.env.SYNCFLY_SMOKE_DATA));
app.setName('Syncfly');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.syncfly.desktop');
    Menu.setApplicationMenu(null);
    const data = path.join(app.getPath('userData'), 'workspace');
    fs.mkdirSync(data, { recursive: true });
    const log = fs.openSync(path.join(app.getPath('userData'), 'backend.log'), 'a');
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: '0', RELAY_BIND: '127.0.0.1', RELAY_EXECUTION: 'native', RELAY_DATA_DIR: data, RELAY_MAX_ACTIVE_TASKS: '10', RELAY_ALLOW_SIGNUP: 'true' };
    delete env.RELAY_PUBLIC_URL;
    delete env.RELAY_INVITE_CODE;
    backend = fork(path.join(__dirname, '..', 'server.mjs'), [], { env, stdio: ['ignore', log, log, 'ipc'], windowsHide: true });
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The local service did not start in time.')), 30000);
      backend.once('error', error => { clearTimeout(timer); reject(error); });
      backend.once('exit', () => { clearTimeout(timer); reject(new Error('The local service stopped. See backend.log in the app data folder.')); });
      backend.on('message', message => { if (message.type === 'ready') { clearTimeout(timer); resolve(message.port); } });
    });
    const origin = `http://127.0.0.1:${port}`;
    window = new BrowserWindow({ width: 1440, height: 940, minWidth: 900, minHeight: 640, title: 'Syncfly', show: !smoke, backgroundColor: '#f5f4ef', icon: path.join(__dirname, '..', 'dist', 'syncfly-sync-wings.png'), webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url) && !url.startsWith(origin + '/')) shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) { event.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
    });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    backend.on('exit', () => { if (!quitting) { dialog.showErrorBox('Syncfly service stopped', 'Restart Syncfly to reconnect to your saved workspace.'); app.quit(); } });
    await window.loadURL(origin);
    if (smoke) {
      const result = await window.webContents.executeJavaScript(`Promise.all([fetch('/readyz').then(r=>r.json()), Promise.resolve(document.title), Promise.resolve(document.body.innerText)]).then(([health,title,text])=>({health,title,hasUI:text.length>100}))`);
      fs.writeFileSync(path.join(app.getPath('userData'), 'smoke-result.json'), JSON.stringify(result));
      app.quit();
    }
  }).catch(error => { dialog.showErrorBox('Unable to start Syncfly', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting || !backend || backend.exitCode !== null) return;
    event.preventDefault(); quitting = true;
    // Terminate the local service and its agent processes together on Windows.
    execFile('taskkill', ['/pid', String(backend.pid), '/T', '/F'], { windowsHide: true }, () => app.quit());
  });
}
