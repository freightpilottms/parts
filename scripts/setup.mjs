import {readFile} from 'node:fs/promises';
import {pool} from '../lib/storage.mjs';
import {scryptSync,randomBytes} from 'node:crypto';

const c=await pool.connect();
try{
await c.query('BEGIN');
await c.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
for(const name of ['Administrator','Adem','Juso','Almin']){const salt=randomBytes(16).toString('hex');await c.query('INSERT INTO parts_app.users(username,password) VALUES($1,$2) ON CONFLICT DO NOTHING',[name,salt+':'+scryptSync('1234',salt,64).toString('hex')]);}
await c.query('COMMIT');console.log('Parts schema ready. Existing project data unchanged.');
}catch(e){await c.query('ROLLBACK');console.error(e.message);process.exitCode=1;}finally{c.release();await pool.end();}
