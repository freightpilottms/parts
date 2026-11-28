// Older inventory rows store fitment as a description, e.g. "Audi A6 C7 Avant (2011–2014)".
const makes:Record<string,string>={
 'alfa romeo':'Alfa Romeo','aston martin':'Aston Martin','land rover':'Land Rover',
 'mercedes benz':'Mercedes-Benz',mercedes:'Mercedes-Benz',vw:'Volkswagen',volkswagen:'Volkswagen',
 skoda:'Škoda',citroen:'Citroën',bmw:'BMW',mini:'MINI',ds:'DS',mg:'MG',byd:'BYD',
 gmc:'GMC',man:'MAN',seat:'SEAT',cupra:'CUPRA',audi:'Audi',porsche:'Porsche',opel:'Opel',ford:'Ford',
 peugeot:'Peugeot',renault:'Renault',dacia:'Dacia',fiat:'Fiat',abarth:'Abarth',lancia:'Lancia',
 iveco:'Iveco',volvo:'Volvo',saab:'Saab',jaguar:'Jaguar',bentley:'Bentley',smart:'Smart',
 ferrari:'Ferrari',maserati:'Maserati',tesla:'Tesla',jeep:'Jeep',chevrolet:'Chevrolet',
 kia:'Kia',hyundai:'Hyundai',toyota:'Toyota',lexus:'Lexus',nissan:'Nissan',honda:'Honda',
 mazda:'Mazda',mitsubishi:'Mitsubishi',suzuki:'Suzuki',subaru:'Subaru',daihatsu:'Daihatsu'
};
const fold=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const makePattern=new RegExp('\\b('+Object.keys(makes).join('|').replaceAll(' ','[ -]+')+')\\b','g');
const title=(s:string)=>s.charAt(0).toUpperCase()+s.slice(1).toLowerCase();
function modelLabel(make:string,text:string){
 const clean=text.trim().replace(/^[\s:,-]+/,'').trim();
 if(!clean||/^(?:\d{4}\b|\(|\/|nepoznat|nije|unknown|razni)/i.test(clean))return '';
 if(make==='BMW'){
  const series=clean.match(/^(?:serija\s*(\d)|(\d)\s*[- ]?(?:series|er|serija)\b|([1-8])\b)/i);
  if(series)return 'Serija '+(series[1]||series[2]||series[3]);
 }
 if(make==='Mercedes-Benz'){
  const cls=clean.match(/^([abcegsv])(?:\s*[- ]?\s*(?:class|klasse|klasa))?\b/i);
  if(cls)return cls[1].toUpperCase()+'-klasa';
 }
 const multi=clean.match(/^(range rover(?: sport| evoque| velar)?|grand cherokee|grand scenic|grand vitara|land cruiser|model [s3xy]|c[ -]hr|c[ -]max|s[ -]max|cx[ -]?\d+|cr[ -]?v|xc\s?\d+|id\.\d+|e-tron(?: gt)?|serie [1-8])\b/i);
 const word=multi?.[0]||clean.match(/^[\p{L}\d][\p{L}\d-]*/u)?.[0]||'';
 return word.split(' ').map(w=>/\d|^[xiecqsg]$|^[a-z]{1,2}-[a-z]{1,3}$/i.test(w)?w.toUpperCase():title(w)).join(' ');
}
export function vehiclePairs(vehicle:string){
 const parts:{make:string,model:string}[]=[];
 const matches=Array.from(fold(vehicle).matchAll(makePattern));
 for(const [i,m] of matches.entries()){
  const make=makes[m[0].replace(/[ -]+/g,' ')];
  const description=vehicle.slice(m.index!+m[0].length,matches[i+1]?.index);
  parts.push({make,model:modelLabel(make,description)});
  // Additional models are often written without repeating the make, e.g. "Audi A6 / A7".
  for(const entry of description.split(/\s*[/;]\s*/).slice(1)){
   if(!/^[\p{L}]/u.test(entry)||/^(?:avant|karavan|limuzina|sedan|sportback|coupe|cabrio|facelift|lci|hatchback|quattro|allroad|touring|variant|\w?\d{2,3}\b|[bc]\d\b|[ivx]+\b)/i.test(entry))continue;
   const model=modelLabel(make,entry);
   if(model)parts.push({make,model});
  }
 }
 if(!parts.length&&!/^(?:vozilo|nepoznat|nije|razn|univerzal|model|godin|unknown|n\/a|za\b)/i.test(vehicle.trim())){
  const other=vehicle.trim().match(/^([\p{L}][\p{L}-]+)\s+(.+)$/u);
  if(other)parts.push({make:title(other[1]),model:modelLabel(other[1],other[2])});
 }
 return parts;
}
export function vehicleCatalog(raw:string[],make:string,model:string){
 const choices=new Map<string,Set<string>>(),matching:string[]=[];
 for(const value of raw){
  const pairs=vehiclePairs(value);
  if(pairs.some(p=>(!make||p.make===make)&&(!model||p.model===model)))matching.push(value);
  for(const p of pairs){
   if(!choices.has(p.make))choices.set(p.make,new Set());
   if(p.model)choices.get(p.make)!.add(p.model);
  }
 }
 const compare=(a:string,b:string)=>a.localeCompare(b,'bs',{numeric:true});
 return {matching,options:[...choices.keys()].sort(compare).map(make=>({make,models:[...choices.get(make)!].sort(compare)}))};
}
