import {vehicleCatalog} from '@/lib/vehicle-filters';
import {cachedScanFitment,scanFitment} from '@/lib/scan-fitment';
import {scanPart} from '@/lib/scan-part';
import {visualHints} from '@/lib/visual-search';
import {inventoryTerms} from '@/lib/inventory-search';
import {NextRequest,NextResponse,after} from 'next/server';
import {cookies} from 'next/headers';
import {z} from 'zod';
import sharp from 'sharp';
import {db,transaction} from '@/lib/db';
import {user,session,verify,hash,digest,rate} from '@/lib/auth';
import {categories,normalize} from '@/lib/shared';
import {enrichItem} from '@/lib/enrichment';
import {lookup} from '@/lib/lookup';
import {inventoryCsv,inventoryXlsx,inventoryPrint} from '@/lib/inventory-export';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const amount=z.coerce.number().finite().min(0).max(99999999);
const uuid=z.string().uuid();
const safeLink=z.url().refine(v=>v.startsWith('https://'));
const offerSchema=z.object({market:z.enum(['EU','BIH']),condition:z.enum(['new','used']),price:amount,currency:z.enum(['EUR','BAM']),url:safeLink});
const partSchema=z.object({visual_vehicle:z.string().trim().max(80).optional(),scan_entry:z.boolean().default(false),markings:z.array(z.string().trim().min(1).max(60)).max(15).default([]),enrich_after_save:z.boolean().default(false),part_number:z.string().trim().min(3).max(60).refine(v=>normalize(v).length>=3),name:z.string().trim().min(2).max(180),vehicle:z.string().trim().min(2).max(250),category:z.enum(categories),color:z.string().trim().max(60),owner_id:uuid,price:amount,estimates:z.partialRecord(z.enum(['EU_new','EU_used','BIH_new','BIH_used']),z.object({value:amount,count:z.number().int().min(0).max(1000),offers:z.array(offerSchema).max(100).optional(),basis:z.literal('verified_original_oem').optional(),confidence:z.enum(['single_offer','sample_average']).optional(),warning:z.string().max(200).optional()}).optional()).default({}),sources:z.array(z.object({title:z.string().max(200),url:safeLink})).max(12).default([])});
function makeThumbnail(bytes:Buffer){
 return sharp(bytes).resize(240,240,{fit:'inside',withoutEnlargement:true})
  .flatten({background:'#ffffff'}).jpeg({quality:75}).toBuffer();
}
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
 if(route!=='scan'&&!route.endsWith('/photos')&&!req.headers.get('content-type')?.startsWith('application/json'))fail('Očekivan JSON zahtjev.',415);
 }
 if(route==='health'&&method==='GET'){await db.query('SELECT 1');return json({ok:true,lookup_version:'parts-scan-1',mode:process.env.PARTS_LOCAL_PREVIEW==='1'?'local-preview':'supabase'});}
 if(route==='login'&&method==='POST'){
 const input=z.object({username:z.string().trim().min(1).max(50),password:z.string().min(1).max(128)}).parse(await body(req));
 await rate('login-user:'+input.username.toLowerCase(),8,900);
 const {rows}=await db.query('SELECT * FROM parts_app.users WHERE active AND lower(username)=lower($1)',[input.username]);
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
 if(route==='users'&&method==='GET'){return json((await db.query("SELECT id,username,must_change FROM parts_app.users WHERE active AND lower(username)<>'administrator' ORDER BY lower(username)")).rows);}
 if(route==='users'&&method==='POST'){
 const {username}=z.object({username:z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N} _.-]+$/u)}).parse(await body(req));
 if(['juso','almin'].includes(username.toLowerCase()))fail('Ovo korisničko ime je povučeno.',400);
 const row=await transaction(async c=>{const r=await c.query('INSERT INTO parts_app.users(username,password) VALUES($1,$2) RETURNING id,username',[username,hash(({irnes:'Irnes',alen:'Alen'} as Record<string,string>)[username.toLowerCase()]?.concat('1234')||'1234')]);await c.query("INSERT INTO parts_app.activity(user_id,action,details) VALUES($1,'user',$2)",[me.id,JSON.stringify({username})]);return r.rows[0];});return json(row,201);
 }
 if(route==='scan'&&method==='POST'){
  const visual=req.nextUrl.searchParams.get('mode')==='visual';
  await rate((visual?'visual-minute:':'scan-minute:')+me.id,15,60);
  const query=req.nextUrl.searchParams;
  const hints=visual&&query.has('part')?visualHints.parse({models:query.getAll('model'),part:query.get('part'),side:query.get('side')||'unknown'}):undefined;
  return json(await scanPart(await bounded(req,3_000_000),visual,hints));
 }
 if(route==='valuation'&&method==='GET'){
  const params=req.nextUrl.searchParams;
  const number=normalize(z.string().min(3).max(60).parse(params.get('number')));
  const id=params.get('id')?uuid.parse(params.get('id')):null;
  const name=(params.get('name')||'').trim().slice(0,180), vehicle=(params.get('vehicle')||'').trim().slice(0,250);
  const category=(params.get('category')||'').slice(0,100);
  const samples=await db.query(`SELECT normalized=$1 AS exact,status,
    CASE WHEN status='sold' THEN sold_price ELSE price END AS amount
    FROM parts_app.items WHERE ($2::uuid IS NULL OR id<>$2)
    AND COALESCE(estimates->>'_scan_fitment','')<>'pending'
    AND (normalized=$1 OR (status='sold' AND category=$5 AND lower(name)=lower($3) AND lower(vehicle)=lower($4)))
    AND CASE WHEN status='sold' THEN sold_price>0 AND sold_at>now()-interval '1 year'
             ELSE price>0 AND created_at>now()-interval '1 year' END
    ORDER BY (normalized=$1) DESC,(status='sold') DESC,coalesce(sold_at,created_at) DESC LIMIT 100`,
    [number,id,name,vehicle,category]);
  const groups=[
   {type:'sale',rows:samples.rows.filter(r=>r.exact&&r.status==='sold')},
   {type:'asking',rows:samples.rows.filter(r=>r.exact&&r.status==='available')},
   {type:'similar',rows:samples.rows.filter(r=>!r.exact&&r.status==='sold')}
  ];
  for(const group of groups){
   const prices=group.rows.map(r=>Number(r.amount)).sort((a,b)=>a-b);
   if(prices.length<(group.type==='similar'?3:1))continue;
   const middle=Math.floor(prices.length/2);
   const median=prices.length%2?prices[middle]:(prices[middle-1]+prices[middle])/2;
   return json({reference:{type:group.type,median,count:prices.length}});
  }
  return json({reference:null});
 }
 if(route==='lookup'&&method==='GET'){const number=z.string().trim().min(3).max(60).parse(req.nextUrl.searchParams.get('number'));if(req.nextUrl.searchParams.get('mode')==='scan')return json(await scanFitment(number,()=>rate('lookup-minute:'+me.id,20,60)));return json(await lookup(number,req.nextUrl.searchParams.get('refresh')==='1',req.nextUrl.searchParams.get('mode')!=='full',false,()=>rate('lookup-minute:'+me.id,20,60)));}
 if((route==='items'||route==='items/export')&&method==='GET'){
 const exporting=route==='items/export';
 const format=req.nextUrl.searchParams.get('format')||'xlsx';
 if(exporting&&!['xlsx','csv','print'].includes(format))fail('Nepoznat format izvoza.');
 const q=(req.nextUrl.searchParams.get('q')||'').slice(0,100);const status=req.nextUrl.searchParams.get('status')||'available';const cat=req.nextUrl.searchParams.get('category')||'';const owner=req.nextUrl.searchParams.get('owner')||'';if(owner)uuid.parse(owner);
 let page=Math.max(1,Math.min(100000,Number(req.nextUrl.searchParams.get('page'))||1));
 const sort:Record<string,string>={newest:'i.created_at DESC',name:'i.name ASC',price_asc:'i.price ASC',price_desc:'i.price DESC',number:'i.part_number ASC',sold:'i.sold_at DESC NULLS LAST'};
 const make=(req.nextUrl.searchParams.get('make')||'').slice(0,100);
 const model=(req.nextUrl.searchParams.get('model')||'').slice(0,100);
 const vehicles=(!exporting||make||model)?(await db.query("SELECT DISTINCT vehicle FROM parts_app.items WHERE vehicle<>''")).rows:[];
 const catalog=vehicleCatalog(vehicles.map((v:{vehicle:string})=>v.vehicle),make,model);
 const terms=inventoryTerms(q);
 const haystack="replace(translate(lower(concat_ws(' ',i.name,i.vehicle,i.category,i.color,i.normalized,i.estimates->>'_markings')),'čćšž','ccsz'),'đ','dj')";
 const where="WHERE ($1='' OR (length($2)>0 AND (strpos(i.normalized,$2)>0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(i.estimates->'_markings')='array' THEN i.estimates->'_markings' ELSE '[]'::jsonb END) mark WHERE strpos(regexp_replace(upper(mark),'[^A-Z0-9]','','g'),$2)>0))) OR (cardinality($6::text[])>0 AND NOT EXISTS (SELECT 1 FROM unnest($6::text[]) term WHERE NOT ("+haystack+" ~ term)))) AND ($3='all' OR i.status=$3) AND ($4='' OR i.category=$4) AND ($5='' OR i.owner_id::text=$5) AND ($7::text[] IS NULL OR i.vehicle=ANY($7::text[]))";
 const vals=[q,normalize(q),status,cat,owner,terms.map(group=>group.join('|')),make||model?catalog.matching:null];
 const requestedSort=req.nextUrl.searchParams.get('sort')||'newest';
 const order=(Object.hasOwn(sort,requestedSort)?sort[requestedSort]:sort.newest)+',i.id';
 const afterId=req.nextUrl.searchParams.get('after_id');
 let nextId:string|null=null;
 if(afterId&&!exporting){
  const position=await db.query(`SELECT next_id,position FROM (
   SELECT i.id,lead(i.id) OVER w AS next_id,row_number() OVER w AS position
   FROM parts_app.items i ${where} WINDOW w AS (ORDER BY ${order})
  ) ranked WHERE id=$8`,[...vals,uuid.parse(afterId)]);
  nextId=position.rows[0]?.next_id??null;
  if(!nextId)return json({nextId:null});
  page=Math.floor(Number(position.rows[0].position)/30)+1;
 }
 const rows=await db.query(`SELECT i.*,CASE WHEN lower(u.username)='administrator' THEN 'Interno' WHEN NOT u.active THEN 'Bivši korisnik' ELSE u.username END owner,CASE WHEN lower(cb.username)='administrator' THEN NULL WHEN NOT cb.active THEN 'Bivši korisnik' ELSE cb.username END creator,CASE WHEN lower(sb.username)='administrator' THEN NULL WHEN NOT sb.active THEN 'Bivši korisnik' ELSE sb.username END seller,COALESCE((SELECT json_agg(p.id ORDER BY p.created_at) FROM parts_app.photos p WHERE p.item_id=i.id),'[]') photos FROM parts_app.items i JOIN parts_app.users u ON u.id=i.owner_id JOIN parts_app.users cb ON cb.id=i.created_by LEFT JOIN parts_app.users sb ON sb.id=i.sold_by ${where} ORDER BY ${order} LIMIT ${exporting?20001:30} OFFSET $8`,[...vals,exporting?0:(page-1)*30]);
 if(exporting){
 if(rows.rows.length>20000)fail('Izvoz je ograničen na 20.000 artikala. Suzite filtere.',413);
 const filename='parts-skladiste-'+new Date().toISOString().slice(0,10);
 const scope=[status==='all'?'Svi artikli':status==='sold'?'Prodani artikli':'Dostupni artikli',cat,make,model,q?'Pretraga: '+q:'',owner?'Korisnik: '+(rows.rows[0]?.owner||'odabrani'):'Svi korisnici'].filter(Boolean).join(' / ');
 const content=format==='xlsx'?new Uint8Array(inventoryXlsx(rows.rows)):format==='csv'?inventoryCsv(rows.rows):inventoryPrint(rows.rows,scope);
 return new NextResponse(content,{headers:{'Content-Type':format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':format==='csv'?'text/csv; charset=utf-8':'application/pdf','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="${filename}.${format==='print'?'pdf':format}"`}});
 }
 const count=await db.query(`SELECT count(*) FROM parts_app.items i ${where}`,vals);return json({items:rows.rows,total:Number(count.rows[0].count),page,nextId,vehicleOptions:catalog.options});
 }
 if(route==='items'&&method==='POST'){
 const input=partSchema.parse(await body(req));
 let scanStatus:string|undefined;
 if(input.scan_entry){
  const evidence=input.enrich_after_save?await cachedScanFitment(input.part_number):null;
  const verified=evidence?.verified&&evidence.vehicle===input.vehicle&&evidence.name===input.name&&evidence.category===input.category;
  scanStatus=verified?'verified':'pending';
  if(!verified)input.vehicle='Vozilo nije utvrđeno';
  input.enrich_after_save=Boolean(verified);
  input.estimates={};input.sources=verified?evidence.sources:[];
 }

 const recipient=await db.query("SELECT id FROM parts_app.users WHERE active AND id=$1 AND (lower(username)<>'administrator' OR id=$2)",[input.owner_id,me.id]);
 if(!recipient.rows[0])fail('Odabrani korisnik nije dostupan.',400);
 const row=await transaction(async c=>{const r=await c.query('INSERT INTO parts_app.items(part_number,normalized,name,vehicle,color,category,owner_id,price,estimates,sources,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[input.part_number,normalize(input.part_number),input.name,input.vehicle,input.color,input.category,input.owner_id,input.price,JSON.stringify({...input.estimates,...(scanStatus?{_scan_fitment:scanStatus}:{}),...(scanStatus==='pending'&&input.visual_vehicle?{_visual_vehicle:input.visual_vehicle}:{}),...(scanStatus==='verified'?{_fitment_sources:input.sources}:{}),...(input.markings.length?{_markings:input.markings}:{}),...(input.enrich_after_save?{_enrichment:{status:'pending',updated_at:new Date().toISOString()}}:{})}),JSON.stringify(input.sources),me.id]);await c.query("INSERT INTO parts_app.activity(user_id,item_id,action,details) VALUES($1,$2,'created',$3)",[me.id,r.rows[0].id,JSON.stringify({name:input.name,part_number:input.part_number,price:input.price})]);return r.rows[0];});if(input.enrich_after_save)after(()=>enrichItem(row.id));return json(row,201);
 }
 if(path.length===3&&path[0]==='items'&&path[2]==='enrich'&&method==='POST'){
 const id=uuid.parse(path[1]);const options=z.object({wait:z.boolean().default(false),confirmed_oem:z.string().trim().min(3).max(60).optional()}).parse(await body(req));await rate('manual-enrich-minute:'+me.id,15,60);
 const existing=(await db.query('SELECT estimates,category,status FROM parts_app.items WHERE id=$1 AND (owner_id=$2 OR created_by=$2)',[id,me.id])).rows[0];
 if(!existing)fail('Obrada je već u toku ili artikal nije kod vas.',409);
 if(existing.estimates?._scan_fitment==='pending'){
  if(!options.confirmed_oem||normalize(options.confirmed_oem).length<3)fail('Za procjenu prvo potvrdi OEM broj na dijelu.',409);
  const proof=await scanFitment(options.confirmed_oem!,()=>rate('lookup-minute:'+me.id,20,60));
  if(!proof.verified)fail('Katalog nije potvrdio model za taj OEM broj.',422);
  if(existing.category!=='Ostali dijelovi'&&existing.category!==proof.category)fail('Kategorija u katalogu se razlikuje od evidentiranog dijela. Provjeri oznaku i stranu.',409);
  const promoted=await db.query("UPDATE parts_app.items SET vehicle=$2,part_number=$3,normalized=$4,sources=$5::jsonb,estimates=estimates || $6::jsonb WHERE id=$1 AND estimates->>'_scan_fitment'='pending' AND (owner_id=$7 OR created_by=$7) RETURNING id",[id,proof.vehicle,options.confirmed_oem,normalize(options.confirmed_oem!),JSON.stringify(proof.sources),JSON.stringify({_scan_fitment:'verified',_fitment_sources:proof.sources}),me.id]);
  if(!promoted.rows.length)fail('Artikal je izmijenjen. Osvježi prikaz.',409);
 }
 const r=await db.query("UPDATE parts_app.items SET estimates=jsonb_set(estimates,'{_enrichment}', COALESCE(estimates->'_enrichment','{}'::jsonb) || $2::jsonb) WHERE id=$1 AND (owner_id=$3 OR created_by=$3) AND (COALESCE(estimates->'_enrichment'->>'status','') NOT IN ('pending','running') OR (estimates->'_enrichment'->>'updated_at')::timestamptz < now()-interval '2 minutes') RETURNING id",[id,JSON.stringify({status:'pending',updated_at:new Date().toISOString()}),me.id]);
 if(!r.rows[0])fail('Obrada je već u toku ili artikal nije kod vas.',409);
 if(options.wait){await enrichItem(id,true);const item=(await db.query('SELECT id,vehicle,part_number,estimates,sources FROM parts_app.items WHERE id=$1',[id])).rows[0];return json({ok:true,item});}
 after(()=>enrichItem(id,true));return json({ok:true},202);
 }
 if(path.length===3&&path[0]==='items'&&path[2]==='price'&&method==='POST'){
  const id=uuid.parse(path[1]);
  const priceValue=z.number().finite().min(0).max(99999999).multipleOf(0.01);
  const input=z.object({price:priceValue,expected_price:priceValue}).parse(await body(req));
  await transaction(async c=>{
   const item=(await c.query('SELECT price,status,owner_id FROM parts_app.items WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!item)fail('Artikal ne postoji.',404);
   if(item.owner_id!==me.id)fail('Cijenu može promijeniti korisnik kod kojeg je artikal.',403);
   if(item.status!=='available')fail('Artikal je već prodan.',409);
   if(Number(item.price)===input.price)return;
   if(Number(item.price)!==input.expected_price)fail('Cijena se u međuvremenu promijenila. Provjerite trenutni iznos.',409);
   await c.query('UPDATE parts_app.items SET price=$1 WHERE id=$2',[input.price,id]);
   await c.query("INSERT INTO parts_app.activity(user_id,item_id,action,details) VALUES($1,$2,'price',$3)",[me.id,id,JSON.stringify({previous_price:Number(item.price),price:input.price})]);
  });
  return json({price:input.price});
 }
 if(path.length===3&&path[0]==='items'&&path[2]==='owner'&&method==='POST'){
 const id=uuid.parse(path[1]);const input=z.object({owner_id:uuid,expected_owner_id:uuid}).parse(await body(req));
 if(input.owner_id!==me.id)fail('Objavljeni artikal možete označiti samo kod sebe.',403);
 await transaction(async c=>{
 const previous=(await c.query('SELECT owner_id,status FROM parts_app.items WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(!previous)fail('Artikal ne postoji.',404);
 if(previous.status!=='available')fail('Korisnik prodanog artikla se ne mijenja.',409);
 if(previous.owner_id===me.id)return;
 if(previous.owner_id!==input.expected_owner_id)fail('Korisnik artikla je u medjuvremenu promijenjen. Osvjezite listu.',409);
 await c.query('UPDATE parts_app.items SET owner_id=$1 WHERE id=$2',[me.id,id]);
 await c.query("INSERT INTO parts_app.activity(user_id,item_id,action,details) VALUES($1,$2,'owner',$3)",[me.id,id,JSON.stringify({previous_owner_id:previous.owner_id,owner_id:me.id})]);
 });return json({ok:true,owner_id:me.id,owner:me.username});
 }
 if(path[0]==='items'&&path[2]==='sell'&&method==='POST'){
 const id=uuid.parse(path[1]);const {price}=z.object({price:amount}).parse(await body(req));
 await transaction(async c=>{const r=await c.query("UPDATE parts_app.items SET status='sold',sold_price=$1,sold_by=$2,sold_at=now() WHERE id=$3 AND owner_id=$2 AND status='available' RETURNING name,part_number",[price,me.id,id]);if(!r.rows[0])fail('Dio je već prodan ili ne postoji.',409);await c.query("INSERT INTO parts_app.activity(user_id,item_id,action,details) VALUES($1,$2,'sold',$3)",[me.id,id,JSON.stringify({...r.rows[0],price})]);});return json({ok:true});
 }
 if(path[0]==='items'&&path[2]==='photos'&&method==='POST'){
 const id=uuid.parse(path[1]);if(Number(req.headers.get('content-length'))>4_000_000)fail('Fotografija je prevelika. Maksimalno 3 MB.',413);
 const bytesIn=await bounded(req,4_000_000);const parsedRequest=new Request(req.url,{method:'POST',headers:{'Content-Type':req.headers.get('content-type')||''},body:new Uint8Array(bytesIn)});const form=await parsedRequest.formData();const file=form.get('photo');if(!(file instanceof File)||file.size>3_000_000)fail('Odaberite sliku do 3 MB.');
 let bytes:Buffer, thumbnail:Buffer;
 try {
  bytes=await sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:40_000_000})
   .rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true})
   .flatten({background:'#ffffff'}).jpeg({quality:86}).toBuffer();
  thumbnail=await makeThumbnail(bytes);
 } catch {fail('Format slike nije podržan. Koristite JPG, PNG ili WebP.');}
 const result=await transaction(async c=>{const item=await c.query('SELECT status FROM parts_app.items WHERE id=$1 FOR UPDATE',[id]);if(!item.rows[0])fail('Artikal ne postoji.',404);if(item.rows[0].status!=='available')fail('Fotografije prodanog artikla se ne mijenjaju.',409);const count=await c.query('SELECT count(*) FROM parts_app.photos WHERE item_id=$1',[id]);if(Number(count.rows[0].count)>=3)fail('Dozvoljene su najviše 3 fotografije.',409);const r=await c.query('INSERT INTO parts_app.photos(item_id,bytes,mime,thumbnail) VALUES($1,$2,$3,$4) RETURNING id',[id,bytes!,'image/jpeg',thumbnail!]);await c.query("INSERT INTO parts_app.activity(user_id,item_id,action) VALUES($1,$2,'photo')",[me.id,id]);return r.rows[0];});return json(result,201);
 }
 if(path[0]==='photos'&&method==='GET'){
 const id=uuid.parse(path[1]);
 const download=req.nextUrl.searchParams.has('download');
 const thumb=!download&&req.nextUrl.searchParams.get('size')==='thumb';
 const etag='"photo-v1-'+id+(thumb?'-thumb':'-full')+'"';
 const headers={'Cache-Control':'private, no-cache',ETag:etag,'X-Content-Type-Options':'nosniff'};
 if(req.headers.get('if-none-match')===etag)return new NextResponse(null,{status:304,headers});
 const result=thumb
  ? await db.query('SELECT thumbnail AS bytes FROM parts_app.photos WHERE id=$1',[id])
  : await db.query('SELECT bytes,mime FROM parts_app.photos WHERE id=$1',[id]);
 const photo=result.rows[0];
 if(!photo)fail('Slika nije pronađena.',404);
 if(thumb&&!photo.bytes){
  const legacy=await db.query('SELECT bytes FROM parts_app.photos WHERE id=$1',[id]);
  photo.bytes=await makeThumbnail(legacy.rows[0].bytes);
  await db.query('UPDATE parts_app.photos SET thumbnail=$2 WHERE id=$1 AND thumbnail IS NULL',[id,photo.bytes]);
 }
 const mime=thumb?'image/jpeg':photo.mime;
 const extension=mime==='image/jpeg'?'jpg':'webp';
 return new NextResponse(photo.bytes,{headers:{...headers,'Content-Type':mime,'Content-Disposition':download?'attachment; filename="dio-'+id+'.'+extension+'"':'inline'}});
 }
 if(route==='stats'&&method==='GET'){
 // Market estimates are stored in KM for both regions. Each available physical item contributes once.
 const r=await db.query(`WITH priced AS (
   SELECT normalized,status,price,sold_price,COALESCE(estimates->>'_scan_fitment','')<>'pending' AS eligible,
    CASE WHEN estimates->'BIH_used'->>'basis'='verified_original_oem' AND jsonb_typeof(estimates->'BIH_used'->'value')='number'
         THEN (estimates->'BIH_used'->>'value')::numeric END AS bih,
    CASE WHEN estimates->'EU_used'->>'basis'='verified_original_oem' AND jsonb_typeof(estimates->'EU_used'->'value')='number'
         THEN (estimates->'EU_used'->>'value')::numeric END AS eu
   FROM parts_app.items
 ), comparable AS (
   SELECT normalized,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY bih) FILTER (WHERE bih>0) AS bih_reference,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY sold_price) FILTER (WHERE status='sold' AND sold_price>0) AS sale_reference,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY eu) FILTER (WHERE eu>0) AS eu_reference
   FROM priced WHERE eligible AND normalized<>'' GROUP BY normalized
 ), valued AS (
   SELECT p.*,CASE WHEN eligible THEN round(COALESCE(CASE WHEN bih>0 THEN bih END,bih_reference,sale_reference,
      CASE WHEN eu>0 THEN eu END,eu_reference)::numeric,2) END AS estimated
   FROM priced p LEFT JOIN comparable USING (normalized)
 )
 SELECT count(*) FILTER (WHERE status='available') available, count(*) FILTER (WHERE status='sold') sold,
  COALESCE(sum(sold_price) FILTER (WHERE status='sold'),0) revenue,
  COALESCE(sum(price) FILTER (WHERE status='available'),0) asking_total,
  COALESCE(sum(estimated) FILTER (WHERE status='available'),0) inventory,
  count(estimated) FILTER (WHERE status='available') valued_count,
  count(*) FILTER (WHERE status='available' AND estimated IS NULL) missing
 FROM valued`);
 const cats=await db.query("SELECT category,count(*) FROM parts_app.items WHERE status='available' GROUP BY category ORDER BY category");const costs=(await db.query('SELECT goods,transport FROM parts_app.costs WHERE id=1')).rows[0];return json({...r.rows[0],categories:cats.rows,costs,profit:Number(r.rows[0].revenue)-Number(costs.goods)-Number(costs.transport)});
 }
 if(route==='costs'&&method==='POST'){
 const input=z.object({goods:amount,transport:amount}).parse(await body(req));await transaction(async c=>{await c.query('UPDATE parts_app.costs SET goods=$1,transport=$2 WHERE id=1',[input.goods,input.transport]);await c.query("INSERT INTO parts_app.activity(user_id,action,details) VALUES($1,'costs',$2)",[me.id,JSON.stringify(input)]);});return json({ok:true});
 }
 if(route==='activity'&&method==='GET')return json((await db.query(`SELECT a.*,u.username,i.name,i.part_number FROM parts_app.activity a JOIN parts_app.users u ON u.id=a.user_id LEFT JOIN parts_app.items i ON i.id=a.item_id WHERE u.active AND lower(u.username)<>'administrator' AND NOT EXISTS (SELECT 1 FROM parts_app.users retired WHERE NOT retired.active AND lower(retired.username)=lower(a.details->>'username')) ORDER BY a.created_at DESC LIMIT 50`)).rows);
 fail('Nije pronađeno.',404);
 }catch(e:any){if(e instanceof z.ZodError)return json({error:'Provjerite unesene podatke. Obavezna polja, cijene i format moraju biti ispravni.'},400);if(e.code==='23505')return json({error:'Korisničko ime već postoji.'},409);if(e.code==='23503')return json({error:'Odabrani korisnik ili artikal ne postoji.'},400);if(e.status)return json({error:e.message},e.status);console.error('Parts API error:',e.code||e.name);return json({error:'Veza s bazom ili servisom trenutno nije dostupna. Pokušajte ponovo.'},503);}
}
export {handle as GET,handle as POST};
