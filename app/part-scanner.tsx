'use client';
import {useEffect,useRef,useState} from 'react';
import {Camera,Upload,ScanLine,LoaderCircle} from 'lucide-react';
import {categories} from '@/lib/shared';

type Mark={kind:'OEM'|'Serijski broj'|'Druga oznaka',value:string};
type Reading={name:string,vehicle:string,category:typeof categories[number],markings:Mark[]};
export type ScanDraft={file:File,number:string,reading:Reading,hasOem:boolean};

export default function PartScanner({prepare,onAccept}:{prepare:(f:File)=>Promise<File>,onAccept:(draft:ScanDraft)=>void}){
 const camera=useRef<HTMLInputElement>(null),gallery=useRef<HTMLInputElement>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[file,setFile]=useState<File|null>(null);
 const [reading,setReading]=useState<Reading|null>(null),[number,setNumber]=useState(''),[hasOem,setHasOem]=useState(false);
 const [preview,setPreview]=useState('');
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
   const response=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':prepared.type},body:prepared});
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
   hasOem:hasOem&&Boolean(number.trim()),reading:reading||{name:'',vehicle:'',category:'Ostali dijelovi',markings:[]}});
 }
 return <div className="part-scanner">
  <div className="scan-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>camera.current?.click()}><Camera size={17}/>Uslikaj dio</button>
   <button type="button" className="secondary" disabled={busy} onClick={()=>gallery.current?.click()}><Upload size={17}/>Odaberi sliku</button></div>
  <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={e=>void scan(e.currentTarget)}/>
  <input ref={gallery} type="file" hidden accept="image/*" onChange={e=>void scan(e.currentTarget)}/>
  {preview&&<img src={preview} alt="Fotografija odabrana za očitavanje" style={{maxWidth:'100%',height:160,objectFit:'contain',justifySelf:'center'}}/>}
  {busy&&<p role="status"><LoaderCircle size={16} className="spin"/> Očitavanje oznaka i prepoznavanje dijela…</p>}
  {error&&<p role="alert" className="error">{error}</p>}
  {reading&&<><strong>{reading.name||'Dio nije prepoznat'}</strong>{reading.vehicle&&<p>{reading.vehicle}</p>}
    <p>Provjeri oznake sa slike. Odaberi broj pod kojim želiš voditi artikal.</p>
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
