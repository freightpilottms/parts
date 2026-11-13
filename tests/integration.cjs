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
 check((await call('items/export?format=xlsx')).status===401,'anonymous export denied');
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
 const csv=await call('items/export?format=csv&sort=price_asc');
 const csvText=Buffer.from(csv.body).toString('utf8');check(csv.status===200&&csvText.split('\r\n').length===32,'export contains all 31 filtered items beyond pagination');
 const xlsx=await call('items/export?format=xlsx&status=sold');const zip=require('fflate').unzipSync(new Uint8Array(xlsx.body));const sheet=Buffer.from(zip['xl/worksheets/sheet1.xml']).toString('utf8');check(sheet.includes('4G0 807-065')&&!sheet.includes('TEST0')&&sheet.includes('<v>0</v>'),'xlsx honors sold filter and preserves zero sale');
 const print=await call('items/export?format=print&q='+encodeURIComponent('<script>alert(1)</script>'));const html=Buffer.from(print.body).toString('utf8');check(!html.includes('<script>alert(1)</script>')&&html.includes('&lt;script&gt;'),'print escapes untrusted filter text');
 const {inventoryCsv}=require('../lib/inventory-export.ts');check(inventoryCsv([{part_number:'=1+1',price:0}]).includes("' =".replace(' ', '')+'1+1'),'CSV neutralizes spreadsheet formulas');
 check((await call('items/export?format=bad')).status===400,'invalid export format rejected');
 const newbie=await call('users',{username:'NewUser'});check(newbie.status===201,'create user');
 const newJar=makeJar();const previousVercel=process.env.VERCEL;process.env.VERCEL='1';
 const firstLogin=await call('login',{username:'NewUser',password:'1234'},{jar:newJar});
 check(firstLogin.status===200&&firstLogin.body.must_change===true,'default password works on Vercel and requires change');
 check((await call('users',undefined,{jar:newJar})).status===403,'initial session cannot list users');
 check((await call('items/export',undefined,{jar:newJar})).status===403,'initial password cannot export');
 check((await call('costs',{goods:0,transport:0},{jar:newJar})).status===403,'initial session cannot change costs');
 const initialToken=newJar.get('parts_session').value;
 check((await call('items',undefined,{jar:newJar})).status===403,'initial password cannot access inventory');
 check((await call('password',{current:'1234',password:'NewUser123'},{jar:newJar})).status===200,'simple letters and numbers accepted, including username');
 check((await call('items',undefined,{jar:newJar})).status===200,'new password unlocks inventory');
 check((await call('me',undefined,{jar:newJar})).body.must_change===false,'password change clears first login flag');
 const stale=makeJar();stale.set('parts_session',initialToken);check((await call('me',undefined,{jar:stale})).status===401,'initial session revoked after password change');
 check((await call('login',{username:'NewUser',password:'1234'},{jar:makeJar()})).status===401,'default password no longer works after change');
 if(previousVercel===undefined)delete process.env.VERCEL;else process.env.VERCEL=previousVercel;
 const savedCookie=newJar.get('parts_session').value;const reopened=makeJar();reopened.set('parts_session',savedCookie);check((await call('me',undefined,{jar:reopened})).status===200,'remembered session works after browser reopen');
 check((await call('password',{current:'NewUser123',password:'abc12'},{jar:newJar})).status===400,'password minimum is six characters');

 const other=(await pool.query('INSERT INTO parts_app.users(username,password,must_change) VALUES($1,$2,false) RETURNING id',['Administrator',hash('Admin123')])).rows[0];
 check(!(await call('users')).body.some(u=>u.username==='Administrator'),'administrator excluded from user list');
 check((await call('items',{...item,owner_id:other.id})).status===403,'cannot assign item to another user');
 const privateItem=(await pool.query('INSERT INTO parts_app.items(part_number,normalized,name,vehicle,category,owner_id,price,created_by) VALUES($1,$1,$2,$3,$4,$5,10,$5) RETURNING id',['ADMINPART','Admin part','Audi',item.category,other.id])).rows[0];
 check((await call('items/'+privateItem.id+'/sell',{price:0})).status===409,'cannot sell another owner item even for zero');
 check((await pool.query('SELECT status FROM parts_app.items WHERE id=$1',[privateItem.id])).rows[0].status==='available','unauthorized sale leaves inventory unchanged');
 await pool.query("INSERT INTO parts_app.activity(user_id,action) VALUES($1,'costs')",[other.id]);
 check(!(await call('activity')).body.some(a=>a.user_id===other.id),'administrator actions hidden from activity API');
 check(Number((await pool.query('SELECT count(*) FROM parts_app.activity WHERE user_id=$1',[other.id])).rows[0].count)===1,'hidden administrator audit retained');
 await call('logout',{});check((await call('items')).status===401,'logout invalidates session');
 const r=await pool.query("SELECT has_schema_privilege('anon','parts_app','USAGE') AS allowed");check(r.rows[0].allowed===false,'public database schema access revoked');
 console.log(`${checks} integration checks passed.`);
}finally{await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
