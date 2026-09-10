const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

function load(withBridge=true) {
  const subscribers=new Set(), calls=[];
  const pendingStarts=[];let nativeIdle=Promise.resolve(true);
  const bridge={
    idle:()=>nativeIdle,
    start:(id,lang)=>{calls.push(['start',id,lang]);return new Promise(resolve=>{pendingStarts.push(resolve);});},
    stop:id=>calls.push(['stop',id]),abort:id=>calls.push(['abort',id]),
    onEvent:f=>{subscribers.add(f);return()=>subscribers.delete(f);},
  };
  const fallback=function BrowserRecognition(){};
  const window=withBridge?{zenoLocalSpeech:bridge}:{webkitSpeechRecognition:fallback};
  const context=vm.createContext({window,DOMException,queueMicrotask,console});
  const src=fs.readFileSync(path.join(__dirname,'../../daemon/public/speech.js'),'utf8')
    .replace(/^export /gm,'');
  vm.runInContext(src+'\nthis.exports={SpeechRecognition,localSpeech,waitForSpeechIdle};',context);
  return {...context.exports, calls,subscribers,fallback,setIdle:p=>nativeIdle=p,
    emit:value=>{for(const f of [...subscribers])f(value);},settleStart:(ok,index=pendingStarts.length-1)=>pendingStarts[index](ok)};
}
const flush=()=>new Promise(resolve=>queueMicrotask(resolve));
const snapshot=e=>({index:e.resultIndex,results:Array.from(e.results,r=>({text:r[0].transcript,final:r.isFinal}))});

test('native adapter is selected only when preload bridge exists; browser fallback retained',()=>{
  const h=load(false);assert.equal(h.localSpeech,false);assert.equal(h.SpeechRecognition,h.fallback);
  assert.equal(load().localSpeech,true);
});

test('double start is refused, wrong session events ignored and end unsubscribes exactly once',async()=>{
  const h=load(), r=new h.SpeechRecognition();let starts=0,ends=0,results=0;
  r.onstart=()=>starts++;r.onend=()=>ends++;r.onresult=()=>results++;
  r.start();const id=r.id;assert.throws(()=>r.start(),{name:'InvalidStateError'});
  h.emit({id:id+1,type:'start'});h.emit({id:id+1,type:'result',text:'wrong',final:true});
  h.emit({id,type:'start'});h.emit({id,type:'end'});h.emit({id,type:'end'});await flush();
  assert.equal(starts,1);assert.equal(ends,1);assert.equal(results,0);assert.equal(h.subscribers.size,0);
});

test('continuous results preserve settled finals and replace only the current interim slot',()=>{
  const h=load(),r=new h.SpeechRecognition(),seen=[];r.continuous=true;r.interimResults=true;
  r.onresult=e=>seen.push(snapshot(e));r.start();const id=r.id;
  h.emit({id,type:'result',text:'hello',final:false});
  h.emit({id,type:'result',text:'hello world',final:true});
  h.emit({id,type:'result',text:'नमस्ते',final:false});
  h.emit({id,type:'result',text:'नमस्ते Abheet',final:true});
  assert.deepEqual(seen,[
    {index:0,results:[{text:'hello',final:false}]},
    {index:0,results:[{text:'hello world',final:true}]},
    {index:1,results:[{text:'hello world',final:true},{text:'नमस्ते',final:false}]},
    {index:1,results:[{text:'hello world',final:true},{text:'नमस्ते Abheet',final:true}]},
  ]);
  r.abort();
});

test('interimResults false hides interim callbacks without dropping earlier final results',()=>{
  const h=load(),r=new h.SpeechRecognition(),seen=[];r.continuous=true;r.onresult=e=>seen.push(snapshot(e));r.start();
  h.emit({id:r.id,type:'result',text:'first',final:true});
  h.emit({id:r.id,type:'result',text:'sec',final:false});
  h.emit({id:r.id,type:'result',text:'second',final:true});
  assert.equal(seen.length,2);
  assert.deepEqual(seen[1],{index:1,results:[{text:'first',final:true},{text:'second',final:true}]});
  r.abort();
});

test('restart gets a fresh id and result list; old start rejection cannot finish new session',async()=>{
  const h=load(),r=new h.SpeechRecognition(),seen=[];let ends=0;
  r.onresult=e=>seen.push(snapshot(e));r.onend=()=>ends++;
  r.start();const oldId=r.id;
  h.emit({id:oldId,type:'result',text:'old',final:true});r.abort();await flush();
  r.start();assert.notEqual(r.id,oldId);
  h.settleStart(false,0);await flush();await flush();
  assert.equal(r.active,true);assert.equal(h.subscribers.size,1);
  h.emit({id:oldId,type:'result',text:'late',final:true});
  h.emit({id:r.id,type:'result',text:'fresh',final:true});
  assert.deepEqual(seen.at(-1),{index:0,results:[{text:'fresh',final:true}]});
  assert.equal(ends,1);assert.equal(r.active,true);r.abort();
});

test('start refusal becomes an error/end; abort ignores later results and clears subscription',async()=>{
  const h=load(),r=new h.SpeechRecognition(),errors=[];let ends=0,results=0;
  r.onerror=e=>errors.push(e.error);r.onend=()=>ends++;r.onresult=()=>results++;
  r.start();h.settleStart(false);await flush();await flush();
  assert.deepEqual(errors,['audio-capture']);assert.equal(ends,1);assert.equal(r.active,false);
  r.start();const id=r.id;r.abort();r.abort();h.emit({id,type:'result',text:'late',final:true});await flush();
  assert.equal(results,0);assert.equal(ends,2);assert.equal(h.subscribers.size,0);
  assert.equal(h.calls.filter(c=>c[0]==='abort').length,1);
});


test('renderer handoff helper waits for native idle while the browser-only fallback resolves',async()=>{
  await load(false).waitForSpeechIdle();const h=load();let release,settled=false;
  h.setIdle(new Promise(resolve=>release=resolve));
  const waiting=h.waitForSpeechIdle().then(()=>settled=true);await flush();assert.equal(settled,false);
  release(true);await waiting;assert.equal(settled,true);
});


test('native wake consumer can discard delivered results and abort retains no old transcript array',async()=>{
  const h=load(),r=new h.SpeechRecognition();r.start();
  h.emit({id:r.id,type:'result',text:'private room speech',final:true});
  assert.equal(r.results.length,1);r.clearResults();assert.equal(r.results.length,0);
  const seen=[];r.onresult=e=>seen.push(snapshot(e));
  h.emit({id:r.id,type:'result',text:'next short window',final:true});
  assert.equal(seen[0].index,0);r.abort();await flush();assert.equal(r.results.length,0);
});
