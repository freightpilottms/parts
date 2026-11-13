import {db} from './db';
import {lookup} from './lookup';

// Persist the job before responding; Next after keeps server work alive after response.
// An atomic claim prevents two callbacks from enriching the same item concurrently.
export async function enrichItem(id:string){
 const claimed=await db.query("UPDATE parts_app.items SET estimates=jsonb_set(estimates,'{_enrichment,status}','\"running\"'::jsonb) WHERE id=$1 AND estimates->'_enrichment'->>'status'='pending' RETURNING part_number",[id]);
 if(!claimed.rows[0])return;
 try{
  const found=await lookup(claimed.rows[0].part_number,false,false,true);
  if(!found.name||!found.vehicle)throw Error('Identity not confirmed');
  const images=[found.photo,...(found.photos_reference||[])].filter((u,i,a)=>typeof u==='string'&&u.startsWith('https://')&&a.indexOf(u)===i).slice(0,3);
  const estimates={...found.estimates,_enrichment:{status:'complete',updated_at:new Date().toISOString(),images}};
  // Never overwrite user-entered identity, ownership, sale price, status or photos.
  await db.query('UPDATE parts_app.items SET estimates=estimates || $2::jsonb,sources=$3::jsonb WHERE id=$1',[id,JSON.stringify(estimates),JSON.stringify(found.sources||[])]);
 }catch{
  await db.query("UPDATE parts_app.items SET estimates=jsonb_set(estimates,'{_enrichment}', $2::jsonb) WHERE id=$1",[id,JSON.stringify({status:'failed',updated_at:new Date().toISOString()})]);
 }
}
