'use client';
import {useEffect,useRef,useState} from 'react';
import {Camera,Upload,ScanLine,LoaderCircle} from 'lucide-react';
import {categories} from '@/lib/shared';

type Mark={kind:'OEM'|'Serijski broj'|'Druga oznaka',value:string};
type Source={title:string,url:string};
type Reading={name:string,vehicle:string,category:typeof categories[number],markings:Mark[],sources?:Source[]};
type Match={name:string,vehicle:string,features?:string,sources:Source[],category?:Reading['category']};
export type ScanDraft={file:File,number:string,reading:Reading,hasOem:boolean};

export default function PartScanner({prepare,onAccept}:{prepare:(f:File)=>Promise<File>,onAccept:(draft:ScanDraft)=>void}){
 const camera=useRef<HTMLInputElement>(null),gallery=useRef<HTMLInputElement>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[file,setFile]=useState<File|null>(null);
 const [reading,setReading]=useState<Reading|null>(null),[number,setNumber]=useState(''),[hasOem,setHasOem]=useState(false);
 const [preview,setPreview]=useState('');
 const [detailFile,setDetailFile]=useState<File|null>(null),[match,setMatch]=useState<Match|null>(null);
 const [checking,setChecking]=useState(false),[checked,setChecked]=useState(false),[accepted,setAccepted]=useState(false);
 const [pages,setPages]=useState<Source[]>([]);
 const exact=hasOem&&number.trim().length>=3?number.trim():'';
 const ready=Boolean(reading);
 useEffect(()=>{
  setMatch(null);setPages([]);setAccepted(false);setChecked(false);setChecking(false);
  if(!ready||!detailFile)return;
  const controller=new AbortController();
  setChecking(true);
  const timer=setTimeout(async()=>{
   try{
    const res=exact?await fetch('/api/lookup?mode=identity&number='+encodeURIComponent(exact),{signal:controller.signal})
     :await fetch('/api/scan?mode=visual',{method:'POST',body:detailFile,signal:controller.signal});
    if(!res.ok)throw Error();
    const data=await res.json();
    const result=exact?(data.name&&data.vehicle&&(data.origin==='database'||data.sources?.length)?data:null):data.match;
    if(!controller.signal.aborted){setPages(data.pages||[]);setMatch(result);setAccepted(Boolean(exact&&result));}
   }catch{/* The first visual reading remains available. */}
   finally{if(!controller.signal.aborted){setChecking(false);setChecked(true);}}
  },exact?300:0);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[ready,detailFile,exact]);
 useEffect(()=>{
  if(!file){setPreview('');return;}
  const url=URL.createObjectURL(file);setPreview(url);return ()=>URL.revokeObjectURL(url);
 },[file]);
 async function scan(input:HTMLInputElement){
  const source=input.files?.[0];input.value='';
  if(!source)return;
  setError('');setBusy(true);setReading(null);setNumber('');setHasOem(false);setFile(null);
  try{
   const prepared=await prepare(source);setFile(prepared);
   const detail=source.size<=3_000_000?source:prepared;
   setDetailFile(detail);
   const response=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':detail.type},body:detail});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'Očitavanje nije uspjelo.');
   const result:Reading=data;
   const oem=result.markings.find(mark=>mark.kind==='OEM');
   setReading(result);setNumber(oem?.value||'');setHasOem(Boolean(oem));
  }catch(e){setError(e instanceof Error?e.message:'Očitavanje nije uspjelo.');}
  finally{setBusy(false);}
 }
 function accept(){
  if(!file)return;
  onAccept({file,number:number.trim()||'INT-'+crypto.randomUUID().slice(0,13).toUpperCase(),
   hasOem:hasOem&&Boolean(number.trim()),reading:reading?{...reading,vehicle:accepted&&match?match.vehicle:'',
    name:accepted&&match?match.name:reading.name,category:accepted&&match?.category?match.category:reading.category,
    sources:accepted&&match?match.sources:[]}:{name:'',vehicle:'',category:'Ostali dijelovi',markings:[]}});
 }
 return <div className="part-scanner">
  <div className="scan-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>camera.current?.click()}><Camera size={17}/>Uslikaj dio</button>
   <button type="button" className="secondary" disabled={busy} onClick={()=>gallery.current?.click()}><Upload size={17}/>Odaberi sliku</button></div>
  <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={e=>void scan(e.currentTarget)}/>
  <input ref={gallery} type="file" hidden accept="image/*" onChange={e=>void scan(e.currentTarget)}/>
  {preview&&<img src={preview} alt="Fotografija odabrana za očitavanje" style={{maxWidth:'100%',height:160,objectFit:'contain',justifySelf:'center'}}/>}
  {busy&&<p role="status"><LoaderCircle size={16} className="spin"/> Očitavanje oznaka i prepoznavanje dijela…</p>}
  {error&&<p role="alert" className="error">{error}</p>}
  {reading&&<><strong>{reading.name||'Dio nije prepoznat'}</strong>
    {checking&&<p role="status">{exact?'Provjeravam OEM broj…':'Tražim vozilo prema obliku i detaljima dijela…'}</p>}
    {pages.length>0&&<div className="scan-match"><strong>Stranice s podudarnim fotografijama</strong>
     {pages.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title}</a>)}</div>}
    {match&&<div className="scan-match"><strong>{exact?'Rezultat za odabrani OEM broj':'Moguće podudaranje po izgledu'}</strong>
     <p>{match.name} · {match.vehicle}</p>{match.features&&<p>{match.features}</p>}
     {match.sources?.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title}</a>)}
     <label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/> Koristi ovaj naziv i vozilo</label></div>}
    {checked&&!match&&<p>Vozilo nije potvrđeno. Možeš nastaviti s nazivom dijela ili uslikati prepoznatljiviji ugao.</p>}
    {reading.markings.length>0&&<p>Provjeri oznake sa slike. Odaberi broj pod kojim želiš voditi artikal.</p>}
    {reading.markings.map((mark,i)=><div className="scan-mark" key={i}>
     <button type="button" aria-pressed={number===mark.value} onClick={()=>{setNumber(mark.value);setHasOem(mark.kind==='OEM');}}>{mark.kind} · {mark.value}</button>
     <button type="button" aria-label={'Ukloni oznaku '+mark.value} onClick={()=>{setReading({...reading,markings:reading.markings.filter((_,j)=>j!==i)});if(number===mark.value){setNumber('');setHasOem(false);}}}>Ukloni</button>
    </div>)}
    <label className="field"><span>Broj za evidenciju</span><input value={number} minLength={3} maxLength={60} placeholder="Bez broja dodjeljuje se interna oznaka" onChange={e=>{setNumber(e.target.value);setHasOem(false);}}/></label>
    {number&&<label><input type="checkbox" checked={hasOem} onChange={e=>setHasOem(e.target.checked)}/> Potvrđujem da je ovo OEM broj</label>}
  </>}
  {file&&!busy&&<button type="button" className="primary full" disabled={Boolean(number.trim())&&number.trim().replace(/[^a-z0-9]/gi,'').length<3} onClick={accept}><ScanLine size={17}/> {reading?'Nastavi na unos':'Nastavi ručno sa slikom'}</button>}
 </div>;
}
