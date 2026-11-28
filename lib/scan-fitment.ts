import {db} from './db';
import {normalize} from './shared';
import {loadProductPage} from './product-page';
import {geminiLookup} from './gemini-lookup';

type Page={url:string,title:string,description?:string};
const words=(text:string)=>text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const catalogues=new Set(['parts.audiusa.com','parts.vw.com','parts.jaguarlandroverclassic.com']);
const cacheKey=(number:string)=>'scan-fitment-v1:'+normalize(number);

export function verifyFitment(candidate:string,pages:Page[]){
 const empty={vehicle:'',sources:[] as {url:string,title:string}[]};
 const label=candidate.replace(/^Land Rover (?=Range Rover\b)/i,'').replace(/\b(?:19|20)\d{2}.*$/,'').replace(/[(),]/g,' ').replace(/\s+/g,' ').trim();
 if(/[/;|]/.test(label))return empty;
 const parts=label.split(' '),last=parts.at(-1)||'';
 const platform=parts.length>=3&&/^(?:(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]+|[ivx]+)$/i.test(last)?last:'';
 const base=platform?parts.slice(0,-1).join(' '):label;
 if(base.split(' ').length<2||!/[a-z]/i.test(base))return empty;
 const model=' '+words(base)+' ';
 const sites=new Map<string,{page:Page,generation:boolean,official:boolean}>();
 for(const page of pages){
  const title=' '+words(page.title)+' ';
  if(!title.includes(model)){
   // A generic catalogue title adds no evidence. A different named car is a conflict.
   if(/\b(audi|bmw|volkswagen|porsche|land rover|discovery|range rover|mercedes|skoda|renault|peugeot|volvo|ford|opel|seat|toyota|fiat)\b/.test(title))return empty;
   continue;
  }
  // A catalogue listing shared between platforms cannot identify one donor model.
  if(/\b(?:a[1-8]|[cefglwx]\d{1,3})\s*[/&]\s*(?:a[1-8]|[cefglwx]\d{1,3})\b/i.test(page.title))return empty;
  const platformCode=platform.match(/^([a-z]+)(\d+)$/i);
  if(platformCode){
   const otherCodes=title.match(new RegExp('\\b'+platformCode[1].toLowerCase()+'\\d{'+platformCode[2].length+'}\\b','g'))||[];
   if(otherCodes.some(code=>code!==platform.toLowerCase()))return empty;
  }
  if(/\bdiscovery\b/.test(title)&&/\brange rover\b/.test(title))return empty;
  if(['sport','evoque','velar','discovery','allroad','sportback'].some(extra=>title.includes(model+extra+' ')))return empty;
  const host=new URL(page.url).hostname.toLowerCase(),labels=host.split('.');
  const company=labels.at(-2)!;
  const site=['co','com','net','org'].includes(company)?labels.at(-3):company;
  if(!site)continue;
  const generation=Boolean(platform)&&(' '+words(page.title+' '+(page.description||''))+' ').includes(' '+words(platform)+' ');
  if(!sites.has(site)||generation)sites.set(site,{page,generation,official:catalogues.has(host)});
 }
 const evidence=[...sites.values()];
 const corroborated=(rows:typeof evidence)=>rows.some(row=>row.official)||rows.length>=2;
 if(!corroborated(evidence))return empty;
 const withGeneration=evidence.filter(row=>row.generation);
 const detailed=corroborated(withGeneration);
 return {vehicle:detailed?label:base,sources:(detailed?withGeneration:evidence).map(({page})=>({title:page.title,url:page.url}))};
}

export async function cachedScanFitment(number:string){
 const r=await db.query('SELECT data FROM parts_app.lookup_cache WHERE normalized=$1 AND expires>now()',[cacheKey(number)]);
 return r.rows[0]?.data;
}

export async function scanFitment(number:string,beforeSearch:()=>Promise<void>){
 const cached=await cachedScanFitment(number);
 if(cached)return cached;
 await beforeSearch();
 const pending={verified:false,message:'Model nije potvrđen za ovaj OEM broj.',sources:[]};
 if(!process.env.GEMINI_API_KEY)return pending;
 const found=await geminiLookup(normalize(number),true,true);
 if(!found.verified||!found.vehicle||!found.name)return pending;
 const links=[...new Set<string>(found.sources.map((s:Page)=>s.url))].slice(0,6);
 const pages=await Promise.all(links.map(link=>loadProductPage(link,number,true)));
 const {sources,vehicle}=verifyFitment(found.vehicle,pages.flatMap(page=>page?[page]:[]));
 if(!sources.length)return pending;
 const result={verified:true,part_number:normalize(number),name:found.name,vehicle,category:found.category,sources};
 await db.query("INSERT INTO parts_app.lookup_cache(normalized,data,expires) VALUES($1,$2,now()+interval '24 hours') ON CONFLICT(normalized) DO UPDATE SET data=excluded.data,expires=excluded.expires",[cacheKey(number),JSON.stringify(result)]);
 return result;
}
