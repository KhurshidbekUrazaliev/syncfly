import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
export default defineConfig({
 testDir:'./test/browser', workers:1, retries:0,
 use:{baseURL:'http://127.0.0.1:4400',trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'node server.mjs',url:'http://127.0.0.1:4400/healthz',reuseExistingServer:false,env:{PORT:'4400',RELAY_EXECUTION:'docker',RELAY_PUBLIC_URL:'http://localhost:4400',RELAY_DATA_DIR:path.join(os.tmpdir(),`syncfly-browser-${process.pid}`),RELAY_INVITE_CODE:'browser-test-code',RELAY_ALLOW_SIGNUP:'false'}},
});
