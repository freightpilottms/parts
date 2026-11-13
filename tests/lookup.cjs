const assert=require('node:assert/strict');
const fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const cache=new Map();const original=Module._load;
Module._load=function(id,parent,main){if(id==='./db'&&parent.filename.endsWith('lookup.ts'))return {db:{query:async(sql,args)=>{
 if(sql.startsWith('INSERT')){cache.set(args[0],JSON.parse(args[1]));return {rows:[]};}
 return {rows:sql.includes('lookup_cache')&&cache.has(args[0])?[{data:cache.get(args[0])}]:[]};
 }}};if(id==='./product-page'&&parent.filename.endsWith('gemini-lookup.ts'))return {loadProductPage:async()=>({url:'https://example.com/part',title:'Genuine original Audi rear bumper',description:'Used original part',text:'Genuine original Used 250 EUR',images:[],structuredOffers:[{price:250,priceCurrency:'EUR',itemCondition:'https://schema.org/UsedCondition'}]})};return original.call(this,id,parent,main);};
const {partNumberVariants,normalize}=require('../lib/shared.ts');
const {validateExtraction,parseLookupJson,containsPartNumber,precisePartName,selectReferenceImages}=require('../lib/gemini-lookup.ts');
const {lookup}=require('../lib/lookup.ts');
process.env.AI_PROVIDER='gemini';process.env.GEMINI_API_KEY='test-only';process.env.GEMINI_MODEL='gemini-3.8-flash';
const number='4G9807511P';const evidence='4G9 807 511 P je zadnji branik Audi A6 Avant.\n4G9807511P polovan 250 EUR.';
const sources=[{index:0,title:'Catalogue',url:'https://example.com/part'}];
const extracted={matched_number:number,identity_quote:evidence.split('\n')[0],name:'Zadnji branik',vehicle:'Audi A6 Avant',category:'Zadnji branik',photo:'https://example.com/invented.jpg',offers:[{market:'EU',condition:'used',price:250,currency:'EUR',source_index:0,evidence_quote:evidence.split('\n')[1]}]};
(async()=>{
 assert.deepEqual(partNumberVariants('4g9807511p'),[number,'4G9 807 511 P']);
 assert.equal(normalize('4G9-807 511 p'),number);
 assert.notEqual(normalize('4G9807511AB'),number);
 assert.equal(containsPartNumber('4G9 807 511 PA',number),false);
 assert.equal(containsPartNumber('OEM 4g9-807-511-p',number),true);
 assert.equal(parseLookupJson('  ```json\n{"name":"dio"}\n```  ').name,'dio');
 assert.equal(precisePartName({name:'Prednji branik',identity_quote:'OEM X: front bumper bracket'}),'Nosač prednjeg branika');
 assert.equal(precisePartName({name:'Prednji branik',exact_name_bs:'Lijeva vodilica prednjeg branika'}),'Lijeva vodilica prednjeg branika');
 const imageEvidence='4G9807511P product https://example.com/product.jpg; 4G9807511P diagram https://example.com/diagram.jpg';
 const images=selectReferenceImages({images:[{url:'https://example.com/diagram.jpg',kind:'diagram',source_index:0,evidence_quote:'4G9807511P diagram https://example.com/diagram.jpg'},{url:'https://example.com/product.jpg',kind:'product',source_index:0,evidence_quote:'4G9807511P product https://example.com/product.jpg'},{url:'https://example.com/unrelated.jpg',kind:'product',source_index:0,evidence_quote:'4G9807511R unrelated'}]},imageEvidence,sources,number);
 assert.deepEqual(images,['https://example.com/product.jpg','https://example.com/diagram.jpg']);
 const valid=validateExtraction(extracted,evidence,sources,number);
 assert.equal(valid.verified,true);assert.equal(valid.photo,null);assert.equal(valid.offers[0].url,sources[0].url);
 assert.equal(validateExtraction({...extracted,matched_number:'4G9807511R'},evidence,sources,number).verified,false);
 assert.equal(validateExtraction({...extracted,offers:[{...extracted.offers[0],evidence_quote:'made up 4G9807511P 250'}]},evidence,sources,number).offers.length,0);
 let requests=0;
 global.fetch=async(url,options)=>{requests++;const body=JSON.parse(options.body);
 assert.ok(body.contents[0].parts[0].text.includes(number));
 if(body.tools){assert.ok(body.contents[0].parts[0].text.includes('4G9 807 511 P'));return Response.json({candidates:[{content:{parts:[{text:evidence}]},groundingMetadata:{groundingChunks:[{web:{uri:sources[0].url,title:sources[0].title}}]}}]});}
 return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(extracted)}]}}]});};
 const [first,parallel]=await Promise.all([lookup('4g9807511p'),lookup('4G9 807 511 P')]);assert.equal(first,parallel);assert.equal(first.name,'Zadnji branik');assert.equal(first.estimates.EU_used.value,488.96);assert.equal(requests,2);
 const again=await lookup('4G9 807 511 P');assert.equal(again.origin,'cache');assert.equal(requests,2);
 cache.clear();requests=0;
 global.fetch=async()=>{requests++;return Response.json({candidates:[{content:{parts:[{text:'Unverified suggestion'}]}}]});};
 const none=await lookup(number);assert.equal(none.name,'');assert.deepEqual(none.estimates,{});assert.equal(cache.size,0);assert.equal(requests,2);
 console.log('Lookup checks passed: formatting equivalence, suffix safety, grounded extraction, prices, retry and cache.');
})().catch(e=>{console.error(e);process.exitCode=1;});
