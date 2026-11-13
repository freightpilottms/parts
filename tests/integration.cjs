// Runs real SQL and API handlers with an in-memory PostgreSQL engine.
// Only the Next cookie request context is supplied by this harness.
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');
const {AsyncLocalStorage}=require('node:async_hooks');
const {scryptSync,randomBytes}=require('node:crypto');
const ts=require('typescript');
process.env.PARTS_LOCAL_PREVIEW='1';process.env.PARTS_PREVIEW_PATH='memory://';process.env.APP_ORIGIN='http://localhost:3000';
const context=new AsyncLocalStorage();const original=Module._load;
Module._load=function(id,parent,main){if(id==='next/headers')return {cookies:async()=>context.getStore()};if(id.startsWith('@/'))id=path.join(process.cwd(),id.slice(2));return original.call(this,id,parent,main);};
require.extensions['.ts']=(m,file)=>{const code=fs.readFileSync(file,'utf8');m._compile(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);};
const {NextRequest}=require('next/server');const {GET,POST}=require('../app/api/[...path]/route.ts');
const {pool}=require('../lib/storage.mjs');
const hash=p=>{const s=randomBytes(16).toString('hex');return s+':'+scryptSync(p,s,64).toString('hex');};
const makeJar=()=>{const map=new Map();return {get:k=>map.has(k)?{value:map.get(k)}:undefined,set:(k,v,options)=>{map.set(k,v);map.set(k+':options',options)},delete:k=>map.delete(k)};};
const jar=makeJar();let checks=0;
async function call(route,data,options={}){const method=options.method||(data===undefined?'GET':'POST');const multipart=data instanceof FormData;const headers={origin:options.origin||'http://localhost:3000',...(multipart?{}:{'content-type':'application/json'}),...options.headers};const req=new NextRequest('http://localhost:3000/api/'+route,{method,headers,body:method==='GET'?undefined:multipart?data:JSON.stringify(data)});const res=await context.run(options.jar||jar,()=> (method==='GET'?GET:POST)(req,{params:Promise.resolve({path:route.split('?')[0].split('/')})}));let body;try{body=await res.clone().json();}catch{body=await res.arrayBuffer();}return {status:res.status,body,res};}
function check(condition,label){assert.ok(condition,label);checks++;console.log('PASS',label);}
(async()=>{
try{
 await pool.query(fs.readFileSync('scripts/schema.sql','utf8'));
 const me=(await pool.query('INSERT INTO parts_app.users(username,password,must_change) VALUES($1,$2,false) RETURNING id',['TestAdmin',hash('Test-safe-password!')])).rows[0];
 check((await call('items')).status===401,'anonymous inventory denied');
 check((await call('photos/00000000-0000-4000-8000-000000000000')).status===401,'anonymous photos denied');
 check((await call('login',{username:'TestAdmin',password:'Test-safe-password!'},{origin:'https://evil.example'})).status===403,'cross-origin login denied');
 check((await call('login',{username:'TestAdmin',password:'Test-safe-password!'})).status===200,'valid login');
 check(jar.get('parts_session:options').value.maxAge===2592000,'persistent cookie lasts 30 days');
 const expires=(await pool.query('SELECT expires>now()+interval \'29 days\' AS remembered FROM parts_app.sessions')).rows[0];check(expires.remembered,'database session also lasts 30 days');
 check((await call('items',{name:'bad'})).status===400,'invalid item denied');
 const item={part_number:'4G0 807-065',name:'Prednji branik',vehicle:'Audi A6 C7',color:'Crna',category:'Prednji branik',owner_id:me.id,price:220,estimates:{BIH_used:{value:200,count:2}},sources:[]};
 const created=await call('items',item);check(created.status===201,'publish item');const id=created.body.id;
 const image=await require('sharp')({create:{width:16,height:16,channels:3,background:'#157b55'}}).png().toBuffer();
 let photo;
 for(let i=0;i<3;i++){const form=new FormData();form.append('photo',new File([image],'test.png',{type:'image/png'}));const r=await call('items/'+id+'/photos',form);check(r.status===201,'photo '+(i+1)+' accepted');photo=r.body.id;}
 const fourth=new FormData();fourth.append('photo',new File([image],'test.png',{type:'image/png'}));check((await call('items/'+id+'/photos',fourth)).status===409,'fourth photo rejected');
 const img=await call('photos/'+photo);check(img.status===200&&img.res.headers.get('content-type')==='image/webp','authenticated optimized image');
 const found=await call('lookup?number=4g0807065');check(found.body.origin==='database'&&found.body.vehicle==='Audi A6 C7','normalized index-first lookup');
 check((await call('items/'+id+'/sell',{price:-1})).status===400,'negative sale rejected');
 const sales=await Promise.all([call('items/'+id+'/sell',{price:0}),call('items/'+id+'/sell',{price:0})]);check(sales.filter(r=>r.status===200).length===1&&sales.filter(r=>r.status===409).length===1,'concurrent sale: exactly one wins; zero accepted');
 const available=await call('items?status=available');const sold=await call('items?status=sold');check(available.body.total===0&&sold.body.total===1&&Number(sold.body.items[0].sold_price)===0,'sold item preserved and removed from available');
 check((await call('items/'+id+'/photos',fourth)).status===409,'sold photos immutable');
 await call('costs',{goods:100,transport:20});const stats=await call('stats');check(stats.body.profit===-120&&Number(stats.body.sold)===1,'costs and zero-sale profit');
 const a=await call('activity');check(a.body.filter(x=>x.action==='sold').length===1&&a.body.some(x=>x.username==='TestAdmin'&&x.action==='created'),'atomic actor audit');
 for(let i=0;i<31;i++)await pool.query('INSERT INTO parts_app.items(part_number,normalized,name,vehicle,category,owner_id,price,created_by) VALUES($1,$1,$2,$3,$4,$5,$6,$5)',['TEST'+i,'Test '+i,'Audi',item.category,me.id,i]);
 const first=await call('items?sort=price_asc');const second=await call('items?page=2&sort=price_asc');check(first.body.items.length===30&&second.body.items.length===1&&Number(first.body.items[0].price)===0,'30-item pagination and sorting');
 check((await call('items?q='+encodeURIComponent("'; DROP TABLE parts_app.items;--"))).status===200,'SQL injection treated as search data');
 const newbie=await call('users',{username:'NewUser'});check(newbie.status===201,'create user');
 const newJar=makeJar();await call('login',{username:'NewUser',password:'1234'},{jar:newJar});check((await call('items',undefined,{jar:newJar})).status===403,'initial password cannot access inventory');
 check((await call('password',{current:'1234',password:'NewUser123'},{jar:newJar})).status===200,'simple letters and numbers accepted, including username');
 check((await call('items',undefined,{jar:newJar})).status===200,'new password unlocks inventory');
 const savedCookie=newJar.get('parts_session').value;const reopened=makeJar();reopened.set('parts_session',savedCookie);check((await call('me',undefined,{jar:reopened})).status===200,'remembered session works after browser reopen');
 check((await call('password',{current:'NewUser123',password:'abc12'},{jar:newJar})).status===400,'password minimum is six characters');
 await call('logout',{});check((await call('items')).status===401,'logout invalidates session');
 const r=await pool.query("SELECT has_schema_privilege('anon','parts_app','USAGE') AS allowed");check(r.rows[0].allowed===false,'public database schema access revoked');
 console.log(`${checks} integration checks passed.`);
}finally{await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
