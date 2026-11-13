export const categories=['Prednji branik','Zadnji branik','Lijevi blatobran','Desni blatobran','Lijevi far','Desni far','Lijeva zadnja štopka','Desna zadnja štopka','Ostali dijelovi'] as const;
export const normalize=(v:string)=>v.toUpperCase().replace(/[^A-Z0-9]/g,'');
export const money=(v:number|string)=>new Intl.NumberFormat('bs-BA',{style:'currency',currency:'BAM'}).format(Number(v));

export const partNumberVariants=(value:string)=>{const key=normalize(value);const match=key.match(/^([A-Z0-9]{3})([0-9]{3})([0-9]{3})([A-Z]{0,3})$/);return match?[key,match.slice(1).filter(Boolean).join(' ')]:[key];};
