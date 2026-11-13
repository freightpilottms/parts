'use client';
import {useEffect,useRef,useState} from 'react';
import {ZoomIn,ZoomOut,X,RotateCcw,ImageIcon} from 'lucide-react';

export default function ReferenceImage({urls,name}:{urls:string[],name:string}){
 const [index,setIndex]=useState(0),[failed,setFailed]=useState<string[]>([]),[open,setOpen]=useState(false);
 const [zoom,setZoom]=useState(1),[offset,setOffset]=useState({x:0,y:0});
 const dialog=useRef<HTMLDialogElement>(null),points=useRef(new Map<number,{x:number,y:number}>());
 const candidates=[...new Set(urls.filter(Boolean))].slice(0,3),url=candidates[index];
 const reset=()=>{setZoom(1);setOffset({x:0,y:0});points.current.clear();};
 const changeZoom=(value:number)=>{const next=Math.min(4,Math.max(1,value));setZoom(next);if(next===1)setOffset({x:0,y:0});};
 useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
 function broken(){setFailed(old=>[...old,url]);const next=candidates.findIndex(u=>u!==url&&!failed.includes(u));if(next>=0){setIndex(next);reset();}}
 return <div className="reference-photo reference-image">
 {url&&!failed.includes(url)?<button type="button" className="reference-thumbnail" aria-label="Uvecaj referentnu sliku" onClick={()=>{reset();setOpen(true);}}><img src={url} alt={name||'Referentna slika dijela'} referrerPolicy="no-referrer" onError={broken}/><ZoomIn size={18}/></button>:<div className="reference-unavailable"><ImageIcon size={24}/>Slika nije dostupna.</div>}
 <div><small>Referentna slika · dodirnite za uvećanje</small>{candidates.length>1&&<div className="reference-choices">{candidates.map((u,i)=><button type="button" key={u} className="icon-button" disabled={failed.includes(u)} aria-label={'Referentna slika '+(i+1)} aria-pressed={index===i} onClick={()=>{setIndex(i);reset();}}>{i+1}</button>)}</div>}</div>
 <dialog ref={dialog} className="modal wide reference-dialog" onCancel={e=>{e.stopPropagation();setOpen(false);}} onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
 <div className="modal-head"><h2>{name||'Referentna slika'}</h2><button type="button" className="icon-button" aria-label="Zatvori sliku" onClick={()=>setOpen(false)}><X/></button></div>
 <div className="reference-canvas" onDoubleClick={()=>{if(zoom>1)reset();else changeZoom(2);}} onWheel={e=>changeZoom(zoom+(e.deltaY<0?.25:-.25))}
 onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);points.current.set(e.pointerId,{x:e.clientX,y:e.clientY});}}
 onPointerMove={e=>{const old=points.current.get(e.pointerId);if(!old)return;const other=[...points.current.entries()].find(([id])=>id!==e.pointerId)?.[1];if(other){const before=Math.hypot(old.x-other.x,old.y-other.y);const after=Math.hypot(e.clientX-other.x,e.clientY-other.y);if(before>0)changeZoom(zoom*after/before);}else if(zoom>1){setOffset(o=>({x:o.x+e.clientX-old.x,y:o.y+e.clientY-old.y}));}points.current.set(e.pointerId,{x:e.clientX,y:e.clientY});}}
 onPointerUp={e=>points.current.delete(e.pointerId)} onPointerCancel={()=>points.current.clear()}>
 {open&&url&&!failed.includes(url)?<img src={url} alt={name} referrerPolicy="no-referrer" draggable={false} onError={broken} style={{transform:`translate(${offset.x}px,${offset.y}px) scale(${zoom})`}}/>:<span>Slika nije dostupna.</span>}
 </div>
 <div className="reference-controls"><button type="button" className="icon-button" aria-label="Smanji sliku" disabled={zoom<=1} onClick={()=>changeZoom(zoom-.25)}><ZoomOut/></button><output>{Math.round(zoom*100)}%</output><button type="button" className="icon-button" aria-label="Uvecaj sliku" disabled={zoom>=4} onClick={()=>changeZoom(zoom+.25)}><ZoomIn/></button><button type="button" className="icon-button" aria-label="Vrati sliku na pocetnu velicinu" onClick={reset}><RotateCcw/></button></div>
 </dialog></div>;
}
