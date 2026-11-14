import {db} from './db';
import {lookup} from './lookup';

// Persist the job before responding; Next after keeps server work alive after response.
// An atomic claim prevents two callbacks from enriching the same item concurrently.
export async function enrichItem(id:string,refresh=false){
 const claimed=await db.query("UPDATE parts_app.items SET estimates=jsonb_set(estimates,'{_enrichment,status}','\"running\"'::jsonb) WHERE id=$1 AND estimates->'_enrichment'->>'status'='pending' RETURNING part_number,estimates",[id]);
 if(!claimed.rows[0])return;
 try{
  const found=await lookup(claimed.rows[0].part_number,refresh,false,true);
  if(!found.name||!found.vehicle)throw Error('Identity not confirmed');
  const freshImages=[found.photo,...(found.photos_reference||[])].filter((u,i,a)=>typeof u==='string'&&u.startsWith('https://')&&a.indexOf(u)===i).slice(0,3);
  const previous=claimed.rows[0].estimates?._enrichment||{};
  const images=freshImages.length?freshImages:previous.images||[];
  const referenceOffers=found.reference_offers?.length?found.reference_offers:previous.offers||[];
  const hasPrices=Object.keys(found.estimates||{}).length>0||referenceOffers.length>0;
  const estimates={...found.estimates,_enrichment:{status:images.length&&hasPrices?'complete':'partial',missing_images:!images.length,missing_prices:!hasPrices,updated_at:new Date().toISOString(),images,offers:referenceOffers}};
  // Never overwrite user-entered identity, ownership, sale price, status or photos.
  await db.query('UPDATE parts_app.items SET estimates=estimates || $2::jsonb,sources=$3::jsonb WHERE id=$1',[id,JSON.stringify(estimates),JSON.stringify(found.sources||[])]);
 }catch{
  await db.query("UPDATE parts_app.items SET estimates=jsonb_set(estimates,'{_enrichment}', COALESCE(estimates->'_enrichment','{}'::jsonb) || $2::jsonb) WHERE id=$1",[id,JSON.stringify({status:'failed',updated_at:new Date().toISOString()})]);
 }
}
