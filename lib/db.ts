import {pool} from './storage.mjs';
export const db=pool as import('pg').Pool;
export async function transaction<T>(fn:(client:import('pg').PoolClient)=>Promise<T>){const c=await db.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
