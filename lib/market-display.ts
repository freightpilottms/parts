// Stored inventory estimates remain in BAM; convert only market presentation.
export function marketAmount(price:number,currency:string,market:string,rate?:number){
 const eur=currency==='EUR'?price:currency==='BAM'?price/1.95583:rate&&rate>0?price/rate:null;
 return eur===null?null:market==='BIH'?eur*1.95583:eur;
}
export function marketMoney(value:number,market:string){
 return value.toLocaleString('bs-BA',{minimumFractionDigits:2,maximumFractionDigits:2})+(market==='BIH'?' KM':' €');
}
export const categoryLabel=(value:string)=>String(value??'').replace(/stopka/g,'štopka');
