const plain=(s:unknown)=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[*_`]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
export function isAftermarket(value:unknown){return /aftermarket|replica|reproduction|replacement for|oem[- ]?(?:quality|style|equivalent)|oe[- ]?(?:quality|equivalent)|zamjensk|kopij|nachbau|not genuine|non[- ]?genuine|non[- ]?original|not original|neoriginal/.test(plain(value));}
export function listingOriginality(proof:unknown,title:unknown):'original'|'unconfirmed'|'aftermarket'{
 const combined=String(proof||'')+' '+String(title||'');
 if(isAftermarket(combined))return 'aftermarket';
 if(isGenuineOem(combined)||/^(?:oe|oem)(?: part| teil| dio)?$/i.test(String(proof||'').trim()))return 'original';
 // Manufacturer or donor provenance is evidence too; no magic English keyword required.
 const text=plain(proof);
 const brand=/\b(?:audi|volkswagen|vw|vag|bmw|mercedes(?:-benz)?|skoda|seat|porsche|renault|peugeot|citroen|opel|volvo|fiat|ford)\b/;
 if(brand.test(text)&&/(?:manufacturer|manufactured by|proizvodac|hersteller|producent|donor|removed from|dismantl|skinuto sa|skinuto s|demontaz|demontaz|factory fitted)/.test(text))return 'original';
 return 'unconfirmed';
}
export function isGenuineOem(value:unknown){
 const s=plain(value);
 if(/aftermarket|replica|reproduction|replacement for|oem[- ]?(?:quality|style|equivalent)|oe[- ]?(?:quality|equivalent)|zamjensk|kopij|nachbau|zubeh[oö]r|not genuine|non[- ]?genuine/.test(s))return false;
 // An OEM reference number alone does not establish who manufactured the item.
 return /\bgenuine\b|\boriginal(?:ni|na|no|an|ne)?\b|originalteil|originalersatzteil|orygina[lł](?:ny|na|ne)?|\boriginalni\b|\boriginalny\b|\borginal\b|\bfactory original\b/.test(s);
}
export function conditionFrom(value:unknown):'new'|'used'|null{
 const s=plain(value);
 if(/refurb|remanufact|repair|damaged|broken|repaired|ostec|ošteć|poprav|obnovljen|defekt|besch[aä]digt/.test(s))return null;
 const used=/\bused\b|usedcondition|\bpolovn|\bpolovan|kori[sš][tć]|gebraucht|occasion|pouzity|pouzite|uzywany|uzywane/.test(s);
 const fresh=/\bnew\b|newcondition|\bnov[oa]?\b|\bneu\b|\bneuteil\b|\bnovy\b|\bnove\b|\bnowy\b|\bnowe\b|brand new|new old stock/.test(s);
 return used===fresh?null:used?'used':'new';
}
export function quoteHasPrice(value:unknown,price:number){
 const amounts=(String(value||'').match(/\d[\d\s.,]*/g)||[]).map(v=>{let n=v.replace(/\s/g,'').replace(/[.,]+$/,'');if(n.includes(',')&&n.includes('.'))n=n.lastIndexOf(',')>n.lastIndexOf('.')?n.replace(/\./g,'').replace(',','.'):n.replace(/,/g,'');else n=n.replace(',','.');return Number(n);});return amounts.includes(price);
}
export function verifiedOemOffer(offer:any,page:any){
 if(!page||!Number.isFinite(offer.price)||offer.price<=0)return false;
 const description=page.title+' '+page.description;
 const authenticQuote=String(offer.originality_quote||'');
 const genuine=isGenuineOem(description)||(authenticQuote.length>5&&plain(page.text).includes(plain(authenticQuote))&&isGenuineOem(authenticQuote));
 if(!genuine||/aftermarket|replica|reproduction|zamjensk|kopij/i.test(description))return false;
 if(/refurbished|remanufactured|damaged|broken|repaired|oštećen|ostecen|popravljen|defekt|beschädigt/i.test(description))return false;
 return verifiedListingPrice(offer,page);
}
export function verifiedListingPrice(offer:any,page:any){
 if(!page||!Number.isFinite(offer.price)||offer.price<=0)return false;
 const structured=page.structuredOffers||[];
 if(structured.some((o:any)=>o.price!=null)&&!structured.some((o:any)=>Number(o.price)===offer.price&&o.priceCurrency===offer.currency))return false;
 if(structured.some((o:any)=>Number(o.price)===offer.price&&o.priceCurrency===offer.currency&&conditionFrom(o.itemCondition)===offer.condition))return true;
 const conditionQuote=String(offer.condition_quote||'');const priceQuote=String(offer.price_quote||'');
 if(conditionQuote.length<3||!plain(page.text).includes(plain(conditionQuote))||conditionFrom(conditionQuote)!==offer.condition)return false;
 if(priceQuote.length<3||!plain(page.text).includes(plain(priceQuote)))return false;
 const amounts=(priceQuote.match(/\d[\d\s.,]*/g)||[]).map((v:string)=>{let n=v.replace(/\s/g,'').replace(/[.,]+$/,'');if(n.includes(',')&&n.includes('.')){n=n.lastIndexOf(',')>n.lastIndexOf('.')?n.replace(/\./g,'').replace(',','.'):n.replace(/,/g,'');}else n=n.replace(',','.');return Number(n);});
 return amounts.includes(offer.price)&&(offer.currency==='EUR'?/EUR|€/.test(priceQuote):/BAM|\bKM\b/.test(priceQuote));
}
