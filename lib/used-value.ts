type Item = Record<string,any>;
export type Comparison = {type:'sale'|'asking'|'similar',median:number,count:number};
const positive=(v:unknown)=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):0;
const plain=(s:unknown)=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');

export function headlightBand(item:Item){
 const name=plain(item.name), vehicle=plain(item.vehicle);
 if(!/\b(?:lijevi|desni) far\b/.test(plain(item.category))&&!/\b(?:far|headlight|scheinwerfer)\b/.test(name))return null;
 if(/sijalic|zarulj|bulb|cover|bracket|repair|damaged|broken|pair|retrofit|bez matrix|non.matrix|modul|balast|ballast|nosac|staklo|poklop|kucist|leca|socivo|projektor|poprav|ostec|slomljen|neispravan|\bpar\b|\bset\b|aftermarket|zamjensk|kopij/.test(name))return null;
 if(/\bmatrix\b|\bmatriks\b/.test(name))return {label:'Matrix',low:1000,high:3000};
 if(/\bbi[\s-]?(?:xenon|ksenon)/.test(name))return {label:'Bi-xenon',low:600,high:1000};
 const years=(vehicle+' '+name).match(/\b(?:19|20)\d{2}\b/g)?.map(Number);
 if(/\bh[ -]?7\b/.test(name)&&years?.length&&Math.min(...years)>=2015)return {label:'H7, 2015+',low:350,high:500};
 return null;
}

export function usedValue(item:Item,reference:Comparison|null,bih:number,eu:number){
 if(item.estimates?._scan_fitment==='pending')return null;
 // Prefer observed local OEM prices and completed sales of this exact part.
 if(positive(bih))return {value:bih,reason:'Potvrđena BiH ponuda polovnog originala istog OEM broja.'};
 if(reference?.type==='sale')return {value:reference.median,reason:'Medijan ostvarenih prodaja istog OEM broja ('+reference.count+').'};
 const band=headlightBand(item),ask=positive(item.price);
 const sources:{value:number,weight:number,label:string}[]=[];
 if(eu>0)sources.push({value:eu,weight:3,label:'EU polovno OEM, preračunato u KM'});
 if(band)sources.push({value:(band.low+band.high)/2,weight:2,label:band.label+' ('+band.low+'–'+band.high+' KM)'});
 if(reference)sources.push({value:reference.median,weight:1,label:reference.type==='similar'?'prodaje sličnih dijelova':'tražene cijene istog broja'});
 if(ask)sources.push({value:ask,weight:1,label:'prodajna cijena '+ask+' KM'});
 if(!sources.length)return null;
 // A mistyped asking price should not overwhelm a known technology range.
 const total=sources.reduce((sum,s)=>sum+s.weight*(band&&s.label.startsWith('prodajna cijena')?Math.max(band.low,Math.min(band.high,s.value)):s.value),0);
 return {value:Math.round(total/sources.reduce((sum,s)=>sum+s.weight,0)*100)/100,reason:sources.map(s=>s.label).join(' · ')+(band&&ask&&(ask<band.low||ask>band.high)?' · prodajna cijena u računu ograničena na raspon fara.':'.')};
}
export function median(values:number[]){
 const sorted=values.filter(v=>v>0).sort((a,b)=>a-b),n=sorted.length;
 return n?(sorted[Math.floor(n/2)]+sorted[Math.floor((n-1)/2)])/2:0;
}
export function comparisons(rows:Item[],item:Item){
 const peers=rows.filter(r=>r.id!==item.id&&r.eligible!==false);
 const exact=peers.filter(r=>r.normalized===item.normalized);
 const observed=(r:Item)=>r.recent===true;
 const sales=exact.filter(r=>observed(r)&&r.status==='sold').map(r=>positive(r.sold_price)).filter(Boolean);
 const asking=exact.filter(r=>observed(r)&&r.status==='available').map(r=>positive(r.price)).filter(Boolean);
 const similar=peers.filter(r=>r.normalized!==item.normalized&&observed(r)&&r.status==='sold'&&r.category===item.category&&String(r.name).toLowerCase()===String(item.name).toLowerCase()&&String(r.vehicle).toLowerCase()===String(item.vehicle).toLowerCase()).map(r=>positive(r.sold_price)).filter(Boolean);
 const reference:Comparison|null=sales.length?{type:'sale',median:median(sales),count:sales.length}:asking.length?{type:'asking',median:median(asking),count:asking.length}:similar.length>=3?{type:'similar',median:median(similar),count:similar.length}:null;
 return {reference,bih:median(exact.map(r=>positive(r.bih))),eu:median(exact.map(r=>positive(r.eu)))};
}
