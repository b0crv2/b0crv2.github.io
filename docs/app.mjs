import * as pdfjs from './vendor/pdf.mjs';
import {VERSION,LIMITS,AppError,fail,extractArea,makePlan,uniqueNames,parseTemplate,assertStaticPdf,inspectPdf,flattenForms,makeOutputs,sha256} from './core.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
const $=id=>document.getElementById(id);
const languages=[['ko','한국어'],['en','English'],['ja','日本語'],['zh-CN','简体中文'],['zh-TW','繁體中文'],['es','Español'],['fr','Français'],['de','Deutsch'],['pt','Português'],['it','Italiano'],['nl','Nederlands'],['pl','Polski'],['ru','Русский'],['tr','Türkçe'],['ar','العربية'],['he','עברית'],['fa','فارسی'],['hi','हिन्दी'],['bn','বাংলা'],['ur','اردو'],['id','Bahasa Indonesia'],['vi','Tiếng Việt'],['th','ไทย'],['ms','Bahasa Melayu']];
// docs: every opened PDF. Rules are shared; each document gets its own split plan.
const state={docs:[],current:-1,pdf:null,page:1,keyArea:null,nameArea:null,busy:false,selection:null,error:null,status:null,planned:false};
let dict={},english={},currentLanguage='en',languageRequest=0,nextId=1;
const t=(key,data={})=>Object.entries(data).reduce((s,[k,v])=>s.replaceAll(`{${k}}`,String(v)),dict[key]||english[key]||key);
const doc=()=>state.docs[state.current]||null;
const errorCode=e=>e instanceof AppError?e.code:e?.name==='PasswordException'?'encrypted':'genericError';
function notice(key,data={},error=false,extra=''){state.status={key,data,error,extra};if(error)state.error=key;$('status').hidden=false;$('status').classList.toggle('error',error);const more=typeof extra==='function'?extra():extra;$('status').textContent=t(key,data)+(more?`\n${more}`:'');}
function showError(error){notice(errorCode(error),error?.data||{},true);}
function fileProblem(name,error){return {name,code:errorCode(error),data:error?.data||{}};}
const problemText=list=>()=>list.map(p=>t('fileProblem',{file:p.name,message:t(p.code,p.data)})).join('\n');
const sizeText=d=>`\u2066${mb(d.size)} MB\u2069 · \u2068${d.pages.length} ${t('pages')}\u2069`;
function planReady(){return state.planned&&state.docs.length>0&&state.docs.every(d=>!d.error&&d.plan.length);}
function controls(){
  document.querySelectorAll('button,input,select').forEach(e=>{if(e.id!=='language')e.disabled=state.busy;});
  const folderSupported='showDirectoryPicker' in window;$('saveFolder').hidden=!folderSupported;$('folderHint').hidden=!folderSupported;
  if(state.busy)return;
  const has=state.docs.length>0;
  for(const id of ['reset','selectKey','selectName','analyze'])$(id).disabled=!has;
  $('download').disabled=!planReady();$('saveFolder').disabled=!planReady();
  $('prev').disabled=!state.pdf||state.page<=1;$('next').disabled=!state.pdf||!doc()||state.page>=doc().pages.length;
}
function busy(value){state.busy=value;controls();}
async function task(fn){if(state.busy)return;busy(true);try{await fn();}catch(e){showError(e);}finally{busy(false);}}
function rules(){return {mode:$('mode').value,every:Number($('every').value),ranges:$('ranges').value,carry:$('carry').checked,pattern:$('pattern').value,keyArea:state.keyArea,nameArea:state.nameArea};}
function modeUI(){$('fixedFields').hidden=$('mode').value!=='fixed';$('rangeFields').hidden=$('mode').value!=='ranges';$('keyFields').hidden=$('mode').value!=='key';}
function invalidate(){state.planned=false;state.docs.forEach(d=>{d.plan=[];d.error=null;});renderResults();if(state.docs.length)notice('changed');controls();}
function applyRules(r){$('mode').value=r.mode;$('every').value=r.every;$('ranges').value=r.ranges;$('carry').checked=r.carry;$('pattern').value=r.pattern;state.keyArea=r.keyArea;state.nameArea=r.nameArea;modeUI();areas();invalidate();}
function makeEl(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function mb(bytes){return (bytes/1024/1024).toFixed(2);}
function renderFiles(){
  const list=$('fileList');list.replaceChildren();list.hidden=!state.docs.length;
  state.docs.forEach((d,i)=>{
    const item=makeEl('div',undefined,'file-item'+(i===state.current?' current':''));item.setAttribute('role','listitem');
    const pick=makeEl('button',undefined,'file-pick');pick.type='button';pick.setAttribute('aria-current',i===state.current?'true':'false');pick.setAttribute('aria-label',`${t('previewFile',{file:d.name})} · ${sizeText(d)}${d.flattened?' · '+t('formFixed'):''}`);
    const name=makeEl('span',d.name,'file-name');name.dir='auto';
    pick.append(name,makeEl('small',sizeText(d)));
    if(d.flattened)pick.append(makeEl('small',t('formFixed'),'badge'));
    pick.onclick=()=>task(()=>selectDoc(i));
    const remove=makeEl('button','×','file-remove');remove.type='button';remove.title=t('removeFile',{file:d.name});remove.setAttribute('aria-label',remove.title);
    remove.onclick=()=>task(()=>removeDoc(i));
    item.append(pick,remove);list.append(item);
  });
  const total=state.docs.reduce((s,d)=>s+d.pages.length,0);
  $('fileSize').textContent=state.docs.length?t('filesSummary',{files:state.docs.length,pages:total}):'';
  $('inputName').textContent=doc()?doc().name:'';$('fileInfo').hidden=!state.docs.length;
  $('drop').classList.toggle('compact',state.docs.length>0);
}
function renderResults(){
  const list=$('resultList');list.replaceChildren();
  const outputs=state.docs.reduce((s,d)=>s+d.plan.length,0);
  $('resultsEmpty').hidden=state.planned;$('coverage').hidden=!planReady();
  $('resultSummary').textContent=state.planned?(state.docs.length>1?t('batchSummary',{documents:outputs,files:state.docs.length}):`${outputs} ${t('documents')} · ${state.docs[0]?.pages.length||0} ${t('pages')}`):'';
  const multi=state.docs.length>1;
  if(state.planned)state.docs.forEach(d=>{
    if(multi||d.error){const head=makeEl('div',undefined,'result-file'+(d.error?' problem':''));const name=makeEl('strong',d.name);name.dir='auto';head.append(name,makeEl('small',d.error?t(d.error.code,d.error.data):`${d.plan.length} ${t('documents')} · ${d.pages.length} ${t('pages')}`));list.append(head);}
    d.plan.forEach((g,i)=>{
      const row=makeEl('div',undefined,'result-row');const label=makeEl('label',t('filename'));const input=makeEl('input');input.value=g.filename;input.dir='auto';input.maxLength=240;input.setAttribute('aria-label',`${d.name} · ${t('filename')} ${i+1}`);
      input.addEventListener('input',()=>{g.filename=input.value;});
      input.addEventListener('change',()=>{const normalized=uniqueNames(d.plan.map(p=>p.filename));const changed=d.plan.some((p,j)=>p.filename!==normalized[j]);d.plan.forEach((p,j)=>p.filename=normalized[j]);renderResults();if(changed)notice('adjusted');});
      label.append(input);const source=makeEl('div',undefined,'source-value');source.append(makeEl('small',t('sourceText')),makeEl('span',g.nameText||g.key||'—'));source.dir='auto';
      row.append(makeEl('div',g.pages.length===1?String(g.pages[0]):`${g.pages[0]}–${g.pages.at(-1)}`,'page-chip'),label,source);list.append(row);
    });
  });
  controls();
}
async function setLanguage(code){
  const request=++languageRequest;let next;
  try{const r=await fetch(`./locales/${code}.json`);if(!r.ok)throw Error();next=await r.json();}catch{code='en';next=english;}
  if(request!==languageRequest)return;
  dict=next;currentLanguage=code;document.documentElement.lang=code;document.documentElement.dir=['ar','he','fa','ur'].includes(code)?'rtl':'ltr';$('language').value=code;
  try{localStorage.setItem('paperlane.language',code);}catch{}
  if($('pricingLink'))$('pricingLink').href=new URL(`./${code}/#pricing`,document.baseURI).href;
  document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=t(el.dataset.i18n));
  document.querySelectorAll('[data-i18n-title]').forEach(el=>{el.title=t(el.dataset.i18nTitle);el.setAttribute('aria-label',el.title);});
  $('pageNum').setAttribute('aria-label',t('page'));$('language').setAttribute('aria-label',t('language'));$('fileList').setAttribute('aria-label',t('openFiles'));
  const rtl=document.documentElement.dir==='rtl';$('prev').textContent=rtl?'→':'←';$('next').textContent=rtl?'←':'→';
  $('faqs').replaceChildren();for(let i=1;i<=7;i++){const d=makeEl('details');d.append(makeEl('summary',t(`faq${i}q`)),makeEl('p',t(`faq${i}a`)));$('faqs').append(d);}
  if(state.status)notice(state.status.key,state.status.data,state.status.error,state.status.extra);renderFiles();renderResults();areas();controls();
}
let sharedWorker=null;
const pdfWorker=()=>{if(!sharedWorker||sharedWorker.destroyed)sharedWorker=new pdfjs.PDFWorker();return sharedWorker;};
function pdfOptions(bytes){return {worker:pdfWorker(),data:bytes.slice(),cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./vendor/wasm/',import.meta.url).href,isEvalSupported:false,enableXfa:false,stopAtErrors:true};}
function itemsForPage(content,viewport){
  return content.items.filter(i=>typeof i.str==='string').map(item=>{
    const tx=pdfjs.Util.transform(viewport.transform,item.transform), angle=Math.atan2(tx[1],tx[0]);
    const height=Math.hypot(tx[2],tx[3]),width=item.width*viewport.scale,ascent=content.styles[item.fontName]?.ascent??.8;
    const ux=Math.cos(angle),uy=Math.sin(angle),nx=Math.sin(angle),ny=-Math.cos(angle);
    const points=[0,width].flatMap(w=>[-height*(1-ascent),height*ascent].map(h=>[tx[4]+ux*w+nx*h,tx[5]+uy*w+ny*h]));
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    return {text:item.str,fs:height/viewport.width,x:Math.min(...xs)/viewport.width,y:Math.min(...ys)/viewport.height,w:(Math.max(...xs)-Math.min(...xs))/viewport.width,h:(Math.max(...ys)-Math.min(...ys))/viewport.height,dir:item.dir};
  });
}
function textSignature(content){return content.items.filter(i=>typeof i.str==='string').map(i=>i.str).join('\u0000');}
async function closePreview(){if(state.pdf){const p=state.pdf;state.pdf=null;await p.destroy();}}
async function clearAll(){
  cancelSelection();start=null;await closePreview();
  state.docs=[];state.current=-1;state.page=1;state.planned=false;
  $('file').value='';$('viewerBar').hidden=true;$('pageWrap').hidden=true;$('empty').hidden=false;$('canvas').width=1;$('canvas').height=1;$('status').hidden=true;state.status=null;
  renderFiles();renderResults();areas();controls();
}
// Reads one PDF fully: checks it, fixes visible form-field values into the page if it has a form, extracts text positions.
// Type 3 fonts often carry no readable text; the ID/name areas may then miss characters.
function hasType3(doc){const {PDFDict,PDFName}=PDFLib;for(const [,obj] of doc.context.enumerateIndirectObjects()){if(obj instanceof PDFDict&&obj.get(PDFName.of('Subtype'))?.toString()==='/Type3')return true;}return false;}
async function readPdf(file){
  if(file.size>LIMITS.bytes)fail('tooLarge');
  const original=new Uint8Array(await file.arrayBuffer());
  let source;
  try{source=await PDFLib.PDFDocument.load(original,{updateMetadata:false,throwOnInvalidObject:true});}
  catch(e){if(/encrypt/i.test(e.message))fail('encrypted');fail('invalidPdf');}
  let info;
  try{info=inspectPdf(source,PDFLib);if(source.getPageCount()>LIMITS.pages)fail('tooLarge');}
  catch(e){if(e instanceof AppError)throw e;fail('invalidPdf');}
  let bytes=original,flattened=0;
  if(info.forms){
    try{const result=await flattenForms(original,PDFLib);bytes=result.bytes;flattened=result.fields;}
    catch(e){if(e instanceof AppError)throw e;fail('formAppearance');}
  }else{
    try{assertStaticPdf(source,PDFLib);}catch(e){if(e instanceof AppError)throw e;fail('invalidPdf');}
  }
  let pdf;
  try{
    pdf=await pdfjs.getDocument(pdfOptions(bytes)).promise;
    if(pdf.numPages!==source.getPageCount()||!pdf.numPages)fail('invalidPdf');
    if(await pdf.hasJSActions()||await pdf.getAttachments()||Object.keys((await pdf.getFieldObjects())||{}).length)fail('interactive');
    const pages=[];
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i),viewport=page.getViewport({scale:1}),content=await page.getTextContent();
      const annotations=await page.getAnnotations();if(annotations.some(a=>a.subtype==='Widget'||a.subtype==='FileAttachment'||a.actions))fail('interactive');
      pages.push({items:itemsForPage(content,viewport),signature:textSignature(content)});
      page.cleanup();
    }
    return {id:nextId++,name:file.name,size:file.size,bytes,flattened,type3:hasType3(source),hash:await sha256(original),pages,plan:[],error:null};
  }catch(e){if(e instanceof AppError)throw e;if(e?.name==='PasswordException')fail('encrypted');fail('invalidPdf');}
  finally{if(pdf)await pdf.destroy();}
}
async function addFiles(files){
  files=[...files];if(!files.length)return;
  cancelSelection();
  const problems=[],before=state.docs.length;
  for(let n=0;n<files.length;n++){
    const file=files[n];
    notice('openingFile',{file:file.name,n:n+1,total:files.length});
    try{
      if(state.docs.length>=LIMITS.files)fail('tooMany');
      const d=await readPdf(file);
      if(state.docs.some(x=>x.hash===d.hash))fail('duplicateFile');
      if(state.docs.reduce((s,x)=>s+x.size,0)+d.size>LIMITS.totalBytes||state.docs.reduce((s,x)=>s+x.pages.length,0)+d.pages.length>LIMITS.totalPages)fail('tooMuchTotal');
      state.docs.push(d);
    }catch(e){problems.push(fileProblem(file.name,e));}
  }
  const added=state.docs.length-before;
  state.planned=false;state.docs.forEach(d=>{d.plan=[];d.error=null;});
  if(added&&!state.pdf)await selectDoc(before);
  renderFiles();renderResults();
  if(problems.length)notice(added?'someSkipped':'noneAdded',{count:problems.length},true,problemText(problems));
  else notice(state.docs.length>1?'filesOpened':'fileOpened',{files:state.docs.length});
}
async function selectDoc(i){
  if(i<0||i>=state.docs.length)return;
  cancelSelection();await closePreview();state.current=i;state.page=1;
  state.pdf=await pdfjs.getDocument(pdfOptions(state.docs[i].bytes)).promise;
  $('viewerBar').hidden=false;$('pageTotal').textContent=state.docs[i].pages.length;$('pageNum').max=state.docs[i].pages.length;
  renderFiles();await renderPage();
}
async function removeDoc(i){
  const wasCurrent=i===state.current;state.docs.splice(i,1);
  if(!state.docs.length){await clearAll();$('browse').focus();return;}
  try{if(wasCurrent)await selectDoc(Math.min(i,state.docs.length-1));else if(i<state.current)state.current--;}
  finally{invalidate();renderFiles();const picks=document.querySelectorAll('#fileList .file-pick');picks[Math.min(i,picks.length-1)]?.focus();}
}
async function renderPage(){
  if(!state.pdf)return;
  const page=await state.pdf.getPage(state.page),base=page.getViewport({scale:1});
  const cssWidth=Math.max(240,$('viewer').clientWidth-32),scale=Math.min(cssWidth/base.width*(window.devicePixelRatio||1),2.3),vp=page.getViewport({scale});
  const canvas=$('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);$('pageWrap').style.maxWidth=`${Math.min(base.width,cssWidth)}px`;
  await page.render({canvasContext:canvas.getContext('2d'),viewport:vp,annotationMode:pdfjs.AnnotationMode.DISABLE}).promise;
  $('empty').hidden=true;$('pageWrap').hidden=false;$('pageNum').value=state.page;areas();controls();
}
function positionBox(el,a){el.hidden=!a;if(a)Object.assign(el.style,{left:`${a.x*100}%`,top:`${a.y*100}%`,width:`${a.w*100}%`,height:`${a.h*100}%`});}
function areas(){
  positionBox($('keyBox'),state.keyArea);positionBox($('nameBox'),state.nameArea);
  const d=doc();
  for(const key of ['key','name']){const area=state[`${key}Area`];$(`${key}Text`).textContent=area&&d?(extractArea(d.pages[state.page-1].items,area)||t('noSelection')):t('noArea');}
}
function selectArea(type){if(!state.pdf)return;state.selection=type;$('selectionLayer').classList.add('selecting');$('selectKey').classList.toggle('active',type==='key');$('selectName').classList.toggle('active',type==='name');notice('selecting');}
function cancelSelection(){state.selection=null;$('selectionLayer').classList.remove('selecting');$('selectKey').classList.remove('active');$('selectName').classList.remove('active');$('drawBox').hidden=true;}
let start=null;
function point(e){const r=$('selectionLayer').getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}
function rectangle(a,b){return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)};}
$('selectionLayer').addEventListener('pointerdown',e=>{if(!state.selection||state.busy)return;start=point(e);e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();});
$('selectionLayer').addEventListener('pointermove',e=>{if(start&&state.selection)positionBox($('drawBox'),rectangle(start,point(e)));});
$('selectionLayer').addEventListener('pointerup',e=>{if(!start||!state.selection)return;const rect=rectangle(start,point(e));start=null;if(rect.w>.002&&rect.h>.002){state[state.selection+'Area']=rect;cancelSelection();areas();invalidate();}else cancelSelection();});
$('selectionLayer').addEventListener('pointercancel',()=>{start=null;cancelSelection();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){start=null;cancelSelection();}});
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=makeEl('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function jsonDownload(value,name){downloadBlob(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),name);}
function analyze(){
  cancelSelection();const r=rules();let failed=0;
  for(const d of state.docs){d.plan=[];d.error=null;try{d.plan=makePlan(d.pages,r,d.name);}catch(e){failed++;d.error={code:errorCode(e),data:e?.data||{}};}}
  state.planned=true;renderResults();
  const unread=r.mode==='key'||/\{(key|name)\}/.test(r.pattern)?state.docs.filter(d=>d.type3).map(d=>d.name):[];
  const warning=()=>unread.length?t('type3Warning',{files:unread.join(', ')}):'';
  if(!failed){notice('ready',{},false,warning);return;}
  if(state.docs.length===1){const e=state.docs[0].error;notice(e.code,e.data,true,warning);return;}
  const problems=problemText(state.docs.filter(d=>d.error).map(d=>({name:d.name,code:d.error.code,data:d.error.data})));
  notice('batchProblem',{count:failed},true,()=>[problems(),warning()].filter(Boolean).join('\n'));
}
// Builds every output PDF, reopens each one and checks page count, geometry and page text against the opened document.
async function buildOutputs(onDoc){
  if(state.docs.some(d=>!d.sample)&&state.docs.reduce((s,d)=>s+(d.sample?0:d.pages.length),0)>3)fail('demoLimit');
  if(!planReady())fail('noFile');
  // Subfolder names: short (Windows path length), unique ignoring case, never "manifest.json".
  const multi=state.docs.length>1;
  const folders=multi?uniqueNames(state.docs.map(d=>{const stem=Array.from(d.name.replace(/\.pdf$/i,'')).slice(0,60).join('');return (/^manifest\.json$/i.test(stem.trim())?'_'+stem:stem)+'.pdf';})).map(n=>n.replace(/\.pdf$/,'')):[''];
  const sources=[];
  for(let i=0;i<state.docs.length;i++){
    const d=state.docs[i];notice('workingFile',{file:d.name,n:i+1,total:state.docs.length});
    const names=uniqueNames(d.plan.map(p=>p.filename));d.plan.forEach((p,j)=>p.filename=names[j]);
    const source=await PDFLib.PDFDocument.load(d.bytes,{updateMetadata:false,throwOnInvalidObject:true});
    const outputs=await makeOutputs(source,d.plan,PDFLib,async(bytes,indices)=>{
      const pdf=await pdfjs.getDocument(pdfOptions(bytes)).promise;
      try{if(pdf.numPages!==indices.length)fail('outputError');for(let j=0;j<indices.length;j++){const page=await pdf.getPage(j+1);if(textSignature(await page.getTextContent())!==d.pages[indices[j]-1].signature)fail('outputError');}}finally{await pdf.destroy();}
    });
    const entry={folder:folders[i]||'',filename:d.name,pages:d.pages.length,sha256:d.hash,formFieldsFixed:d.flattened>0,files:outputs.map(({filename,pages,sha256})=>({filename,pages,sha256}))};
    sources.push(entry);await onDoc(entry,outputs);
  }
  renderResults();
  const checks={coverage:'all pages once in original order',reopened:true,pageGeometry:true,extractedText:true};
  const note='Original PDFs are unchanged. Form fields, if any, were fixed into the page as they appeared. Review appearance and document-level features separately.';
  if(!multi){const s=sources[0];return {app:'Paperlane',version:VERSION,source:{filename:s.filename,pages:s.pages,sha256:s.sha256,formFieldsFixed:s.formFieldsFixed},files:s.files,checks,note};}
  return {app:'Paperlane',version:VERSION,batch:true,sources,checks,note};
}
function stamp(){const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;}
async function exists(dir,name){for(const kind of ['getDirectoryHandle','getFileHandle']){try{await dir[kind](name);return true;}catch(e){if(e?.name!=='NotFoundError'&&e?.name!=='TypeMismatchError')throw e;}}return false;}
async function writeFile(dir,name,data){if(await exists(dir,name))throw new Error('exists');const handle=await dir.getFileHandle(name,{create:true});const w=await handle.createWritable();try{await w.write(data);await w.close();}catch(e){try{await w.abort();}catch{}throw e;}}
$('browse').onclick=()=>$('file').click();$('file').onchange=()=>{const files=[...$('file').files];$('file').value='';if(files.length)task(()=>addFiles(files));};
for(const event of ['dragenter','dragover'])$('drop').addEventListener(event,e=>{e.preventDefault();if(!state.busy)$('drop').classList.add('dragover');});
for(const event of ['dragleave','drop'])$('drop').addEventListener(event,e=>{e.preventDefault();$('drop').classList.remove('dragover');});
$('drop').addEventListener('drop',e=>{if(state.busy)return;const files=[...e.dataTransfer.files];if(files.length)task(()=>addFiles(files));});
$('reset').onclick=()=>task(clearAll);
$('prev').onclick=()=>task(async()=>{state.page--;cancelSelection();await renderPage();});$('next').onclick=()=>task(async()=>{state.page++;cancelSelection();await renderPage();});
$('pageNum').onchange=()=>task(async()=>{const n=Number($('pageNum').value),total=doc()?.pages.length||1;state.page=Number.isInteger(n)?Math.max(1,Math.min(total,n)):state.page;cancelSelection();await renderPage();});
$('selectKey').onclick=()=>selectArea('key');$('selectName').onclick=()=>selectArea('name');$('clearAreas').onclick=()=>{state.keyArea=null;state.nameArea=null;cancelSelection();areas();invalidate();};
for(const id of ['mode','every','ranges','carry','pattern'])$(id).addEventListener('input',()=>{modeUI();invalidate();});
$('analyze').onclick=()=>task(async()=>analyze());
$('download').onclick=()=>task(async()=>{
  const zip=new JSZip();
  const manifest=await buildOutputs(async(entry,outputs)=>{const target=entry.folder?zip.folder(entry.folder):zip;for(const o of outputs)target.file(o.filename,o.bytes);});
  zip.file('manifest.json',JSON.stringify(manifest,null,2));
  downloadBlob(await zip.generateAsync({type:'blob',compression:'STORE'}),'paperlane-documents.zip');notice('done');
});
$('saveFolder').onclick=()=>task(async()=>{
  if(!planReady())return;
  let parent;try{parent=await window.showDirectoryPicker({id:'paperlane-output',mode:'readwrite'});}catch(e){if(e?.name==='AbortError'){notice('folderCancelled');return;}notice('folderError',{folder:'',count:0},true);return;}
  let name=`Paperlane ${stamp()}`,n=1;
  let written=0;
  try{
    while(await exists(parent,name))name=`Paperlane ${stamp()} (${++n})`;
    const root=await parent.getDirectoryHandle(name,{create:true});
    const manifest=await buildOutputs(async(entry,outputs)=>{const dir=entry.folder?await root.getDirectoryHandle(entry.folder,{create:true}):root;for(const o of outputs){await writeFile(dir,o.filename,o.bytes);written++;}});
    await writeFile(root,'manifest.json',new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'}));
  }catch(e){const code=errorCode(e);notice(code==='genericError'?'folderError':code,{folder:name,count:written},true,written?()=>t('partialFolder',{folder:name,count:written}):'');return;}
  notice('folderDone',{folder:name,count:written});
});
$('saveTemplate').onclick=()=>task(async()=>{const template={app:'paperlane',schema:1,rules:rules()};parseTemplate(template);jsonDownload(template,'paperlane-rules.json');notice('saved');});
$('loadTemplate').onclick=()=>$('templateFile').click();$('templateFile').onchange=()=>task(async()=>{const file=$('templateFile').files[0];$('templateFile').value='';if(!file)return;if(file.size>30000)fail('badTemplate');let r;try{r=parseTemplate(JSON.parse(await file.text()));}catch{fail('badTemplate');}applyRules(r);notice('loaded');});
$('sample').onclick=()=>task(async()=>{const r=await fetch('./samples/sample-invoices.pdf');if(!r.ok)fail('genericError');await clearAll();await addFiles([new File([await r.arrayBuffer()],'sample-invoices.pdf',{type:'application/pdf'})]);if(!state.docs.length)return;state.docs.forEach(d=>d.sample=true);const template=await fetch('./samples/sample-rules.json').then(r=>r.json());applyRules(parseTemplate(template));analyze();});
$('diagnostics').onclick=()=>jsonDownload({app:'Paperlane',version:VERSION,browser:navigator.userAgent,language:currentLanguage,lastError:state.error,files:state.docs.length,pageCounts:state.docs.map(d=>d.pages.length)},'paperlane-diagnostics.json');
$('language').onchange=()=>setLanguage($('language').value);
window.addEventListener('beforeunload',e=>{if(state.busy){e.preventDefault();e.returnValue='';}});
for(const [code,name]of languages){const o=makeEl('option',name);o.value=code;$('language').append(o);}
try{
  english=await fetch('./locales/en.json').then(r=>r.json());let preferred=new URL(location.href).searchParams.get('lang');if(!preferred)try{preferred=localStorage.getItem('paperlane.language');}catch{}
  if(!languages.some(l=>l[0]===preferred)){const n=navigator.language;preferred=n.startsWith('zh')?(/TW|HK|Hant/i.test(n)?'zh-TW':'zh-CN'):n.split('-')[0];if(!languages.some(l=>l[0]===preferred))preferred='en';}
  await setLanguage(preferred);modeUI();renderFiles();controls();
}catch{notice('loadingFailed',{},true);}
