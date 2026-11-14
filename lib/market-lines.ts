import {normalize} from './shared';
import {isGenuineOem,conditionFrom} from './oem-pricing';

const clean=(s:unknown)=>String(s||'').replace(/[*`]/g,'').trim();
const url=(s:string)=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};

// Grounded rows are parsed directly. No second model needs to reproduce quotations.
export function parseMarketLines(text:string,candidate:any,number:string,sources:any[]){
 const exactInTitle=(title:string)=>new RegExp('(?<![A-Z0-9])'+normalize(number).split('').join('[\\s-]*')+'(?![A-Z0-9])','i').test(title);
 const lines=text.split(/\r?\n/).map(clean);
 const identity=lines.map(l=>l.split('|').map(clean)).find(p=>p[0]==='IDENTITY'&&normalize(p[1]||'')===normalize(number));
 if(!identity||!identity[2]||!identity[3]||!sources.length)return null;
 const supports=candidate?.groundingMetadata?.groundingSupports||[];
 const sourceFor=(line:string,link:string)=>{
  const linked=url(link);if(!linked)return null;
  const host=new URL(linked).hostname.replace(/^www\./,'');
  const indices=new Set<number>();
  for(const s of supports){const segment=clean(s.segment?.text);if(segment&&(line.includes(segment)||segment.includes(line)))for(const i of s.groundingChunkIndices||[])indices.add(i);}
  return sources.find(s=>indices.has(s.index)&&(s.url===linked||clean(s.title).toLowerCase().replace(/^www\./,'')===host))||null;
 };
 const offers:any[]=[],images:any[]=[];
 for(const line of lines){
  const p=line.split('|').map(clean);if(normalize(p[1]||'')!==normalize(number))continue;
  if(p[0]==='OFFER'&&p.length>=9){
   const [, ,market,condition,amount,currency,proof,link]=p;
   const source=sourceFor(line,link),price=Number(amount.replace(',','.'));
   if(!source||!['EU','BIH'].includes(market)||!['new','used'].includes(condition)||!['EUR','BAM','CZK','PLN','GBP','CHF','SEK','DKK'].includes(currency)||!Number.isFinite(price)||price<=0||price>10000000||!isGenuineOem(proof))continue;
   if(/damaged|broken|refurb|repair|aftermarket|replica|zamjensk|kopij/i.test(proof+' '+p[8]))continue;
   const statedCondition=conditionFrom(proof+' '+p[8]);if(statedCondition&&statedCondition!==condition)continue;
   offers.push({market,condition,price,currency,url:source.url,source_index:source.index,grounded_row:true,evidence_quote:line,originality_quote:proof,condition_quote:condition,price_quote:amount+' '+currency});
  }
  if(p[0]==='IMAGE'&&p.length>=5){const source=sourceFor(line,p[3]),image=url(p[2]);if(source&&image&&(p[4]==='product'||exactInTitle(p[4]))&&!/diagram|logo|whole car/i.test(p[4]))images.push({url:image,kind:'product',source_index:source.index,evidence_quote:line});}
 }
 return {name:identity[2],vehicle:identity[3],category:identity[4],verified:true,sources,offers,images};
}
