import {deflateSync} from 'node:zlib';

// The built-in PDF fonts support these glyphs through a custom encoding.
const special = 'ČčĆćĐđŠšŽž';
const glyphs = '/Ccaron /ccaron /Cacute /cacute /Dcroat /dcroat /Scaron /scaron /Zcaron /zcaron';
function pdfText(value:string) {
  const bytes = Array.from(value.normalize('NFC'), char => {
    const index = special.indexOf(char);
    if (index >= 0) return 128 + index;
    const code = char.charCodeAt(0);
    return code >= 32 && (code <= 126 || (code >= 160 && code <= 255)) ? code : 63;
  });
  return '<' + Buffer.from(bytes).toString('hex') + '>';
}

function wrap(value:unknown, width:number) {
  const lines:string[] = [];
  let line = '';
  for (let word of String(value ?? '').trim().split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) { lines.push(line); line = ''; }
    while (word.length > width) { lines.push(word.slice(0,width)); word = word.slice(width); }
    line += (line ? ' ' : '') + word;
  }
  lines.push(line);
  return lines;
}

// A4 landscape. All offsets and stream lengths are measured in bytes.
export function tablePdf(headers:string[], rows:unknown[][], scope:string) {
  const widths = [98,127,134,94,58,70,62,75,76];
  const objects:Buffer[] = [];
  function add(data:string|Buffer) { objects.push(Buffer.from(data)); return objects.length; }
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding << /BaseEncoding /WinAnsiEncoding /Differences [128 '+glyphs+'] >> >>');
  const pages:number[] = [];
  let commands:string[] = [];
  let y = 0;
  function label(x:number,baseline:number,size:number,value:string) {
    commands.push('BT /F1 '+size+' Tf '+x+' '+baseline+' Td '+pdfText(value)+' Tj ET');
  }
  function startPage() {
    commands = ['0.08 0.18 0.16 rg'];
    label(24,560,17,'Parts | Pregled skladišta');
    y = 539;
    for (const line of wrap(scope+' | '+rows.length+' artikala',150)) { label(24,y,8,line); y-=11; }
    commands.push('0.9 0.95 0.93 rg 24 '+(y-16)+' 794 18 re f 0.08 0.18 0.16 rg');
    let x = 24;
    headers.forEach((h,i)=>{label(x+3,y-10,7,h); x+=widths[i];});
    y -= 29;
  }
  function endPage() {
    label(24,18,8,'Copyright @Simo Valencija & Biba Međed 2026');
    label(720,18,8,'Stranica '+(pages.length+1));
    const stream = deflateSync(commands.join('\n'));
    const content = add(Buffer.concat([Buffer.from('<< /Length '+stream.length+' /Filter /FlateDecode >>\nstream\n'),stream,Buffer.from('\nendstream')]));
    pages.push(add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents '+content+' 0 R >>'));
  }
  startPage();
  if (!rows.length) label(27,y,9,'Nema artikala za odabrane filtere.');
  for (const row of rows) {
    const cells = row.map((v,i)=>wrap(typeof v==='number'?v.toFixed(2).replace('.',','):v,Math.floor((widths[i]-6)/4.8)));
    const lines = Math.max(...cells.map(c=>c.length));
    if (y-lines*11<36 && y<475) { endPage(); startPage(); }
    for (let n=0;n<lines;n++) {
      if (y<36) { endPage(); startPage(); }
      let x=24;
      cells.forEach((cell,i)=>{if(cell[n]) label(x+3,y,8,cell[n]); x+=widths[i];});
      y-=11;
    }
    commands.push('0.84 G 0.4 w 24 '+(y+4)+' m 818 '+(y+4)+' l S');
    y-=6;
  }
  endPage();
  objects[1]=Buffer.from('<< /Type /Pages /Count '+pages.length+' /Kids ['+pages.map(p=>p+' 0 R').join(' ')+'] >>');
  const chunks:Buffer[]=[Buffer.from('%PDF-1.4\n')], offsets=[0];
  let length=chunks[0].length;
  objects.forEach((object,i)=>{
    offsets.push(length);
    const head=Buffer.from((i+1)+' 0 obj\n'),tail=Buffer.from('\nendobj\n');
    chunks.push(head,object,tail); length+=head.length+object.length+tail.length;
  });
  const xref=offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
  chunks.push(Buffer.from('xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+xref+'trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+length+'\n%%EOF\n'));
  return new Uint8Array(Buffer.concat(chunks));
}
