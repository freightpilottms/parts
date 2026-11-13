import {spawnSync,spawn} from 'node:child_process';
process.env.PARTS_LOCAL_PREVIEW='1';
process.env.PORT=process.env.PORT||'3333';
process.env.APP_ORIGIN=`http://localhost:${process.env.PORT}`;
const setup=spawnSync(process.execPath,['scripts/setup.mjs'],{stdio:'inherit',env:process.env});
if(setup.status!==0)process.exit(setup.status||1);
console.log('LOCAL PREVIEW ONLY. Data is not saved in Supabase.');
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',process.env.PORT],{stdio:'inherit',env:process.env});
child.on('exit',code=>process.exit(code||0));
