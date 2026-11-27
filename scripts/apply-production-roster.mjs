import {readFile} from 'node:fs/promises';

if(process.env.VERCEL_ENV==='production'){
 const project='orutyhfslocbsrkbdupw';
 let url;
 try{url=new URL(process.env.DATABASE_URL);}catch{throw Error('DATABASE_URL nije ispravno podešen.');}
 if(url.hostname!=='db.'+project+'.supabase.co'&&
    !(url.hostname.endsWith('.pooler.supabase.com')&&url.username.endsWith('.'+project))){
  throw Error('Provjerite DATABASE_URL za produkcijski Parts projekat.');
 }
 const {pool}=await import('../lib/storage.mjs');
 try{
  await pool.query(await readFile(new URL('./update-users.sql',import.meta.url),'utf8'));
  console.log('Parts korisnici su ažurirani.');
 }catch(e){
  throw Error('Migracija Parts korisnika nije uspjela ('+(e.code||'SQL')+').');
 }finally{await pool.end();}
}
