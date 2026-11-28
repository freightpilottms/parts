// Runs real SQL and API handlers with an in-memory PostgreSQL engine.
// Only the Next cookie request context is supplied by this harness.
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');
const {AsyncLocalStorage}=require('node:async_hooks');
const {scryptSync,randomBytes}=require('node:crypto');
const ts=require('typescript');
process.env.PARTS_LOCAL_PREVIEW='1';process.env.PARTS_PREVIEW_PATH='memory://';process.env.APP_ORIGIN='http://localhost:3000';
let lookupMode;
const callbacks=[];let enrichmentCalls=0;let failEnrichment=false;let emptyEnrichment=false;let lastRefresh;
const context=new AsyncLocalStorage();const original=Module._load;
Module._load=function(id,parent,main){if(id==='@/lib/lookup'){const real=original.call(this,path.join(process.cwd(),'lib/lookup.ts'),parent,main);return {...real,lookup:async(number,refresh,identityOnly,...rest)=>{lookupMode={refresh,identityOnly};if(number==='MODETEST')return {name:'Test dio',vehicle:'Audi',estimates:{},sources:[]};return real.lookup(number,refresh,identityOnly,...rest);}};}if(id==='next/server')return {...original.call(this,id,parent,main),after:fn=>callbacks.push(fn)};if(id==='./lookup'&&parent.filename.endsWith('enrichment.ts'))return {lookup:async(number,refresh)=>{lastRefresh=refresh;enrichmentCalls++;if(failEnrichment)throw Error('Timeout');if(emptyEnrichment)return {name:'AI name',vehicle:'AI vehicle',estimates:{},sources:[]};return {name:'AI name',vehicle:'AI vehicle',photo:'https://example.com/exact.jpg',estimates:{EU_used:{value:100,count:1,basis:'verified_original_oem'}},sources:[]};}};if(id==='next/headers')return {cookies:async()=>context.getStore()};if(id.startsWith('@/'))id=path.join(process.cwd(),id.slice(2));return original.call(this,id,parent,main);};
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
 const valuation=await call('valuation?number=4g0807065');
 check(valuation.body.reference?.median===220&&valuation.body.reference.type==='asking','matching OEM asking price is labelled as inventory evidence');
 check((await call('valuation?number=4g0807065&id='+id)).body.reference===null,'exclude current item from its own estimate');
 const {productPrice}=require('../lib/gemini-lookup.ts');
 const sellerPage={url:'https://example.ba/dio',title:'Original Audi',description:'',productNumber:'4G0 807 065',structuredOffers:[{price:350,priceCurrency:'BAM',itemCondition:'https://schema.org/UsedCondition'}]};
 check(productPrice(sellerPage,'4g0807065')?.price===350&&!productPrice(sellerPage,'4g0807065D')&&!productPrice({...sellerPage,title:'Aftermarket Audi'},'4g0807065'),'recover seller-published exact OEM price and reject suffix mismatch and copies');
 const image=await require('sharp')({create:{width:800,height:600,channels:3,background:'#157b55'}}).png().toBuffer();
 let photo;
 for(let i=0;i<3;i++){const form=new FormData();form.append('photo',new File([image],'test.png',{type:'image/png'}));const r=await call('items/'+id+'/photos',form);check(r.status===201,'photo '+(i+1)+' accepted');photo=r.body.id;}
 const fourth=new FormData();fourth.append('photo',new File([image],'test.png',{type:'image/png'}));check((await call('items/'+id+'/photos',fourth)).status===409,'fourth photo rejected');
 const img=await call('photos/'+photo);check(img.status===200&&img.res.headers.get('content-type')==='image/jpeg'&&Buffer.from(img.body).readUInt16BE(0)===0xffd8,'authenticated optimized image');
 const thumb=await call('photos/'+photo+'?size=thumb');
 const thumbInfo=await require('sharp')(Buffer.from(thumb.body)).metadata();
 check(thumbInfo.format==='jpeg'&&thumbInfo.width===240&&thumb.body.byteLength<img.body.byteLength,'table thumbnail is a smaller JPEG');
 const cachedPhoto=await call('photos/'+photo+'?size=thumb',undefined,{headers:{'if-none-match':thumb.res.headers.get('etag')}});
 check(cachedPhoto.status===304,'signed-in repeat request skips photo payload');
 const jpg=await call('photos/'+photo+'?download=1');
 check(jpg.res.headers.get('content-disposition').includes('.jpg"'),'download matches JPEG format');
 const oldWebp=await require('sharp')(image).webp().toBuffer();
 const legacyPhoto=(await pool.query("INSERT INTO parts_app.photos(item_id,bytes,mime) VALUES($1,$2,'image/webp') RETURNING id",[id,oldWebp])).rows[0].id;
 const legacySmall=await call('photos/'+legacyPhoto+'?size=thumb');
 check(legacySmall.res.headers.get('content-type')==='image/jpeg'&&(await pool.query('SELECT thumbnail IS NOT NULL AS ready FROM parts_app.photos WHERE id=$1',[legacyPhoto])).rows[0].ready,'legacy thumbnail generated and stored');
 check((await call('photos/'+legacyPhoto)).res.headers.get('content-type')==='image/webp','legacy full photo remains readable');
 await pool.query('DELETE FROM parts_app.photos WHERE id=$1',[legacyPhoto]);
 const found=await call('lookup?number=4g0807065');check(found.body.origin==='database'&&found.body.vehicle==='Audi A6 C7','normalized index-first lookup');
 check((await call('items/'+id+'/sell',{price:-1})).status===400,'negative sale rejected');
 const sales=await Promise.all([call('items/'+id+'/sell',{price:0}),call('items/'+id+'/sell',{price:0})]);check(sales.filter(r=>r.status===200).length===1&&sales.filter(r=>r.status===409).length===1,'concurrent sale: exactly one wins; zero accepted');
 check((await call('valuation?number=4G0807065')).body.reference===null,'zero sale excluded from valuation');
 const available=await call('items?status=available');const sold=await call('items?status=sold');check(available.body.total===0&&sold.body.total===1&&Number(sold.body.items[0].sold_price)===0,'sold item preserved and removed from available');
 check((await call('items/'+id+'/photos',fourth)).status===409,'sold photos immutable');
 await call('costs',{goods:100,transport:20});const stats=await call('stats');check(stats.body.profit===-120&&Number(stats.body.sold)===1,'costs and zero-sale profit');
 const a=await call('activity');check(a.body.filter(x=>x.action==='sold').length===1&&a.body.some(x=>x.username==='TestAdmin'&&x.action==='created'),'atomic actor audit');
 for(let i=0;i<31;i++)await pool.query('INSERT INTO parts_app.items(part_number,normalized,name,vehicle,category,owner_id,price,created_by) VALUES($1,$1,$2,$3,$4,$5,$6,$5)',['TEST'+i,'Test '+i,'Audi',item.category,me.id,i]);
 const first=await call('items?sort=price_asc');const second=await call('items?page=2&sort=price_asc');check(first.body.items.length===30&&second.body.items.length===1&&Number(first.body.items[0].price)===0,'30-item pagination and sorting');
 const next=await call('items?q=Test&sort=price_asc&after_id='+first.body.items[29].id);
 check(next.body.page===2&&next.body.nextId===second.body.items[0].id,'next detail crosses page boundary in filtered price order');
 check((await call('items?sort=price_asc&after_id='+second.body.items[0].id)).body.nextId===null,'last detail has no successor');
 check((await call('items?q='+encodeURIComponent("'; DROP TABLE parts_app.items;--"))).status===200,'SQL injection treated as search data');
 const csv=await call('items/export?format=csv&sort=price_asc');
 const csvText=Buffer.from(csv.body).toString('utf8');check(csv.status===200&&csvText.split('\r\n').length===32,'export contains all 31 filtered items beyond pagination');
 const xlsx=await call('items/export?format=xlsx&status=sold');const zip=require('fflate').unzipSync(new Uint8Array(xlsx.body));const sheet=Buffer.from(zip['xl/worksheets/sheet1.xml']).toString('utf8');check(sheet.includes('4G0 807-065')&&!sheet.includes('TEST0')&&sheet.includes('<v>0</v>'),'xlsx honors sold filter and preserves zero sale');
 const print=await call('items/export?format=print');
 const pdf=Buffer.from(print.body);
 check(print.status===200 && print.res.headers.get('content-type')==='application/pdf' && /\.pdf"/.test(print.res.headers.get('content-disposition')) && pdf.subarray(0,8).toString()==='%PDF-1.4','signed-in print downloads a PDF');
 check((await call('items/export?format=print',undefined,{jar:makeJar()})).status===401,'anonymous PDF export denied');
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
 check((await call('items',{...item,owner_id:other.id})).status===400,'hidden administrator cannot be assigned by another user');
 const delegated=await call('items',{...item,part_number:'DELEGATED123',owner_id:newbie.body.id});
 check(delegated.status===201&&delegated.body.owner_id===newbie.body.id&&delegated.body.created_by===me.id,'new item can be assigned to another user while retaining creator');
 const delegatedId=delegated.body.id;
 check((await call('items/'+delegatedId+'/sell',{price:0})).status===409,'creator cannot sell item assigned to another user');
 check((await call('items/'+delegatedId+'/owner',{owner_id:newbie.body.id,expected_owner_id:newbie.body.id})).status===403,'existing item cannot be assigned to someone else');
 check((await call('items/'+delegatedId+'/owner',{owner_id:me.id,expected_owner_id:other.id})).status===409,'stale owner edit rejected');
 check((await call('items/'+delegatedId+'/owner',{owner_id:me.id,expected_owner_id:newbie.body.id})).status===200,'existing item can be claimed by current user');
 check((await call('items/'+delegatedId+'/owner',{owner_id:me.id,expected_owner_id:newbie.body.id})).status===200,'repeated self assignment is idempotent');
 check(Number((await pool.query("SELECT count(*) FROM parts_app.activity WHERE item_id=$1 AND action='owner'",[delegatedId])).rows[0].count)===1,'owner change audited once');
 check((await call('items/'+delegatedId+'/sell',{price:0},{jar:newJar})).status===409,'previous owner loses sale permission');
 const priceRoute='items/'+delegatedId+'/price';
 check((await call(priceRoute,{price:12.35,expected_price:item.price},{jar:newJar})).status===403,'other user cannot edit asking price');
 check((await call(priceRoute,{price:12.35,expected_price:item.price})).status===200,'owner can update asking price with cents');
 check((await call(priceRoute,{price:0,expected_price:item.price})).status===409,'concurrent price edit rejected');
 check((await call(priceRoute,{price:0,expected_price:12.35})).status===200,'zero asking price saves');
 check((await call('activity')).body.some(a=>a.action==='price'&&a.item_id===delegatedId&&Number(a.details.previous_price)===12.35&&a.details.price===0),'asking price change audited');
 check((await call('items/'+delegatedId+'/sell',{price:0})).status===200,'current owner can sell for zero');
 check((await call(priceRoute,{price:80,expected_price:0})).status===409,'sold item price locked');
 check((await call('items/'+delegatedId+'/owner',{owner_id:newbie.body.id,expected_owner_id:me.id},{jar:newJar})).status===409,'sold item owner cannot be changed');
 const privateItem=(await pool.query('INSERT INTO parts_app.items(part_number,normalized,name,vehicle,category,owner_id,price,created_by) VALUES($1,$1,$2,$3,$4,$5,10,$5) RETURNING id',['ADMINPART','Admin part','Audi',item.category,other.id])).rows[0];
 check((await call('items/'+privateItem.id+'/sell',{price:0})).status===409,'cannot sell another owner item even for zero');
 check((await pool.query('SELECT status FROM parts_app.items WHERE id=$1',[privateItem.id])).rows[0].status==='available','unauthorized sale leaves inventory unchanged');
 await pool.query("INSERT INTO parts_app.activity(user_id,action) VALUES($1,'costs')",[other.id]);
 check(!(await call('activity')).body.some(a=>a.user_id===other.id),'administrator actions hidden from activity API');
 check(Number((await pool.query('SELECT count(*) FROM parts_app.activity WHERE user_id=$1',[other.id])).rows[0].count)===1,'hidden administrator audit retained');
 await pool.query("INSERT INTO parts_app.limits(key,count,expires) VALUES($1,40,now()+interval '1 hour'),($2,40,now()+interval '1 hour')",[ 'enrich:'+me.id,'lookup:'+me.id ]);
 const repeated=await call('lookup?number=4g0807065');
 check(repeated.status===200&&repeated.body.origin==='database','existing part lookup works after 30 hourly requests');
 const background=await call('items',{...item,enrich_after_save:true});
 check(background.status===201,'publication with optional enrichment works after 30 hourly requests');
 check(background.status===201&&background.body.estimates._enrichment.status==='pending'&&enrichmentCalls===0,'publish returns before enrichment starts');
 check((await call('items/'+background.body.id+'/enrich',{})).status===409,'duplicate pending enrichment denied');
 const job=callbacks.shift();await Promise.all([job(),job()]);
 const enriched=(await pool.query('SELECT * FROM parts_app.items WHERE id=$1',[background.body.id])).rows[0];
 check(enrichmentCalls===1&&enriched.estimates._enrichment.status==='complete'&&enriched.estimates.EU_used.value===100,'atomic background job saves estimates and images once');
 check(enriched.name===item.name&&enriched.vehicle===item.vehicle&&Number(enriched.price)===item.price,'background enrichment preserves user fields');
 check((await call('items/'+privateItem.id+'/enrich',{})).status===409,'unrelated user cannot trigger paid enrichment');
 failEnrichment=true;check((await call('items/'+background.body.id+'/enrich',{})).status===202,'manual retry queued');await callbacks.shift()();check(lastRefresh===true,'manual retry bypasses lookup cache');
 check((await pool.query('SELECT estimates FROM parts_app.items WHERE id=$1',[background.body.id])).rows[0].estimates._enrichment.status==='failed','failed enrichment retains item and reports retryable state');
 await pool.query("UPDATE parts_app.items SET estimates=jsonb_set(estimates,'{_enrichment}',$2::jsonb) WHERE id=$1",[background.body.id,JSON.stringify({status:'running',updated_at:new Date(Date.now()-180000).toISOString()})]);
 check((await call('items/'+background.body.id+'/enrich',{})).status===202,'stalled background job can be recovered');failEnrichment=false;await callbacks.shift()();
 check((await pool.query('SELECT estimates FROM parts_app.items WHERE id=$1',[background.body.id])).rows[0].estimates._enrichment.images.length===1,'retry preserves existing reference images');
 emptyEnrichment=true;const emptyJob=await call('items',{...item,estimates:{},enrich_after_save:true});await callbacks.shift()();
 check((await pool.query('SELECT estimates FROM parts_app.items WHERE id=$1',[emptyJob.body.id])).rows[0].estimates._enrichment.status==='partial','empty enrichment is partial instead of complete');
 await call('lookup?number=MODETEST');check(lookupMode.identityOnly===true,'main search keeps fast identity mode');
 await call('lookup?number=MODETEST&refresh=1&mode=full');check(lookupMode.identityOnly===false&&lookupMode.refresh===true,'Pretrazi Internet requests full fresh lookup');
 emptyEnrichment=false;const completed=await call('items/'+emptyJob.body.id+'/enrich',{wait:true});
 check(completed.status===200&&completed.body.item.estimates._enrichment.status==='complete'&&callbacks.length===0,'manual article search returns saved results without polling');
 const scanned=await call('items',{...item,name:'Nosač zadnjeg svjetla',category:'Lijeva zadnja štopka',part_number:'4G9 807 511 P',markings:['ZX-9902']});
 for(const term of ['nosac audi','štopke lijeve','ZX-9902','zx9902','4g9807511p','A6 nosac']){
  const result=await call('items?q='+encodeURIComponent(term));
  check(result.body.items.some(row=>row.id===scanned.body.id),'inventory finds '+term);
 }
 const migration=fs.readFileSync('scripts/update-users.sql','utf8');
 const old=(await pool.query("INSERT INTO parts_app.users(username,password) VALUES('Juso',$1) RETURNING id",[hash('temporary')])).rows[0].id;
 await pool.query("INSERT INTO parts_app.sessions(token,user_id,expires) VALUES('retired', $1, now()+interval '1 day')",[old]);
 await pool.query(migration);
 check(!(await pool.query("SELECT 1 FROM parts_app.sessions WHERE user_id=$1",[old])).rows.length,'retired user sessions revoked');
 const visible=(await call('users')).body.map(row=>row.username);
 check(visible.includes('Irnes')&&visible.includes('Alen')&&!visible.includes('Juso')&&!visible.includes('Almin'),'updated user dropdown');
 for(const username of ['Irnes','Alen']){
  const r=await call('login',{username,password:username+'1234'},{jar:makeJar()});
  check(r.status===200&&r.body.must_change,'personal initial password for '+username);
 }
 await pool.query("UPDATE parts_app.users SET password=$1,must_change=false WHERE username='Irnes'",[hash('personal123')]);
 await pool.query(migration);
 check((await call('login',{username:'Irnes',password:'personal123'},{jar:makeJar()})).status===200,'reapplying migration preserves changed password');
 const adminPart=await call('items',{...item,part_number:'ROLE-TEST',name:'Test ovlaštenja',price:100});
 const itemRoute='items/'+adminPart.body.id;
 for(const [name,previous,next] of [['Irnes',100,110],['Adem',110,120],['Alen',120,130]]){
  const account=(await pool.query('INSERT INTO parts_app.users(username,password,must_change) VALUES($1,$2,false) ON CONFLICT (lower(username)) DO UPDATE SET password=excluded.password,must_change=false RETURNING id',[name,hash('roleTest123')])).rows[0];
  const session=makeJar();assert.equal((await call('login',{username:name,password:'roleTest123'},{jar:session})).status,200);
  check((await call('users',undefined,{jar:session})).body.find(u=>u.username===name)?.role===(name==='Alen'?'Moderator':'System Admin'),name+' has the correct role in the users list');
  const update=()=>call(itemRoute+'/price',{price:next,expected_price:previous},{jar:session});
  check((await update()).status===(name==='Alen'?403:200),name+' price permissions on another holder item');
  check((await call(itemRoute+'/sell',{price:next},{jar:session})).status===409,name+' cannot sell another holder item');
  if(name==='Alen'){
   check((await call(itemRoute+'/owner',{owner_id:account.id,expected_owner_id:me.id},{jar:session})).status===200,'Alen can take custody as moderator');
   check((await update()).status===200,'Alen can reprice after taking custody');
   assert.equal((await call(itemRoute+'/sell',{price:next},{jar:session})).status,200);
  }
 }
 check((await call('scan',{}, {jar:makeJar()})).status===401,'photo recognition requires sign-in');
 const {resolveScanSide}=require('../lib/scan-orientation.ts');
 for(const [name,category,view,label,expectedName,expectedCategory] of [
  ['Prednji blatobran','Desni blatobran','fender_nose_left','none','Lijevi prednji blatobran','Lijevi blatobran'],
  ['Desni far','Desni far','lamp_outer_edge_right','none','Lijevi far','Lijevi far'],
  ['Far','Ostali dijelovi','unknown','RH','Desni far','Desni far'],
  ['Lijevi far','Lijevi far','lamp_outer_edge_left','LH','Far','Ostali dijelovi'],
  ['Lijevi far','Lijevi far','unknown','none','Far','Ostali dijelovi'],
  ['Nosač fara','Lijevi far','unknown','LH','Nosač fara','Ostali dijelovi'],
  ['Prednja maglenka','Ostali dijelovi','unknown','none','Prednja maglenka','Ostali dijelovi']
 ]){
  const resolved=resolveScanSide(name,category,view,label);
  check(resolved.name===expectedName&&resolved.category===expectedCategory,'photo side: '+view+' / '+label+' -> '+expectedName);
 }
 const {usedValue}=require('../lib/used-value.ts');
 const lamp={category:'Lijevi far',name:'Lijevi far H7',vehicle:'Golf 2016',price:470};
 check(usedValue(lamp,null,0,0).value===440,'H7 2015+ estimate blends the midpoint and asking price');
 check(usedValue({...lamp,vehicle:'Golf 2012'},null,0,0).value===470,'older H7 uses the asking price');
 check(usedValue({...lamp,name:'Far Bi-xenon',price:0},null,0,0).value===800,'bi-xenon midpoint without asking price');
 check(usedValue({...lamp,name:'Matrix far',price:0},null,0,0).value===2000,'matrix midpoint without asking price');
 check(usedValue({...lamp,name:'Modul Matrix fara',price:0},null,0,0)===null,'matrix module excluded from complete headlight benchmark');
 check(usedValue(lamp,null,650,0).value===650,'observed exact local OEM evidence takes priority');
 const financeBefore=(await call('stats')).body;
 const estimate=value=>({value,count:1,basis:'verified_original_oem'});
 async function stock(number,price,estimates={}){
  const r=await call('items',{...item,part_number:number,price,estimates});
  assert.equal(r.status,201);return r.body.id;
 }
 for(const realized of [0,200,600]){
  const id=await stock('FIN123',999);
  assert.equal((await call('items/'+id+'/sell',{price:realized})).status,200);
 }
 await stock('FIN 123',50,{EU_used:estimate(900)});
 await stock('FIN-123',100);
 await stock('FIN456',200,{BIH_used:estimate(250),EU_used:estimate(300)});
 await stock('FIN 456',300);
 await stock('FIN789',0,{EU_used:estimate(195.58)});
 const unknown=await stock('FIN999',75,{BIH_new:estimate(900),BIH_used:{value:500,count:1}});
 const finance=(await call('stats')).body;
 check(Math.abs(finance.inventory-financeBefore.inventory-1570.58)<0.001,'stock value prefers local verified used prices then median positive sales then EU used in KM');
 check(finance.valued_count-financeBefore.valued_count===6&&finance.missing-financeBefore.missing===0,'coverage includes verified references and the asking-price fallback');
 check(finance.asking_total-financeBefore.asking_total===725&&finance.revenue-financeBefore.revenue===800,'asking total covers available units and actual sales stay in revenue');
 await call('items/'+unknown+'/price',{price:90,expected_price:75});
 const repriced=(await call('stats')).body;
 check(repriced.asking_total-finance.asking_total===15&&Math.abs(repriced.inventory-finance.inventory-15)<0.001,'repricing updates the fallback estimate when only the asking price is known');
 for(const [n,vehicle] of ['VW Golf VII / Passat B8','Volkswagen Golf VIII','Audi A6 / A7 C7 Avant','Vozilo nije utvrđeno'].entries()){
  assert.equal((await call('items',{...item,name:'Filter uzorak',part_number:'FLT'+n,vehicle})).status,201);
 }
 const filter='q=uzorak&owner='+me.id+'&category='+encodeURIComponent(item.category)+'&status=available&sort=number&make=Volkswagen';
 const filtered=(await call('items?'+filter)).body;
 check(filtered.total===2&&filtered.vehicleOptions.find(v=>v.make==='Volkswagen').models.join(',')==='Golf,Passat','make aliases grouped and combined with other filters');
 check(filtered.vehicleOptions.find(v=>v.make==='Audi').models.includes('A7')&&!filtered.vehicleOptions.some(v=>v.make==='Vozilo'),'fitment lists secondary model and skips unknown vehicle');
 const one=(await call('items?'+filter+'&model=Passat')).body;
 check(one.total===1&&one.items[0].part_number==='FLT0','selected model limits rows within make');
 check((await call('items?'+filter+'&model=A7')).body.total===0,'mismatched make and model yields no rows');
 const csvFiltered=await call('items/export?format=csv&'+filter+'&model=Passat');
 check(Buffer.from(csvFiltered.body).toString().includes('FLT0')&&!Buffer.from(csvFiltered.body).toString().includes('FLT1'),'export respects make and model');
 const {verifyFitment}=require('../lib/scan-fitment.ts');
 const lampPage={title:'Far Range Rover Sport L320',url:'https://seller.example/part'};
 const lampPage2={...lampPage,url:'https://another.test/part'};
 check(verifyFitment('Land Rover Discovery 3',[lampPage,lampPage2]).sources.length===0,'Discovery 3 cannot inherit a Range Rover Sport match');
 check(verifyFitment('Range Rover Sport L320',[lampPage,{...lampPage,url:'https://shop.seller.example/2'}]).sources.length===0,'repeat listing host does not corroborate fitment');
 check(verifyFitment('Range Rover Sport L320',[lampPage,lampPage2]).sources.length===2,'two exact catalogue product titles agree on model and generation');
 const withoutGeneration={...lampPage2,title:'LR012437 Range Rover Sport Headlamp'};
 check(verifyFitment('Range Rover Sport L320',[lampPage,withoutGeneration]).vehicle==='Range Rover Sport','withhold generation when only one independent page supports it');
 check(!verifyFitment('Range Rover Sport L320',[lampPage,{...lampPage2,title:'Range Rover Sport L494'}]).vehicle,'contradictory generation blocks fitment');
 const {parseProductPage}=require('../lib/product-page.ts');
 check(!parseProductPage('<title>4G0 823 029 D | Audi A6 C7</title>',lampPage.url,'4G0 823 029',true),'a spaced suffix cannot verify a different OEM');
 const beforeScan=(await call('stats')).body;
 const scan=(await call('items',{...item,scan_entry:true,part_number:'FIN789',vehicle:'Land Rover Discovery 3',visual_vehicle:'Range Rover Sport',enrich_after_save:true})).body;
 check(scan.estimates._visual_vehicle==='Range Rover Sport','photo model remains visible independently of verified fitment');
 check(scan.estimates._scan_fitment==='pending'&&!scan.estimates._enrichment&&scan.vehicle==='Vozilo nije utvrđeno','unverified scan clears model, estimates and automatic research');
 const afterScan=(await call('stats')).body;
 check(afterScan.missing-beforeScan.missing===1&&afterScan.inventory===beforeScan.inventory,'unverified scan excluded even when same-number price exists');
 check((await call('items/'+scan.id+'/enrich',{wait:true})).status===409,'scan retry requires physically checked OEM');
 const proof={part_number:'SCAN123',verified:true,name:item.name,category:item.category,vehicle:'Audi A6 C7',sources:[{title:'Catalogue',url:'https://catalog.example/part'}]};
 await pool.query("INSERT INTO parts_app.lookup_cache(normalized,data,expires) VALUES($1,$2,now()+interval '1 hour')",['scan-fitment-v1:SCAN123',JSON.stringify(proof)]);
 check((await call('lookup?mode=scan&number=SCAN-123')).body.verified,'scan endpoint reads exact-number catalogue verification');
 const verified=await call('items',{...item,scan_entry:true,part_number:'SCAN-123',vehicle:proof.vehicle,enrich_after_save:true});
 check(verified.body.estimates._scan_fitment==='verified'&&verified.body.estimates._enrichment.status==='pending','verified scan schedules prices');
 const recovered=await call('items/'+scan.id+'/enrich',{wait:true,confirmed_oem:'SCAN-123'});
 check(recovered.status===200&&recovered.body.item.vehicle===proof.vehicle&&recovered.body.item.estimates._scan_fitment==='verified','physically checked OEM can resolve a pending scan');
 check(recovered.body.item.estimates._enrichment.reason==='identity'&&!recovered.body.item.estimates.EU_used,'market source naming a different model cannot set a price');
 const {identifyVisually}=require('../lib/visual-search.ts');
 const actualFetch=global.fetch;
 const fixturePhoto=await require('sharp')(Buffer.from('<svg width="180" height="180"><rect width="180" height="180" fill="white"/><circle cx="90" cy="90" r="76" fill="#202020"/></svg>')).jpeg().toBuffer();
 try{
  global.fetch=async url=>{
   const address=new URL(url);
   if(address.pathname.includes('/collections/'))return Response.json({products:[{title:'Audi A4 Rear Bumper',handle:'test-part',images:[{src:'https://cdn.shopify.com/sample.jpg'}]}]});
   if(address.hostname==='cdn.shopify.com')return new Response(fixturePhoto,{headers:{'content-type':'image/jpeg'}});
   if(address.pathname.includes('/suggest.json'))return Response.json({resources:{results:{products:[]}}});
   throw Error('Unexpected reference request');
  };
  const compared=await identifyVisually(fixturePhoto,{models:['Audi Q5'],part:'rear bumper',side:'unknown'},[]);
  check(compared.match?.vehicle==='Audi A4','reference image can identify a model missing from the initial guesses without OEM');
 }finally{global.fetch=actualFetch;}
 await call('logout',{});check((await call('items')).status===401,'logout invalidates session');
 const r=await pool.query("SELECT has_schema_privilege('anon','parts_app','USAGE') AS allowed");check(r.rows[0].allowed===false,'public database schema access revoked');
 console.log(`${checks} integration checks passed.`);
}finally{await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
