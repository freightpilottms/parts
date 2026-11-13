'use client';
import {useEffect,useRef,useState} from 'react';
import {Download,Share,PlusSquare,X} from 'lucide-react';
interface InstallPrompt extends Event {prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>}
export default function InstallApp(){
 const [prompt,setPrompt]=useState<InstallPrompt|null>(null),[installed,setInstalled]=useState(true),[help,setHelp]=useState(false),[ios,setIos]=useState(false),[busy,setBusy]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const media=window.matchMedia('(display-mode: standalone)');const isStandalone=()=>media.matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
  setInstalled(isStandalone());setIos(/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));
  const offer=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPrompt);};const done=()=>{setInstalled(true);setPrompt(null);setHelp(false);};const changed=()=>setInstalled(isStandalone());
  window.addEventListener('beforeinstallprompt',offer);window.addEventListener('appinstalled',done);media.addEventListener('change',changed);
  if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{});
  return()=>{window.removeEventListener('beforeinstallprompt',offer);window.removeEventListener('appinstalled',done);media.removeEventListener('change',changed);};
 },[]);
 useEffect(()=>{if(help)dialog.current?.showModal();else dialog.current?.close();},[help]);
 async function install(){if(!prompt){setHelp(true);return;}setBusy(true);try{await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==='accepted')setInstalled(true);setPrompt(null);}catch{setHelp(true);}finally{setBusy(false);}}
 if(installed)return null;
 return <><button className="install-app-button" onClick={install} disabled={busy}><Download size={16}/> Instaliraj aplikaciju</button><dialog ref={dialog} className="modal install-help" onCancel={()=>setHelp(false)} onClick={e=>{if(e.target===e.currentTarget)setHelp(false);}}><div className="modal-head"><div><h2>Parts na vašem uređaju</h2><p>Vlastita ikonica i prozor aplikacije.</p></div><button className="icon-button" aria-label="Zatvori" onClick={()=>setHelp(false)}><X size={20}/></button></div><div className="modal-body"><img className="install-preview-icon" src="/icons/icon-192.png" alt="Parts ikonica"/>{ios?<ol><li>Otvorite Parts u <b>Safariju</b>.</li><li>Dodirnite <Share size={15}/> <b>Podijeli / Share</b>.</li><li>Odaberite <PlusSquare size={15}/> <b>Dodaj na početni ekran / Add to Home Screen</b>.</li><li>Ako je ponuđeno, uključite <b>Open as Web App</b> i dodirnite <b>Dodaj</b>.</li></ol>:<ol><li>Otvorite Parts u <b>Chromeu ili Edgeu</b>.</li><li>U meniju preglednika odaberite <b>Instaliraj aplikaciju</b> ili <b>Dodaj na početni ekran</b>.</li><li>Potvrdite instalaciju aplikacije <b>Parts</b>.</li></ol>}<p className="muted">Za instalaciju na telefonu koristite javnu HTTPS adresu aplikacije nakon objave. Prijava u instaliranoj aplikaciji može biti potrebna jednom.</p></div><div className="modal-actions"><button className="primary" onClick={()=>setHelp(false)}>U redu</button></div></dialog></>;
}
