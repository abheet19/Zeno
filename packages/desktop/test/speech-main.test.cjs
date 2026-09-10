const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { installSpeech } = require('../speech.cjs');

function harness(t, platform='win32') {
  const handlers=new Map(), listeners=new Map(), calls=[], children=[], sent=[];
  const ipc={ handle:(n,f)=>handlers.set(n,f), on:(n,f)=>listeners.set(n,f) };
  const sender=new EventEmitter();
  const frame={url:'http://127.0.0.1:7391/'};
  sender.mainFrame=frame; sender.send=(channel,value)=>sent.push({channel,...value});
  const window={webContents:sender,isDestroyed:()=>false};
  const spawn=(file,args,opts)=>{
    calls.push({file,args,opts});
    const child=new EventEmitter();
    child.stdout=new PassThrough(); child.stderr=new PassThrough();
    child.writes=[]; child.stdin=new EventEmitter();
    child.stdin.write=s=>child.writes.push(s);
    child.kills=0; child.kill=()=>{ child.kills++; return true; };
    child.line=value=>child.stdout.write(JSON.stringify(value)+'\n');
    children.push(child); return child;
  };
  const dispose=installSpeech(ipc,()=>window,'http://127.0.0.1:7391','C:\\fixture\\windows-speech.ps1',spawn,platform);
  const event={sender,senderFrame:frame};
  t.after(()=>{void dispose(); for(const c of children)c.emit('close',0);});
  return {sender,frame,window,event,calls,children,sent,
    start:(request={id:1,lang:'en-IN'},from=event)=>handlers.get('zeno:speech:start')(from,request),
    idle:(from=event)=>handlers.get('zeno:speech:idle')(from),
    stop:(id=1,from=event)=>listeners.get('zeno:speech:stop')(from,id),
    abort:(id=1,from=event)=>listeners.get('zeno:speech:abort')(from,id)};
}

test('only the current trusted top-level Windows frame can start native capture',async t=>{
  const h=harness(t);
  assert.equal(await h.start(undefined,{sender:new EventEmitter(),senderFrame:h.frame}),false);
  assert.equal(await h.start(undefined,{sender:h.sender,senderFrame:{url:h.frame.url}}),false);
  for(const url of ['https://example.invalid/','file:///tmp/local.html','data:text/html,hello','http://127.0.0.1:7392/']){
    h.frame.url=url; assert.equal(await h.start(),false,url);
  }
  h.frame.url='http://127.0.0.1:7391/';h.window.isDestroyed=()=>true;
  assert.equal(await h.start(),false);assert.equal(h.calls.length,0);
  const other=harness(t,'linux');assert.equal(await other.start(),false);assert.equal(other.calls.length,0);
});

test('invalid ids and language strings cannot reach PowerShell argv',async t=>{
  const h=harness(t);
  for(const request of [null,{}, {id:1}, ...[0,-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN,'1'].map(id=>({id,lang:'en-US'})),
    ...['en','EN-us','en_US','en-USA','en-US -Command evil',{},null].map(lang=>({id:1,lang}))]){
    assert.equal(await h.start(request),false,JSON.stringify(request));
  }
  assert.equal(h.calls.length,0);
  assert.equal(await h.start({id:5,lang:'eng-US'}),true);
  assert.equal(h.calls[0].opts.shell,false);assert.equal(h.calls[0].opts.windowsHide,true);
  assert.deepEqual(h.calls[0].args,['-NoProfile','-NonInteractive','-File','C:\\fixture\\windows-speech.ps1','-Language','eng-US']);
});

test('an active or stopping capture excludes a second start; stop is idempotent',async t=>{
  const h=harness(t);assert.equal(await h.start(),true);const c=h.children[0];
  c.line({type:'start'});
  assert.equal(await h.start({id:2,lang:'en-US'}),false);
  h.stop();h.stop();h.abort();assert.deepEqual(c.writes,['stop\n']);
  assert.equal(await h.start({id:2,lang:'en-US'}),false);
  assert.equal(h.calls.length,1);
  c.emit('close',0);c.emit('close',0);
  assert.equal(h.sent.filter(e=>e.type==='end').length,1);
  assert.equal(await h.start({id:2,lang:'en-US'}),true);
});

test('wrong id and foreign sender cannot stop or abort an active capture',async t=>{
  const h=harness(t);await h.start();const c=h.children[0];
  h.stop(99);h.abort(99);h.stop(1,{sender:new EventEmitter(),senderFrame:h.frame});
  assert.deepEqual(c.writes,[]);assert.equal(c.kills,0);
  h.abort();h.abort();assert.equal(c.kills,1);
});

for(const eventName of ['did-start-navigation','render-process-gone','destroyed']){
  test(`${eventName} invalidates capture and prevents late result/error/end delivery`,async t=>{
    const h=harness(t);await h.start();const c=h.children[0];c.line({type:'start'});
    h.sender.emit(eventName);const count=h.sent.length;
    c.line({type:'result',text:'private late transcript',final:true});
    c.line({type:'error',error:'private diagnostic'});c.emit('close',1);
    assert.equal(c.kills,1);assert.equal(h.sent.length,count);
    assert.equal(h.sender.listenerCount(eventName),0);
  });
}

test('main-frame origin changes also suppress child events without trusting a saved URL',async t=>{
  const h=harness(t);await h.start();h.frame.url='https://example.invalid/';
  const c=h.children[0];c.line({type:'result',text:'not for new origin',final:true});c.emit('close',0);
  assert.deepEqual(h.sent,[]);
});

test('UTF8 split chunks preserve transcript and only allowlisted child fields reach renderer',async t=>{
  const h=harness(t);await h.start();const c=h.children[0];
  const text='नमस्ते Abheet — café 👋';
  const bytes=Buffer.from(JSON.stringify({type:'result',text,final:true,confidence:0.9,id:999,secret:'never sent'})+'\n');
  for(let i=0;i<bytes.length;i++)c.stdout.write(bytes.subarray(i,i+1));
  assert.deepEqual(h.sent,[{channel:'zeno:speech:event',id:1,type:'result',text,final:true,confidence:0.9}]);
});

test('malformed child messages and primitive JSON are ignored without crashing the desktop',async t=>{
  const h=harness(t);await h.start();const c=h.children[0];
  assert.doesNotThrow(()=>c.stdout.write('not-json\nnull\n[]\n42\n"hello"\n'));
  c.line({type:'result',text:'still usable',final:true});
  assert.equal(h.sent.at(-1).text,'still usable');
});

test('oversized unfinished message is bounded; child errors never reveal diagnostics',async t=>{
  const h=harness(t);await h.start();const c=h.children[0];
  c.stdout.write('x'.repeat(65537));assert.equal(c.kills,1);
  assert.equal(h.sent.at(-1).error,'audio-capture');
  c.emit('error',new Error('secret diagnostic'));c.emit('close',1);
  assert.equal(h.sent.filter(e=>e.type==='end').length,1);
  assert.equal(JSON.stringify(h.sent).includes('secret diagnostic'),false);
});


test('trusted idle wait observes actual child closure without stealing or queuing microphone capture',async t=>{
  const h=harness(t);assert.equal(await h.idle(),true);await h.start();const c=h.children[0];
  let settled=false;const waiting=h.idle().then(result=>{settled=true;return result;});
  await Promise.resolve();assert.equal(settled,false);assert.equal(c.kills,0);
  assert.equal(await h.idle({sender:new EventEmitter(),senderFrame:h.frame}),false);
  h.stop();await Promise.resolve();assert.equal(settled,false);c.emit('close',0);
  assert.equal(await waiting,true);assert.equal(h.calls.length,1);
});
