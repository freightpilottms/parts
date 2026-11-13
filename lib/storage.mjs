import pg from 'pg';
// A separate, explicit development-only database. Never a cloud fallback.
const preview=process.env.PARTS_LOCAL_PREVIEW==='1';
if(preview&&process.env.VERCEL)throw Error('Local preview is forbidden on Vercel.');
const g=globalThis;
function makeLocal(){
 let promise;
 let queue=Promise.resolve();
 async function acquire(){let release;const previous=queue;queue=new Promise(r=>release=r);await previous;return release;}
 async function get(){if(!promise)promise=import('@electric-sql/pglite').then(async({PGlite})=>{const db=new PGlite(process.env.PARTS_PREVIEW_PATH||'./.parts-preview');await db.waitReady;await db.exec("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;");return db;});return promise;}
 async function run(text,values){const db=await get();if(!values&&text.includes(';')){const results=await db.exec(text);return results.at(-1)||{rows:[],rowCount:0};}const r=await db.query(text,values);return {...r,rowCount:r.affectedRows??r.rows.length};}
 return {async query(text,values){const release=await acquire();try{return await run(text,values);}finally{release();}},async connect(){const release=await acquire();return {query:run,release};},async end(){if(promise)await(await promise).close();}};
}
export const pool=g.partsStorage??(preview?makeLocal():new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,idleTimeoutMillis:20000}));
g.partsStorage=pool;
