export const VERSION = '1.1.0';
export const LIMITS = Object.freeze({bytes:50*1024*1024,pages:300,files:20,totalBytes:200*1024*1024,totalPages:2000});
export class AppError extends Error { constructor(code, data={}) { super(code); this.code=code; this.data=data; } }
export function fail(code,data) { throw new AppError(code,data); }
export function areaOK(a) { return a && ['x','y','w','h'].every(k=>Number.isFinite(a[k])) && a.x>=0 && a.y>=0 && a.w>=.002 && a.h>=.002 && a.x+a.w<=1.001 && a.y+a.h<=1.001; }
export function extractArea(items,area) {
  if(!areaOK(area)) return '';
  const selected=items.filter(i=>i.text.trim() && i.x+i.w/2>=area.x && i.x+i.w/2<=area.x+area.w && i.y+i.h/2>=area.y && i.y+i.h/2<=area.y+area.h);
  const lines=[];
  for(const item of selected.sort((a,b)=>a.y-b.y)) {
    let line=lines.find(l=>Math.abs(l.y-item.y)<Math.max(item.h,l.h)*.55);
    if(!line){line={y:item.y,h:item.h,items:[]};lines.push(line);} line.items.push(item);
  }
  return lines.map(l=>{
    const rtl=l.items.filter(i=>i.dir==='rtl').length>l.items.length/2;
    return l.items.sort((a,b)=>rtl?b.x-a.x:a.x-b.x).map(i=>i.text).join(' ');
  }).join(' ').replace(/\s+/gu,' ').trim().normalize('NFC');
}
export function cleanFilename(value, fallback='document') {
  let name=String(value).normalize('NFC').replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,'_').replace(/\s+/gu,' ').replace(/^[ .]+|[ .]+$/g,'');
  if(!name) name=fallback;
  if(/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) name='_'+name;
  // Leave room for a suffix and extension on byte-limited filesystems.
  while(new TextEncoder().encode(name).length>150 || name.length>120) name=Array.from(name).slice(0,-1).join('');
  return name.replace(/[ .]+$/g,'')||fallback;
}
export function uniqueNames(values) {
  const used=new Set();
  return values.map((v,i)=>{
    const base=cleanFilename(v,`document-${i+1}`); let n=base, suffix=1;
    while(used.has(n.toLocaleLowerCase('en-US'))) n=`${base} (${++suffix})`;
    used.add(n.toLocaleLowerCase('en-US')); return n+'.pdf';
  });
}
export function validateCoverage(groups,total) {
  const pages=groups.flatMap(g=>g.pages);
  if(pages.length!==total || pages.some((p,i)=>p!==i+1)) fail('badRanges');
}
export function validatePattern(pattern) {
  if(typeof pattern!=='string' || !pattern.trim() || pattern.length>240) fail('badPattern');
  const remainder=pattern.replace(/\{(name|key|index|original)\}/g,'');
  if(/[{}]/.test(remainder)) fail('badPattern');
}
export function makePlan(pages,rules,original) {
  const total=pages.length;if(!total)fail('noFile');validatePattern(rules.pattern);
  if((rules.mode==='key'||/\{(name|key)\}/.test(rules.pattern))&&!pages.some(p=>p.items.some(i=>i.text.trim())))fail('noText');
  const groups=[];
  if(rules.mode==='fixed') {
    const n=Number(rules.every);if(!Number.isInteger(n)||n<1||n>total)fail('badCount');
    for(let i=0;i<total;i+=n)groups.push({pages:Array.from({length:Math.min(n,total-i)},(_,j)=>i+j+1)});
  } else if(rules.mode==='ranges') {
    const tokens=String(rules.ranges).split(',');
    if(!tokens.length||tokens.length>total)fail('badRanges');
    for(const token of tokens){ const m=token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m)fail('badRanges'); const a=Number(m[1]), b=Number(m[2]||m[1]);if(a<1||b<a||b>total)fail('badRanges');groups.push({pages:Array.from({length:b-a+1},(_,i)=>a+i)}); }
  } else if(rules.mode==='key') {
    if(!areaOK(rules.keyArea))fail('areaRequired');
    let current;
    pages.forEach((p,i)=>{
      const key=extractArea(p.items,rules.keyArea);
      if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(key))fail('noText');
      if(!key){if(!rules.carry||!current)fail('missingKey',{page:i+1});current.pages.push(i+1);}
      else if(current&&current.key===key)current.pages.push(i+1);
      else {current={pages:[i+1],key};groups.push(current);}
    });
  } else fail('badTemplate');
  validateCoverage(groups,total);
  if(rules.pattern.includes('{name}')&&!areaOK(rules.nameArea))fail('nameRequired');
  if(rules.pattern.includes('{key}')&&!areaOK(rules.keyArea))fail('areaRequired');
  for(let i=0;i<groups.length;i++) {
    const g=groups[i],p=pages[g.pages[0]-1];
    g.key=g.key||extractArea(p.items,rules.keyArea);g.nameText=extractArea(p.items,rules.nameArea);
    if((rules.pattern.includes('{name}')&&/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(g.nameText))||(rules.pattern.includes('{key}')&&/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(g.key)))fail('noText');
    if(rules.pattern.includes('{name}')&&!g.nameText)fail('missingName',{page:g.pages[0]});
    if(rules.pattern.includes('{key}')&&!g.key)fail('missingKey',{page:g.pages[0]});
    const values={name:g.nameText,key:g.key,index:String(i+1).padStart(3,'0'),original:original.replace(/\.pdf$/i,'')};
    g.requested=rules.pattern.replace(/\{(name|key|index|original)\}/g,(_,k)=>values[k]);
  }
  const names=uniqueNames(groups.map(g=>g.requested));groups.forEach((g,i)=>g.filename=names[i]);return groups;
}
export function parseTemplate(raw) {
  if(!raw||raw.app!=='paperlane'||raw.schema!==1||!raw.rules)fail('badTemplate');
  const r=raw.rules;
  if(!['fixed','ranges','key'].includes(r.mode)||typeof r.carry!=='boolean'||!Number.isInteger(r.every)||r.every<1||r.every>300||typeof r.ranges!=='string'||r.ranges.length>3000)fail('badTemplate');
  try{validatePattern(r.pattern);}catch{fail('badTemplate');}
  if((r.keyArea!==null&&!areaOK(r.keyArea))||(r.nameArea!==null&&!areaOK(r.nameArea)))fail('badTemplate');
  const copyArea=a=>a?{x:a.x,y:a.y,w:a.w,h:a.h}:null;
  return {mode:r.mode,every:r.every,ranges:r.ranges,carry:r.carry,pattern:r.pattern,keyArea:copyArea(r.keyArea),nameArea:copyArea(r.nameArea)};
}
// Only in-document jumps, web links and named navigation are allowed as link actions.
const SAFE_ACTIONS=new Set(['/GoTo','/URI','/Named']);
function checkActions(obj,lib,ctx){
  const {PDFDict,PDFName,PDFArray}=lib;
  if(obj.get(PDFName.of('Type'))?.toString()==='/Action'){const s=obj.get(PDFName.of('S'))?.toString();if(!SAFE_ACTIONS.has(s))fail('interactive');}
  for(const key of ['A','Next']){
    let v=obj.get(PDFName.of(key));if(!v)continue;v=ctx.lookup(v);
    const list=v instanceof PDFArray?v.asArray().map(x=>ctx.lookup(x)):[v];
    for(const action of list){if(!(action instanceof PDFDict))continue;const s=action.get(PDFName.of('S'));if(s&&!SAFE_ACTIONS.has(s.toString()))fail('interactive');}
  }
}
export function assertStaticPdf(doc,lib) {
  if(doc.isEncrypted)fail('encrypted');
  const {PDFDict,PDFName,PDFArray}=lib;
  const blocked=['AA','JS','JavaScript','EmbeddedFiles','XFA','OpenAction','Collection'];
  const seen=new Set();
  function inspect(obj){
    if(!obj||seen.has(obj))return;seen.add(obj);
    if(obj instanceof PDFArray){obj.asArray().forEach(inspect);return;}
    if(!(obj instanceof PDFDict))return;
    if(blocked.some(k=>obj.has(PDFName.of(k))))fail('interactive');
    for(const key of ['Type','FT','Subtype']){const v=obj.get(PDFName.of(key));if(v&&['/Sig','/Widget','/FileAttachment','/RichMedia','/Screen','/Movie','/Sound'].includes(v.toString()))fail('interactive');}
    const a=obj.get(PDFName.of('AcroForm'));if(a)fail('interactive');
    checkActions(obj,lib,doc.context);
    obj.entries().forEach(([,value])=>inspect(value));
  }
  for(const [,obj] of doc.context.enumerateIndirectObjects())inspect(obj);
}
// Pre-check for v1.1: fillable forms are accepted (their visible field values are fixed into the page),
// digitally signed PDFs, XFA forms, embedded files and media are rejected.
export function inspectPdf(doc,lib) {
  if(doc.isEncrypted)fail('encrypted');
  const {PDFDict,PDFName,PDFArray,PDFRef}=lib;
  const N=k=>PDFName.of(k);
  // A Reader "usage rights" (UR3) entry is not a document signature; splitting does not break anything the user relies on.
  let usageRights=null;
  const perms=doc.catalog.lookup(N('Perms'));
  if(perms instanceof PDFDict){const ur=perms.get(N('UR3'))||perms.get(N('UR'));usageRights=ur instanceof PDFRef?doc.context.lookup(ur):ur;}
  if(perms instanceof PDFDict&&perms.get(N('DocMDP')))fail('signed');
  const inheritedFT=dict=>{let d=dict;for(let depth=0;d instanceof PDFDict&&depth<32;depth++){const v=d.get(N('FT'));if(v)return v.toString();const p=d.get(N('Parent'));d=p?doc.context.lookup(p):undefined;}return '';};
  let forms=false,active=false;const seen=new Set();
  function inspect(obj){
    if(!obj||seen.has(obj))return;seen.add(obj);
    if(obj instanceof PDFArray){obj.asArray().forEach(inspect);return;}
    if(!(obj instanceof PDFDict))return;
    if(obj.has(N('XFA')))fail('xfa');
    const type=obj.get(N('Type')),ft=obj.get(N('FT')),subtype=obj.get(N('Subtype'));
    if(type&&type.toString()==='/Sig'&&obj!==usageRights)fail('signed');
    if(obj.has(N('ByteRange'))&&obj!==usageRights)fail('signed');
    if(obj.get(N('V'))&&inheritedFT(obj)==='/Sig')fail('signed');
    checkActions(obj,lib,doc.context);
    for(const v of [type,subtype])if(v&&['/FileAttachment','/RichMedia','/Screen','/Movie','/Sound','/3D'].includes(v.toString()))fail('interactive');
    if(subtype&&subtype.toString()==='/Widget')forms=true;
    if(ft)forms=true;
    if(obj.has(N('EmbeddedFiles'))||obj.has(N('Collection')))fail('interactive');
    if(obj.has(N('AcroForm')))forms=true;
    if(['AA','JS','JavaScript','OpenAction'].some(k=>obj.has(N(k))))active=true;
    obj.entries().forEach(([,value])=>inspect(value));
  }
  for(const [,obj] of doc.context.enumerateIndirectObjects())inspect(obj);
  if(active&&!forms)fail('interactive');
  return {forms};
}
function fmt(n){if(!Number.isFinite(n))fail('formAppearance');const s=(Math.abs(n)<1e-9?0:n).toFixed(10).replace(/\.?0+$/,'');return s==='-0'?'0':s;}
// Draws each visible form widget's saved appearance into the page content exactly where a PDF viewer shows it
// (PDF 32000-1 §12.5.5: appearance BBox transformed by its Matrix, then mapped onto the annotation Rect),
// removes the widgets and the form, and copies only the pages into a fresh document (no leftover objects).
export async function flattenForms(bytes,lib) {
  const {PDFDocument,PDFDict,PDFName,PDFArray,PDFRef,PDFStream,PDFNumber,PDFBool}=lib;
  const N=k=>PDFName.of(k);
  const doc=await PDFDocument.load(bytes,{updateMetadata:false,throwOnInvalidObject:true});
  const ctx=doc.context;
  const acro=doc.catalog.lookup(N('AcroForm'));
  let needAppearances=false,defaultResources;
  if(acro instanceof PDFDict){const need=acro.lookup(N('NeedAppearances'));needAppearances=!!need&&need.toString()==='true';const dr=acro.lookup(N('DR'));if(dr instanceof PDFDict)defaultResources=dr;}
  const inherited=(dict,key)=>{let d=dict;for(let depth=0;d instanceof PDFDict&&depth<32;depth++){const v=d.lookup(N(key));if(v!==undefined)return v;d=d.lookup(N('Parent'));}return undefined;};
  const nums=arr=>{if(!(arr instanceof PDFArray))return null;const out=arr.asArray().map(v=>{const o=ctx.lookup(v);return o instanceof PDFNumber?o.asNumber():NaN;});return out.every(Number.isFinite)?out:null;};
  const emptyValue=v=>{if(v===undefined)return true;if(v instanceof PDFArray)return v.size()===0;const s=v.toString();return s==='()'||s==='<>'||s==='/Off'||s==='<FEFF>';};
  let drawn=0;
  for(const page of doc.getPages()){
    const node=page.node;const annots=node.lookup(N('Annots'));
    if(!(annots instanceof PDFArray))continue;
    const keep=[],ops=[];let removed=false,ownXObjects=null;
    for(let i=0;i<annots.size();i++){
      const raw=annots.get(i),a=ctx.lookup(raw);
      const subtype=a instanceof PDFDict?a.lookup(N('Subtype')):undefined;
      if(!subtype||subtype.toString()!=='/Widget'){keep.push(raw);continue;}
      removed=true;
      const flagObj=a.lookup(N('F')),flags=flagObj instanceof PDFNumber?flagObj.asNumber():0;
      if(flags&2||flags&32)continue;// hidden or not viewable: viewers do not show it
      if(flags&16||a.get(N('OC')))fail('formAppearance');// no-rotate or layer-dependent widgets are not reproduced
      const value=inherited(a,'V'),ff=inherited(a,'Ff'),ft=inherited(a,'FT');
      if(ft&&ft.toString()==='/Btn'&&ff instanceof PDFNumber&&(ff.asNumber()&65536))continue;// push buttons carry no data
      if(needAppearances&&!emptyValue(value))fail('formAppearance');// saved appearance may not show the current value
      const ap=a.lookup(N('AP'));let ref=ap instanceof PDFDict?ap.get(N('N')):undefined;let stream=ref?ctx.lookup(ref):undefined;
      if(stream instanceof PDFDict){
        const as=a.lookup(N('AS'));ref=as instanceof PDFName?stream.get(as):undefined;stream=ref?ctx.lookup(ref):undefined;
        if(!(stream instanceof PDFStream)){if(!emptyValue(value)&&!(as instanceof PDFName&&as.toString()==='/Off'))fail('formAppearance');continue;}
      }
      if(!(stream instanceof PDFStream)){if(!emptyValue(value))fail('formAppearance');continue;}
      const rect=nums(a.lookup(N('Rect'))),bbox=nums(stream.dict.lookup(N('BBox')));
      if(!rect||rect.length!==4||!bbox||bbox.length!==4)fail('formAppearance');
      const m=nums(stream.dict.lookup(N('Matrix')))||[1,0,0,1,0,0];if(m.length!==6)fail('formAppearance');
      const corners=[[bbox[0],bbox[1]],[bbox[2],bbox[1]],[bbox[0],bbox[3]],[bbox[2],bbox[3]]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);
      const xs=corners.map(c=>c[0]),ys=corners.map(c=>c[1]),bx=Math.min(...xs),by=Math.min(...ys),bw=Math.max(...xs)-bx,bh=Math.max(...ys)-by;
      const rx=Math.min(rect[0],rect[2]),ry=Math.min(rect[1],rect[3]),rw=Math.abs(rect[2]-rect[0]),rh=Math.abs(rect[3]-rect[1]);
      if(bw<=0||bh<=0||rw<=0||rh<=0)continue;// zero-size appearance: nothing is visible
      const sx=rw/bw,sy=rh/bh;
      if(!(ref instanceof PDFRef))ref=ctx.register(stream);
      // Appearance streams are form XObjects even when Type/Subtype are omitted; fonts may come from the form's default resources.
      if(!stream.dict.get(N('Subtype')))stream.dict.set(N('Subtype'),N('Form'));
      if(!stream.dict.get(N('Type')))stream.dict.set(N('Type'),N('XObject'));
      if(!stream.dict.get(N('Resources'))&&defaultResources)stream.dict.set(N('Resources'),defaultResources.clone(ctx));
      // Each page gets its own resource dictionaries, so one page's field values are never attached to another page.
      if(!ownXObjects){
        const inheritedRes=node.getInheritableAttribute(N('Resources')),res=inheritedRes?ctx.lookup(inheritedRes):undefined;
        const own=res instanceof PDFDict?res.clone(ctx):ctx.obj({});const xo=own.lookup(N('XObject'));
        ownXObjects=xo instanceof PDFDict?xo.clone(ctx):ctx.obj({});own.set(N('XObject'),ownXObjects);node.set(N('Resources'),own);
      }
      let key,n=ops.length;do{key=N(`PlFormField${++n}`);}while(ownXObjects.has(key));
      ownXObjects.set(key,ref);
      ops.push(`q ${fmt(sx)} 0 0 ${fmt(sy)} ${fmt(rx-bx*sx)} ${fmt(ry-by*sy)} cm ${key.toString()} Do Q`);drawn++;
    }
    if(!removed)continue;
    if(keep.length){const arr=PDFArray.withContext(ctx);keep.forEach(k=>arr.push(k));node.set(N('Annots'),arr);}else node.delete(N('Annots'));
    if(ops.length){
      const contents=node.get(N('Contents')),list=contents?ctx.lookup(contents):undefined,arr=PDFArray.withContext(ctx);
      const hasContent=list instanceof PDFArray?list.size()>0:!!contents;
      if(hasContent){arr.push(ctx.register(ctx.stream('q\n')));if(list instanceof PDFArray)list.asArray().forEach(r=>arr.push(r));else arr.push(contents);}
      arr.push(ctx.register(ctx.stream((hasContent?'\nQ\n':'')+ops.join('\n')+'\n')));
      node.set(N('Contents'),arr);
    }
  }
  doc.catalog.delete(N('AcroForm'));
  const out=await PDFDocument.create({updateMetadata:false});
  const copied=await out.copyPages(doc,doc.getPageIndices());copied.forEach(p=>out.addPage(p));
  const result=await out.save({addDefaultPage:false});
  const check=await PDFDocument.load(result,{updateMetadata:false,throwOnInvalidObject:true});
  if(check.getPageCount()!==doc.getPageCount())fail('outputError');
  check.getPages().forEach((p,j)=>{const o=doc.getPage(j);for(const method of ['getMediaBox','getCropBox','getRotation'])if(JSON.stringify(p[method]())!==JSON.stringify(o[method]()))fail('outputError');});
  assertStaticPdf(check,lib);
  return {bytes:result,fields:drawn};
}
export async function sha256(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');}
// Gives every page its own resource dictionaries containing only what that page's content actually names.
// Without this, PDFs whose pages share one resource dictionary would carry other pages' images, fonts
// and form values (invisible, but extractable) into every split file.
export function isolatePageResources(doc,lib) {
  const {PDFDict,PDFName,PDFArray,PDFStream,PDFRawStream,decodePDFRawStream}=lib;
  const N=k=>PDFName.of(k),ctx=doc.context;
  const bytesOf=stream=>{try{if(stream instanceof PDFRawStream)return decodePDFRawStream(stream).decode();if(typeof stream.getUnencodedContents==='function')return stream.getUnencodedContents();}catch{}return null;};
  const namesIn=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));const out=new Set();for(const m of text.matchAll(/\/([^\x00\x09\x0a\x0c\x0d\x20\/\[\]()<>{}%]*)/g))out.add(m[1].replace(/#([0-9a-fA-F]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))));return out;};
  const categories=['XObject','Font','ExtGState','Pattern','Shading','ColorSpace','Properties'];
  for(const page of doc.getPages()){
    const node=page.node,inheritedRes=node.getInheritableAttribute(N('Resources')),res=inheritedRes?ctx.lookup(inheritedRes):undefined;
    if(!(res instanceof PDFDict))continue;
    const own=res.clone(ctx);
    const contents=node.Contents(),streams=contents instanceof PDFArray?contents.asArray().map(r=>ctx.lookup(r)):contents?[contents]:[];
    let used=new Set(),readable=true;
    const scan=stream=>{const b=stream instanceof PDFStream?bytesOf(stream):null;if(!b){readable=false;return;}namesIn(b).forEach(n=>used.add(n));};
    streams.forEach(scan);
    // Form XObjects and Type 3 glyphs without their own resources resolve names against the page resources.
    const visited=new Set();let grew=true;
    while(readable&&grew){grew=false;
      for(const cat of ['XObject','Font']){const sub=own.lookup(N(cat));if(!(sub instanceof PDFDict))continue;
        for(const [k,v] of sub.entries()){const name=k.decodeText();if(!used.has(name)||visited.has(cat+name))continue;visited.add(cat+name);const obj=ctx.lookup(v);
          if(cat==='XObject'&&obj instanceof PDFStream&&obj.dict.get(N('Subtype'))?.toString()==='/Form'&&!obj.dict.get(N('Resources'))){const before=used.size;scan(obj);if(used.size>before)grew=true;}
          if(cat==='Font'&&obj instanceof PDFDict&&obj.get(N('Subtype'))?.toString()==='/Type3'&&!obj.get(N('Resources'))){const procs=obj.lookup(N('CharProcs'));if(procs instanceof PDFDict){const before=used.size;for(const [,p] of procs.entries())scan(ctx.lookup(p));if(used.size>before)grew=true;}}
        }}
    }
    if(readable)for(const cat of categories){const sub=own.lookup(N(cat));if(!(sub instanceof PDFDict))continue;const kept=ctx.obj({});
      for(const [k,v] of sub.entries()){const name=k.decodeText();if(used.has(name)||(cat==='ColorSpace'&&name.startsWith('Default')))kept.set(k,v);}
      own.set(N(cat),kept);}
    node.set(N('Resources'),own);
  }
}
export async function makeOutputs(source,plan,lib,verify) {
  validateCoverage(plan,source.getPageCount());
  isolatePageResources(source,lib);
  const names=uniqueNames(plan.map(g=>g.filename));const out=[];
  for(let i=0;i<plan.length;i++){
    const g=plan[i],doc=await lib.PDFDocument.create();
    const copied=await doc.copyPages(source,g.pages.map(p=>p-1));copied.forEach(p=>doc.addPage(p));
    doc.setProducer(`Paperlane ${VERSION}`);
    const bytes=await doc.save({addDefaultPage:false});
    const check=await lib.PDFDocument.load(bytes,{updateMetadata:false});
    if(check.getPageCount()!==g.pages.length)fail('outputError');
    check.getPages().forEach((p,j)=>{
      const original=source.getPage(g.pages[j]-1);
      for(const method of ['getMediaBox','getCropBox','getRotation'])if(JSON.stringify(p[method]())!==JSON.stringify(original[method]()))fail('outputError');
    });
    if(verify)await verify(bytes,g.pages);
    out.push({filename:names[i],pages:[...g.pages],bytes,sha256:await sha256(bytes)});
  }
  return out;
}
