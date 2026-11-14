let cached:{date:string,rates:Record<string,number>}|undefined;
let loadedAt=0;
export async function euroRates(){
 if(cached&&Date.now()-loadedAt<3600000)return cached;
 try{
  const r=await fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',{signal:AbortSignal.timeout(4000)});
  if(!r.ok)return null;
  const xml=await r.text();const date=xml.match(/time=['"]([\d-]+)['"]/)?.[1];
  if(!date||Date.now()-Date.parse(date)>8*86400000)return null;
  const rates:Record<string,number>={EUR:1,BAM:1.95583};
  for(const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g))if(Number(m[2])>0)rates[m[1]]=Number(m[2]);
  cached={date,rates};loadedAt=Date.now();return cached;
 }catch{return null;}
}
