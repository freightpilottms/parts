import {NextRequest,NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {z} from 'zod';
import sharp from 'sharp';
import {db,transaction} from '@/lib/db';
import {user,session,verify,hash,digest,rate} from '@/lib/auth';
import {categories,normalize} from '@/lib/shared';
import {lookup} from '@/lib/lookup';
import {inventoryCsv,inventoryXlsx,inventoryPrint} from '@/lib/inventory-export';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const amount=z.coerce.number().finite().min(0).max(99999999);
const uuid=z.string().uuid();
const safeLink=z.url().refine(v=>v.startsWith('https://'));
const offerSchema=z.object({market:z.enum(['EU','BIH']),condition:z.enum(['new','used']),price:amount,currency:z.enum(['EUR','BAM']),url:safeLink});
const partSchema=z.object({part_number:z.string().trim().min(3).max(60).refine(v=>normalize(v).length>=3),name:z.string().trim().min(2).max(180),vehicle:z.string().trim().min(2).max(250),category:z.enum(categories),color:z.string().trim().max(60),owner_id:uuid,price:amount,estimates:z.partialRecord(z.enum(['EU_new','EU_used','BIH_new','BIH_used']),z.object({value:amount,count:z.number().int().min(0).max(1000),offers:z.array(offerSchema).max(100).optional()}).optional()).default({}),sources:z.array(z.object({title:z.string().max(200),url:safeLink})).max(12).default([])});
function fail(message:string,status=400):never{throw Object.assign(Error(message),{status});}
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
async function bounded(req:NextRequest,limit:number){if(Number(req.headers.get('content-length'))>limit)fail('Zahtjev je prevelik.',413);const reader=req.body?.getReader();if(!reader)return Buffer.alloc(0);let size=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail('Zahtjev je prevelik.',413);}chunks.push(value);}return Buffer.concat(chunks);}
async function body(req:NextRequest){const bytes=await bounded(req,50000);try{return JSON.parse(bytes.toString('utf8'));}catch{fail('Neispravan zahtjev.');}}
async function handle(req:NextRequest,{params}:{params:Promise<{path:string[]}>}){
 try{
 const {path}=await params;const route=path.join('/');const method=req.method;
 if(method!=='GET'){
 const origin=req.headers.get('origin');const expected=new URL(process.env.APP_ORIGIN||req.url).origin;
 if(!origin||origin!==expected)fail('Zahtjev nije dozvoljen s ove adrese.',403);
 if(!route.endsWith('/photos')&&!req.headers.get('content-type')?.startsWith('application/json'))fail('Očekivan JSON zahtjev.',415);
 }
 if(route==='health'&&method==='GET'){await db.query('SELECT 1');return json({ok:true,mode:process.env.PARTS_LOCAL_PREVIEW==='1'?'local-preview':'supabase'});}
 if(route==='login'&&method==='POST'){
 const input=z.object({username:z.string().trim().min(1).max(50),password:z.string().min(1).max(128)}).parse(await body(req));
 await rate('login-user:'+input.username.toLowerCase(),8,900);
 const {rows}=await db.query('SELECT * FROM parts_app.users WHERE lower(username)=lower($1)',[input.username]);
 if(!rows[0]||!verify(input.password,rows[0].password))fail('Korisničko ime ili lozinka nisu ispravni.',401);
 await session(rows[0].id);return json({id:rows[0].id,username:rows[0].username,must_change:rows[0].must_change});
 }
 const me=await user();if(!me)fail('Prijavite se za nastavak.',401);
 if(route==='me'&&method==='GET')return json(me);
 if(route==='logout'&&method==='POST'){const cookie=(await cookies()).get('parts_session')?.value;if(cookie)await db.query('DELETE FROM parts_app.sessions WHERE token=$1',[digest(cookie)]);(await cookies()).delete('parts_session');return json({ok:true});}
 if(route==='password'&&method==='POST'){
 const {password,current}=z.object({password:z.string().min(6).max(128),current:z.string().max(128)}).parse(await body(req));
 await rate('password:'+me.id,8,900);
 const {rows}=await db.query('SELECT password FROM parts_app.users WHERE id=$1',[me.id]);if(!verify(current,rows[0].password))fail('Trenutna lozinka nije ispravna.',403);
 await transaction(async c=>{await c.query('UPDATE parts_app.users SET password=$1,must_change=false WHERE id=$2',[hash(password),me.id]);await c.query('DELETE FROM parts_app.sessions WHERE user_id=$1',[me.id]);});await session(me.id);return json({ok:true});
 }
 if(me.must_change)fail('Prvo promijenite početnu lozinku.',403);
 if(route==='users'&&method==='GET'){return json((await db.query("SELECT id,username,must_change FROM parts_app.users WHERE lower(username)<>'administrator' ORDER BY lower(username)")).rows);}
 if(route==='users'&&method==='POST'){
 const {username}=z.object({username:z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N} _.-]+$/u)}).parse(await body(req));
 const row=await transaction(async c=>{const r=await c.query('INSERT INTO parts_app.users(username,password) VALUES($1,$2) RETURNING id,username',[username,hash('1234')]);await c.query("INSERT INTO parts_app.activity(user_id,action,details) VALUES($1,'user',$2)",[me.id,JSON.stringify({username})]);return r.rows[0];});return json(row,201);
 }
 if(route==='lookup'&&method==='GET'){await rate('lookup:'+me.id,30,3600);const number=z.string().trim().min(3).max(60).parse(req.nextUrl.searchParams.get('number'));return json(await lookup(number));}
 if((route==='items'||route==='items/export')&&method==='GET'){
 const exporting=route==='items/export';
 const format=req.nextUrl.searchParams.get('format')||'xlsx';
 if(exporting&&!['xlsx','csv','print'].includes(format))fail('Nepoznat format izvoza.');
 const q=(req.nextUrl.searchParams.get('q')||'').slice(0,100);const status=req.nextUrl.searchParams.get('status')||'available';const cat=req.nextUrl.searchParams.get('category')||'';const owner=req.nextUrl.searchParams.get('owner')||'';if(owner)uuid.parse(owner);
 const page=Math.max(1,Math.min(100000,Number(req.nextUrl.searchParams.get('page'))||1));
 const sort:Record<string,string>={newest:'i.created_at DESC',name:'i.name ASC',price_asc:'i.price ASC',price_desc:'i.price DESC',number:'i.part_number ASC',sold:'i.sold_at DESC NULLS LAST'};
 const where="WHERE ($1='' OR i.name ILIKE '%'||$1||'%' OR i.vehicle ILIKE '%'||$1||'%' OR i.normalized LIKE '%'||$2||'%') AND ($3='all' OR i.status=$3) AND ($4='' OR i.category=$4) AND ($5='' OR i.owner_id::text=$5)";
 const vals=[q,normalize(q)||'__',status,cat,owner];
 const rows=await db.query(`SELECT i.*,CASE WHEN lower(u.username)='administrator' THEN 'Interno' ELSE u.username END owner,CASE WHEN lower(cb.username)='administrator' THEN NULL ELSE cb.username END creator,CASE WHEN lower(sb.username)='administrator' THEN NULL ELSE sb.username END seller,COALESCE((SELECT json_agg(p.id ORDER BY p.created_at) FROM parts_app.photos p WHERE p.item_id=i.id),'[]') photos FROM parts_app.items i JOIN parts_app.users u ON u.id=i.owner_id JOIN parts_app.users cb ON cb.id=i.created_by LEFT JOIN parts_app.users sb ON sb.id=i.sold_by ${where} ORDER BY ${sort[req.nextUrl.searchParams.get('sort')||'']||sort.newest},i.id LIMIT ${exporting?20001:30} OFFSET $6`,[...vals,exporting?0:(page-1)*30]);
 if(exporting){
 if(rows.rows.length>20000)fail('Izvoz je ogranicen na 20.000 artikala. Suzite filtere.',413);
 const filename='parts-skladiste-'+new Date().toISOString().slice(0,10);
 const scope=[status==='all'?'Svi artikli':status==='sold'?'Prodani artikli':'Dostupni artikli',cat,q?'Pretraga: '+q:'',owner?'Korisnik: '+(rows.rows[0]?.owner||'odabrani'):'Svi korisnici'].filter(Boolean).join(' / ');
 const content=format==='xlsx'?new Uint8Array(inventoryXlsx(rows.rows)):format==='csv'?inventoryCsv(rows.rows):inventoryPrint(rows.rows,scope);
 return new NextResponse(content,{headers:{'Content-Type':format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':format==='csv'?'text/csv; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':format==='print'?'inline':`attachment; filename="${filename}.${format}"`}});
 }
 const count=await db.query(`SELECT count(*) FROM parts_app.items i ${where}`,vals);return json({items:rows.rows,total:Number(count.rows[0].count),page});
 }
 if(route==='items'&&method==='POST'){
 const input=partSchema.parse(await body(req));
 if(input.owner_id!==me.id)fail('Artikal mozete dodijeliti samo sebi.',403);
 const row=await transaction(async c=>{const r=await c.query('INSERT INTO parts_app.items(part_number,normalized,name,vehicle,color,category,owner_id,price,estimates,sources,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[input.part_number,normalize(input.part_number),input.name,input.vehicle,input.color,input.category,input.owner_id,input.price,JSON.stringify(input.estimates),JSON.stringify(input.sources),me.id]);await c.query("INSERT INTO parts_app.activity(user_id,item_id,action,details) VALUES($1,$2,'created',$3)",[me.id,r.rows[0].id,JSON.stringify({name:input.name,part_number:input.part_number,price:input.price})]);return r.rows[0];});return json(row,201);
 }
 if(path[0]==='items'&&path[2]==='sell'&&method==='POST'){
 const id=uuid.parse(path[1]);const {price}=z.object({price:amount}).parse(await body(req));
 await transaction(async c=>{const r=await c.query("UPDATE parts_app.items SET status='sold',sold_price=$1,sold_by=$2,sold_at=now() WHERE id=$3 AND owner_id=$2 AND status='available' RETURNING name,part_number",[price,me.id,id]);if(!r.rows[0])fail('Dio je već prodan ili ne postoji.',409);await c.query("INSERT INTO parts_app.activity(user_id,item_id,action,details) VALUES($1,$2,'sold',$3)",[me.id,id,JSON.stringify({...r.rows[0],price})]);});return json({ok:true});
 }
 if(path[0]==='items'&&path[2]==='photos'&&method==='POST'){
 const id=uuid.parse(path[1]);if(Number(req.headers.get('content-length'))>4_000_000)fail('Fotografija je prevelika. Maksimalno 3 MB.',413);
 const bytesIn=await bounded(req,4_000_000);const parsedRequest=new Request(req.url,{method:'POST',headers:{'Content-Type':req.headers.get('content-type')||''},body:new Uint8Array(bytesIn)});const form=await parsedRequest.formData();const file=form.get('photo');if(!(file instanceof File)||file.size>3_000_000)fail('Odaberite sliku do 3 MB.');
 let bytes:Buffer;try{bytes=await sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:40_000_000}).rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer();}catch{fail('Format slike nije podržan. Koristite JPG, PNG ili WebP.');}
 const result=await transaction(async c=>{const item=await c.query('SELECT status FROM parts_app.items WHERE id=$1 FOR UPDATE',[id]);if(!item.rows[0])fail('Artikal ne postoji.',404);if(item.rows[0].status!=='available')fail('Fotografije prodanog artikla se ne mijenjaju.',409);const count=await c.query('SELECT count(*) FROM parts_app.photos WHERE item_id=$1',[id]);if(Number(count.rows[0].count)>=3)fail('Dozvoljene su najviše 3 fotografije.',409);const r=await c.query('INSERT INTO parts_app.photos(item_id,bytes) VALUES($1,$2) RETURNING id',[id,bytes!]);await c.query("INSERT INTO parts_app.activity(user_id,item_id,action) VALUES($1,$2,'photo')",[me.id,id]);return r.rows[0];});return json(result,201);
 }
 if(path[0]==='photos'&&method==='GET'){
 const id=uuid.parse(path[1]);const r=await db.query('SELECT bytes,mime FROM parts_app.photos WHERE id=$1',[id]);if(!r.rows[0])fail('Slika nije pronađena.',404);return new NextResponse(r.rows[0].bytes,{headers:{'Content-Type':'image/webp','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':req.nextUrl.searchParams.has('download')?`attachment; filename="dio-${id}.webp"`:'inline'}});
 }
 if(route==='stats'&&method==='GET'){
 const r=await db.query(`SELECT count(*) FILTER(WHERE status='available') available,count(*) FILTER(WHERE status='sold') sold,COALESCE(sum(sold_price) FILTER(WHERE status='sold'),0) revenue,COALESCE(sum(COALESCE((estimates->'BIH_used'->>'value')::numeric,(estimates->'EU_used'->>'value')::numeric)) FILTER(WHERE status='available'),0) inventory,count(*) FILTER(WHERE status='available' AND NOT(estimates ? 'BIH_used' OR estimates ? 'EU_used')) missing FROM parts_app.items`);
 const cats=await db.query("SELECT category,count(*) FROM parts_app.items WHERE status='available' GROUP BY category ORDER BY category");const costs=(await db.query('SELECT goods,transport FROM parts_app.costs WHERE id=1')).rows[0];return json({...r.rows[0],categories:cats.rows,costs,profit:Number(r.rows[0].revenue)-Number(costs.goods)-Number(costs.transport)});
 }
 if(route==='costs'&&method==='POST'){
 const input=z.object({goods:amount,transport:amount}).parse(await body(req));await transaction(async c=>{await c.query('UPDATE parts_app.costs SET goods=$1,transport=$2 WHERE id=1',[input.goods,input.transport]);await c.query("INSERT INTO parts_app.activity(user_id,action,details) VALUES($1,'costs',$2)",[me.id,JSON.stringify(input)]);});return json({ok:true});
 }
 if(route==='activity'&&method==='GET')return json((await db.query(`SELECT a.*,u.username,i.name,i.part_number FROM parts_app.activity a JOIN parts_app.users u ON u.id=a.user_id LEFT JOIN parts_app.items i ON i.id=a.item_id WHERE lower(u.username)<>'administrator' ORDER BY a.created_at DESC LIMIT 50`)).rows);
 fail('Nije pronađeno.',404);
 }catch(e:any){if(e instanceof z.ZodError)return json({error:'Provjerite unesene podatke. Obavezna polja, cijene i format moraju biti ispravni.'},400);if(e.code==='23505')return json({error:'Korisničko ime već postoji.'},409);if(e.code==='23503')return json({error:'Odabrani korisnik ili artikal ne postoji.'},400);if(e.status)return json({error:e.message},e.status);console.error('Parts API error:',e.code||e.name);return json({error:'Veza s bazom ili servisom trenutno nije dostupna. Pokušajte ponovo.'},503);}
}
export {handle as GET,handle as POST};
