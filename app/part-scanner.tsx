'use client';
import {useEffect,useRef,useState} from 'react';
import {Camera,Upload,ScanLine,LoaderCircle} from 'lucide-react';
import {categories} from '@/lib/shared';
import type {VisualHints} from '@/lib/visual-search';

type Mark={kind:'OEM'|'Serijski broj'|'Druga oznaka',value:string};
function singleOem(marks:Mark[]){
 const distinct=new Map(marks.filter(mark=>mark.kind==='OEM').map(mark=>[mark.value.toUpperCase().replace(/[\s-]/g,''),mark]));
 return distinct.size===1?distinct.values().next().value:undefined;
}
type Source={title:string,url:string};
type Reading={name:string,vehicle:string,category:typeof categories[number],markings:Mark[],sources?:Source[],visual?:VisualHints,visualVehicle?:string};
type VisualMatch={vehicle:string,features:string,source:Source,image?:string};
type Match={name:string,vehicle:string,features?:string,sources:Source[],category?:Reading['category'],part_number?:string};
export type ScanDraft={file:File,number:string,reading:Reading,hasOem:boolean};

export default function PartScanner({prepare,onAccept}:{prepare:(f:File)=>Promise<File>,onAccept:(draft:ScanDraft)=>void}){
 const camera=useRef<HTMLInputElement>(null),gallery=useRef<HTMLInputElement>(null);
 const labelInput=useRef<HTMLInputElement>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[file,setFile]=useState<File|null>(null);
 const [reading,setReading]=useState<Reading|null>(null),[number,setNumber]=useState(''),[hasOem,setHasOem]=useState(false);
 const [preview,setPreview]=useState('');
 const [detailFile,setDetailFile]=useState<File|null>(null),[match,setMatch]=useState<Match|null>(null);
 const [checking,setChecking]=useState(false),[checked,setChecked]=useState(false),[accepted,setAccepted]=useState(false);
 const [pages,setPages]=useState<Source[]>([]);
 const [visualMatch,setVisualMatch]=useState<VisualMatch|null>(null),[comparing,setComparing]=useState(false);
 const [visualError,setVisualError]=useState('');
 const hints=reading?.visual;
 const exact=hasOem&&number.trim().length>=3?number.trim():'';
 const ready=Boolean(reading);
 useEffect(()=>{
  setMatch(null);setAccepted(false);setChecked(false);setChecking(false);
  if(!ready||!detailFile||!exact)return;
  const controller=new AbortController();
  setChecking(true);
  const timer=setTimeout(async()=>{
   try{
    const res=await fetch('/api/lookup?mode=scan&number='+encodeURIComponent(exact),{signal:controller.signal});
    if(!res.ok)throw Error();
    const data=await res.json();
    const result=exact&&data.verified?data:null;
    if(!controller.signal.aborted){
     setMatch(result);
     setAccepted(false);
    }
   }catch{/* The first visual reading remains available. */}
   finally{if(!controller.signal.aborted){setChecking(false);setChecked(true);}}
  },exact?300:0);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[ready,detailFile,exact]);
 useEffect(()=>{
  setVisualMatch(null);setPages([]);setComparing(false);setVisualError('');
  if(!detailFile||!hints)return;
  const controller=new AbortController();
  const query=new URLSearchParams({mode:'visual',part:hints.part,side:hints.side});
  hints.models.forEach(model=>query.append('model',model));
  setComparing(true);
  async function compare(){
   try{
    const response=await fetch('/api/scan?'+query,{method:'POST',body:detailFile,signal:controller.signal});
    if(!response.ok)throw Error();
    const data=await response.json();
    if(!controller.signal.aborted){setPages(data.pages||[]);setVisualMatch(data.match||null);}
   }catch{if(!controller.signal.aborted)setVisualError('Poređenje s kataloškim fotografijama trenutno nije dostupno.');}
   finally{if(!controller.signal.aborted)setComparing(false);}
  }
  void compare();return ()=>controller.abort();
 },[detailFile,hints]);
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
   const oem=singleOem(result.markings);
   setReading(result);setNumber(oem?.value||'');setHasOem(Boolean(oem));
  }catch(e){setError(e instanceof Error?e.message:'Očitavanje nije uspjelo.');}
  finally{setBusy(false);}
 }
 function accept(){
  if(!file)return;
  const useMatch=Boolean(accepted&&match&&exact&&match.part_number===exact.toUpperCase().replace(/[^A-Z0-9]/g,''));
  onAccept({file,number:number.trim()||'INT-'+crypto.randomUUID().slice(0,13).toUpperCase(),
   hasOem:useMatch,reading:reading?{...reading,visualVehicle:visualMatch?.vehicle,vehicle:useMatch&&match?match.vehicle:'',
    name:useMatch&&match?match.name:reading.name,category:useMatch&&match?.category?match.category:reading.category,
    sources:useMatch&&match?match.sources:[]}:{name:'',vehicle:'',category:'Ostali dijelovi',markings:[]}});
 }
 async function readLabel(input:HTMLInputElement){
  const label=input.files?.[0];input.value='';
  if(!label||!reading)return;
  setBusy(true);setError('');
  try{
   const detail=label.size<=3_000_000?label:await prepare(label);
   const response=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':detail.type},body:detail});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'Očitavanje oznake nije uspjelo.');
   const extra=(data as Reading).markings;
   if(!extra.length)throw Error('Nema čitljivog broja. Približi kameru oznaci i pokušaj ponovo.');
   const marks=[...extra,...reading.markings].filter((m,i,all)=>all.findIndex(x=>x.value===m.value)===i).slice(0,15);
   setReading({...reading,markings:marks});
   const oem=singleOem(marks);
   if(!number.trim()&&oem){setNumber(oem.value);setHasOem(true);}
  }catch(e){setError(e instanceof Error?e.message:'Očitavanje oznake nije uspjelo.');}
  finally{setBusy(false);}
 }
 return <div className="part-scanner">
  <div className="scan-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>camera.current?.click()}><Camera size={17}/>Uslikaj dio</button>
   <button type="button" className="secondary" disabled={busy} onClick={()=>gallery.current?.click()}><Upload size={17}/>Odaberi sliku</button></div>
  <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={e=>void scan(e.currentTarget)}/>
  <input ref={gallery} type="file" hidden accept="image/*" onChange={e=>void scan(e.currentTarget)}/>
  {preview&&<img src={preview} alt="Fotografija odabrana za očitavanje" style={{maxWidth:'100%',height:160,objectFit:'contain',justifySelf:'center'}}/>}
  {busy&&<p role="status"><LoaderCircle size={16} className="spin"/> Očitavanje oznaka i prepoznavanje dijela…</p>}
  {error&&<p role="alert" className="error">{error}</p>}
  {reading&&!busy&&<><strong>{reading.name||'Dio nije prepoznat'}</strong>
    <input ref={labelInput} type="file" hidden accept="image/*" onChange={e=>void readLabel(e.currentTarget)}/>
    <button type="button" className="secondary" onClick={()=>labelInput.current?.click()}><ScanLine size={17}/>Dodaj fotografiju oznake</button>
    {checking&&<p role="status">Provjeravam OEM broj…</p>}
    {comparing&&<p role="status">Poredim oblik dijela s kataloškim fotografijama…</p>}
    {visualError&&<p role="status">{visualError}</p>}
    {visualMatch&&<div className="scan-match"><strong>Vozilo prema fotografiji · {visualMatch.vehicle}</strong>
     <p>{visualMatch.features}</p>
     <a href={visualMatch.source.url} target="_blank" rel="noreferrer">{visualMatch.image&&<img src={visualMatch.image} alt="Dio na referentnoj fotografiji" width={160} style={{maxWidth:'100%',height:'auto'}}/>}Uporedi s oglasom</a></div>}
    {!visualMatch&&Boolean(hints?.models.length)&&<p><strong>Mogući modeli po izgledu</strong><br/>{hints?.models.join(' · ')}</p>}
    {hints&&!comparing&&!visualMatch&&!visualError&&<p>Nema dovoljno jasnog podudaranja. Pokušaj fotografijom cijelog dijela iz drugog ugla.</p>}
    {pages.length>0&&<div className="scan-match"><strong>Stranice s podudarnim fotografijama</strong>
     {pages.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title}</a>)}</div>}
    {exact&&match?.part_number===exact.toUpperCase().replace(/[^A-Z0-9]/g,'')&&match&&<div className="scan-match"><strong>Model iz kataloga</strong>
     <p>{match.name} · {match.vehicle}</p>
     {match.sources.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title}</a>)}
     <label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/> Oznaka na ovom dijelu odgovara broju {exact} i prikazanom dijelu</label></div>}
    {checked&&!match&&<p>Model nije potvrđen. Dodaj fotografiju OEM oznake ili nastavi bez tržišne procjene.</p>}
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
