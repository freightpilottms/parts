export const categories=['Prednji branik','Zadnji branik','Lijevi blatobran','Desni blatobran','Lijevi far','Desni far','Lijeva zadnja štopka','Desna zadnja štopka'] as const;
export const normalize=(v:string)=>v.toUpperCase().replace(/[^A-Z0-9]/g,'');
export const money=(v:number|string)=>new Intl.NumberFormat('bs-BA',{style:'currency',currency:'BAM'}).format(Number(v));
