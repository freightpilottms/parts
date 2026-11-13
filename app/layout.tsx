import type {Metadata,Viewport} from 'next';
import './globals.css';
import './mobile.css';
export const metadata:Metadata={title:'Parts - Evidencija autodijelova',description:'Dijelovi, skladiste i prodaja na jednom mjestu.',applicationName:'Parts',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,statusBarStyle:'default',title:'Parts'},icons:{icon:[{url:'/icons/favicon-32.png',sizes:'32x32',type:'image/png'},{url:'/icons/icon-192.png',sizes:'192x192',type:'image/png'}],apple:[{url:'/icons/apple-touch-icon.png',sizes:'180x180'}]},robots:{index:false,follow:false}};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#17785b',viewportFit:'cover'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="bs"><body>{process.env.PARTS_LOCAL_PREVIEW==='1'&&<div className="preview-banner">LOKALNI PREGLED - Podaci se cuvaju na ovom racunaru, ne u Supabase bazi.</div>}{children}</body></html>;}
