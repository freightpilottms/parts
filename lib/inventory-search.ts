export function inventoryTerms(query:string){
 const text=query.toLowerCase().replace(/đ/g,'dj').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 return (text.match(/[a-z0-9]+/g)||[]).map(word=>{
  if(/^(branici|branika|branike|branik)$/.test(word))return ['branik','branici'];
  if(/^(farovi|farova|fara|far)$/.test(word))return ['far'];
  if(/^(stop(k|a)|stop$)/.test(word))return ['stop','zadnj[a-z]* sv[j]?etl'];
  if(/^(nosac|nosac[aiu]|nosaci)$/.test(word))return ['nosac'];
  if(/^(haub|haub[aeiu])$/.test(word))return ['haub','poklop[a-z]* motora'];
  if(/^(kril|blatobran)/.test(word))return ['kril','blatobran'];
  if(/^(lijev|lev)/.test(word))return ['lijev','lev'];
  if(/^(prednj|zadnj|desn|blatobran)/.test(word))return [word.match(/^(prednj|zadnj|desn|blatobran)/)![0]];
  return [word];
 });
}

