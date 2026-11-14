import https from 'node:https';
import sharp from 'sharp';
import {gunzipSync,brotliDecompressSync,inflateSync} from 'node:zlib';
import {lookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {normalize} from './shared';

const blocked=new BlockList(),blocked6=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked.addSubnet(address,prefix,'ipv4');
for(const [address,prefix] of [['::',128],['::1',128],['::ffff:0:0',96],['fc00::',7],['fe80::',10],['ff00::',8],['2001::',32],['2001:db8::',32],['2002::',16]] as const)blocked6.addSubnet(address,prefix,'ipv6');
export function publicAddress(address:string){const family=isIP(address);return family!==0&&(family!==6||/^[23]/.test(address))&&!(family===4?blocked.check(address,'ipv4'):blocked6.check(address,'ipv6'));}
const decode=(s:string)=>s.replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi,m=>{const names:Record<string,string>={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};if(names[m.toLowerCase()])return names[m.toLowerCase()];const n=parseInt(m.slice(m[2].toLowerCase()==='x'?3:2,-1),m[2].toLowerCase()==='x'?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';});
const text=(s:string)=>decode(s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
function imageUrl(value:unknown,base:string){try{const u=new URL(String(value),base);return u.protocol==='https:'&&!u.username&&!u.password&&!/(?:logo|placeholder|no[-_]image|favicon)/i.test(u.pathname)?u.href:'';}catch{return '';}}
export function parseProductPage(html:string,url:string,number:string){
 const meta:Record<string,string>={};
 for(const match of html.matchAll(/<meta\b[^>]*>/gi)){const attrs:Record<string,string>={};for(const a of match[0].matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g))attrs[a[1].toLowerCase()]=decode(a[3]);const key=attrs.property||attrs.name;if(key)meta[key.toLowerCase()]=attrs.content||'';}
 const title=meta['og:title']||text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');
 const exact=(s:unknown)=>new RegExp('(?<![A-Z0-9])'+normalize(number).split('').join('[\\s-]*')+'(?![A-Z0-9])','i').test(String(s||''));
 const products:any[]=[];
 const walk=(v:any,depth=0)=>{if(!v||depth>5)return;if(Array.isArray(v))return v.forEach(x=>walk(x,depth+1));if(typeof v!=='object')return;if([v['@type']].flat().includes('Product'))products.push(v);if(v['@graph'])walk(v['@graph'],depth+1);if(v.mainEntity)walk(v.mainEntity,depth+1);};
 for(const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(JSON.parse(script[1]));}catch{}}
 const product=products.find(p=>[p.mpn,p.sku,p.productID].some(v=>normalize(String(v||''))===normalize(number))||exact(p.name));
 // No broad body-text match: category pages often mention unrelated OEM numbers.
 if(!product&&!exact(title))return null;
 const description=product?text(String(product.description||'')):meta['og:description']||meta.description||'';
 const images=(product?.image?[product.image].flat().map(im=>typeof im==='object'?im?.url:im):[meta['og:image']]).map(im=>imageUrl(im,url)).filter(Boolean).slice(0,3);
 const structuredOffers=product?[product.offers].flat().filter(Boolean):[];
 return {url,title:String(product?.name||title),description,text:text(html).slice(0,120000),images,structuredOffers};
}
async function loadPublicResource(url:string,image=false){
 const deadline=Date.now()+8000;
 async function get(current:string,redirects=0):Promise<{bytes:Buffer,url:string}>{
 const u=new URL(current);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||isIP(u.hostname))throw Error('Unsupported address');
 const addresses=await lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('Non-public address');
 const address=addresses[0];const remaining=deadline-Date.now();if(remaining<=0)throw Error('Page timeout');
 return new Promise((resolve,reject)=>{
 const req=https.get(u,{headers:{Accept:image?'image/avif,image/webp,image/*':'text/html','Accept-Encoding':'gzip, br, deflate','User-Agent':'PartsInventory/1.0'},lookup:((_host:any,options:any,callback:any)=>{if(options?.all)callback(null,[address]);else callback(null,address.address,address.family);}) as any},res=>{
 if(res.statusCode&&res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();if(redirects>=3)return reject(Error('Redirect limit'));get(new URL(res.headers.location,u).href,redirects+1).then(resolve,reject);return;}
 if(res.statusCode!==200||!(image?String(res.headers['content-type']).startsWith('image/'):String(res.headers['content-type']).includes('text/html'))){res.resume();return reject(Error('Unavailable product page'));}
 let size=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>(image?3000000:1500000)){req.destroy(Error('Page too large'));return;}chunks.push(chunk);});res.on('end',()=>{try{let bytes=Buffer.concat(chunks);const encoding=res.headers['content-encoding'];const options={maxOutputLength:3000000};if(encoding==='gzip')bytes=gunzipSync(bytes,options);else if(encoding==='br')bytes=brotliDecompressSync(bytes,options);else if(encoding==='deflate')bytes=inflateSync(bytes,options);else if(encoding&&encoding!=='identity')throw Error('Unsupported encoding');resolve({bytes,url:u.href});}catch(e){reject(e);}});res.on('error',reject);
 });req.setTimeout(remaining,()=>req.destroy(Error('Page timeout')));req.on('error',reject);
 });
 }
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([get(url).catch(()=>null),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),8000);})]);}finally{clearTimeout(timer);}
}

export async function loadProductPage(url:string,number:string){const result=await loadPublicResource(url);return result?parseProductPage(result.bytes.toString('utf8'),result.url,number):null;}
export async function loadReferenceImage(url:string){
 const result=await loadPublicResource(url,true);if(!result)return null;
 try{const info=await sharp(result.bytes,{limitInputPixels:40000000}).metadata();return info.width&&info.height&&info.width>=160&&info.height>=100&&['jpeg','png','webp','avif','heif'].includes(info.format||'')?result.url:null;}catch{return null;}
}
