const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

// Run the actual browser handlers, extracted at their outer function boundary.
// DOM/model/network/native mic are deliberately injected; handler code is not copied.
function functions(file,names,indent='  '){
  const source=fs.readFileSync(path.join(__dirname,'../../daemon/public',file),'utf8');
  return names.map(name=>{
    const re=new RegExp('^'+indent+'(?:async )?function '+name+'\\(','m');
    const match=re.exec(source);assert.ok(match,`missing handler ${name}`);
    const tail=source.slice(match.index);
    const next=new RegExp('^'+indent+'(?:async )?function \\w+\\(','m').exec(tail.slice(match[0].length));
    assert.ok(next,`missing next handler after ${name}`);
    return tail.slice(0,match[0].length+next.index);
  }).join('\n');
}
function fakeTimers(){
  let n=0;const timers=new Map();
  return {setTimeout:f=>{timers.set(++n,f);return n;},clearTimeout:id=>timers.delete(id),clearInterval(){},
    fire(){for(const [id,f] of [...timers]){timers.delete(id);f();}}};
}
function counselHarness(){
  const recs=[],requests=[],announcements=[],timer=fakeTimers();
  let idle=Promise.resolve();
  let response=null;
  class Recognition{
    constructor(){this.started=0;this.stopped=0;this.aborted=0;recs.push(this);}
    start(){this.started++;}stop(){this.stopped++;}abort(){this.aborted++;}
  }
  const document={body:{dataset:{zenoCapture:'counsel'}}};
  const context=vm.createContext({console,Promise,Date,Map,SpeechRecognition:Recognition,
    CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts.detail;}},
    document,window:{...timer,dispatchEvent(){}},waitForSpeechIdle:()=>idle,
    renderOverlay(){},announce:s=>announcements.push(s),
    call:async(method,url,body)=>{
      requests.push({method,url,body:JSON.parse(JSON.stringify(body))});
      if(response)return response;
      return {ok:true,data:{meeting:{id:'saved-meeting',utterances:body.utterances},redacted:0}};
    },
    loadArchive:async()=>{},select:async()=>{},badBlock(){},renderCall(){},renderAsk(){}});
  vm.runInContext('let CALL=null;const cache=new Map();const S={selected:null};\n'+
    functions('counsel.js',['counselSpeechPrompt'],'')+
    functions('counsel.js',['startEngine','commit','stopEngine','teardownCall','discardCall','endCall'])+
    '\nthis.api={startEngine,endCall,discardCall,setCall:v=>CALL=v,getCall:()=>CALL};',context);
  const create=()=>{
    const c={title:'Synthetic test',participants:[],utterances:[],seq:0,speaker:'owner',want:false,running:false,saving:false,ov:{remove(){}},tick:0};
    context.api.setCall(c);document.body.dataset.zenoCapture='counsel';return c;
  };
  return {api:context.api,recs,requests,announcements,create,timer,document,setIdle:p=>idle=p,setResponse:v=>response=v};
}
const result=text=>({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:true})]});

test('Counsel End waits for the recognizer final result before posting a transcript',async()=>{
  const h=counselHarness();h.create();await h.api.startEngine();const rec=h.recs[0];rec.onstart();
  const ending=h.api.endCall();assert.equal(h.requests.length,0);assert.equal(rec.stopped,1);
  rec.onresult(result('The final spoken phrase.'));rec.onend();await ending;
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.utterances[0].text,'The final spoken phrase.');
  assert.equal(h.api.getCall(),null);
});

test('Counsel gives local Whisper a bounded vocabulary hint for this meeting',async()=>{
  const h=counselHarness();const call=h.create();call.title='Migration sync';call.participants=['Priya','A'.repeat(700)];
  await h.api.startEngine();const prompt=h.recs[0].initialPrompt;
  assert.match(prompt,/Zeno/);assert.match(prompt,/Counsel/);assert.match(prompt,/Migration sync/);assert.match(prompt,/Priya/);
  assert.ok(prompt.length<=512);h.api.discardCall();
});

test('Counsel keeps the speaker selected at audio onset while transcription is queued',async()=>{
  const h=counselHarness();const call=h.create();await h.api.startEngine();const rec=h.recs[0];rec.onstart();
  const segmentMeta=rec.onsegmentstart();
  call.speaker='other';
  const event=result('Captured while I was speaking.');event.segmentMeta=segmentMeta;rec.onresult(event);
  assert.equal(call.utterances[0].speaker,'owner','changing the next-line tag cannot rewrite queued audio');
  h.api.discardCall();
});

test('Counsel Discard aborts immediately, saves nothing and releases the UI ownership flag',async()=>{
  const h=counselHarness();h.create();await h.api.startEngine();const rec=h.recs[0];rec.onstart();rec.onresult(result('discard me'));
  h.api.discardCall();assert.equal(rec.aborted,1);assert.equal(rec.stopped,0);assert.equal(h.requests.length,0);
  assert.equal(h.api.getCall(),null);assert.equal(h.document.body.dataset.zenoCapture,undefined);
});

test('old recognizer result/end/error cannot mutate or restart a newer Counsel call',async()=>{
  const h=counselHarness();h.create();await h.api.startEngine();const old=h.recs[0];old.onstart();h.api.discardCall();
  const current=h.create();await h.api.startEngine();h.recs[1].onstart();
  old.onresult(result('private previous call'));old.onend();old.onerror({error:'audio-capture'});
  assert.equal(current.utterances.length,0);assert.equal(current.want,true);assert.equal(current.running,true);
  assert.equal(old.started,1);h.api.discardCall();
});

test('a bounded final-drain timeout saves available lines with an explicit incomplete warning',async()=>{
  const h=counselHarness();h.create();await h.api.startEngine();const rec=h.recs[0];rec.onstart();rec.onresult(result('already final'));
  const ending=h.api.endCall();assert.equal(h.requests.length,0);h.timer.fire();await ending;
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.utterances[0].text,'already final');
  assert.ok(rec.aborted>=1);assert.ok(h.announcements.some(s=>s.includes('may be incomplete')));
});

test('Counsel keeps the transcript when HTTP success carries no saved-meeting proof',async()=>{
  const h=counselHarness();const call=h.create();await h.api.startEngine();const rec=h.recs[0];rec.onstart();
  rec.onresult(result('keep this until the write is proven'));h.setResponse({ok:true,data:{}});
  const ending=h.api.endCall();rec.onend();await ending;
  assert.equal(h.api.getCall(),call,'the live transcript remains recoverable');
  assert.equal(call.saving,false);
  assert.match(call.note,/outcome unknown/i);
  assert.equal(call.utterances[0].text,'keep this until the write is proven');
});

test('discard while waiting for native microphone closure cannot start a later capture',async()=>{
  const h=counselHarness();let release;h.setIdle(new Promise(r=>release=r));h.create();
  const starting=h.api.startEngine();await Promise.resolve();h.api.discardCall();release();await starting;
  assert.equal(h.recs.length,0);assert.equal(h.requests.length,0);
});

function voiceHarness(speechIsLocal=true){
  const recs=[],heard=[],dispatched=[],outcomes=[],timer=fakeTimers(),elements={};let idle=Promise.resolve();
  const element=name=>elements[name]??=( {textContent:'',disabled:false,handlers:new Map(),addEventListener(n,f){this.handlers.set(n,f);},setPointerCapture(){},hasPointerCapture(){return false;}} );
  class Recognition{
    constructor(){this.active=false;this.started=0;this.aborted=0;recs.push(this);}
    start(){this.active=true;this.started++;this.onstart?.();}
    stop(){}
    abort(){this.active=false;this.aborted++;queueMicrotask(()=>this.onend?.());}
  }
  const context=vm.createContext({console,Promise,queueMicrotask,SpeechRecognition:Recognition,localSpeech:speechIsLocal,window:{...timer,addEventListener(){}},
    document:{body:{dataset:{}}},waitForSpeechIdle:()=>idle,
    ui:{button:element('button')},MIC:{ptt:false},paint(){},setHeard:t=>heard.push(t),setOutcome:(...x)=>outcomes.push(x),setStatus(){},
    handleTranscript:t=>dispatched.push(t)});
  vm.runInContext('let abortPtt=()=>{};\n'+
    functions('voice.js',['externalCaptureOwner','captureOwnerLabel','closeRecognizer'],'')+'\n'+
    functions('voice.js',['wireRecognition'],'')+
    '\nwireRecognition();this.api={abort:()=>abortPtt()};',context);
  const down=()=>element('button').handlers.get('pointerdown')({preventDefault(){},pointerId:1});
  return {recs,heard,dispatched,outcomes,api:context.api,context,down,element,timer,setIdle:p=>idle=p};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};

test('push-to-talk combines all finalized phrases from cumulative recognition results',async()=>{
  const h=voiceHarness();h.down();await flush();const rec=h.recs[0];
  rec.onresult(result('first phrase'));
  rec.onresult({resultIndex:1,results:[Object.assign([{transcript:'first phrase'}],{isFinal:true}),Object.assign([{transcript:'second phrase'}],{isFinal:true})]});
  h.element('button').handlers.get('pointerup')({pointerId:1});rec.active=false;rec.onend();
  assert.deepEqual(h.dispatched,['first phrase second phrase']);
});

test('Command PTT gives only local Whisper a bounded command-vocabulary hint',()=>{
  const local=voiceHarness();const prompt=local.recs[0].initialPrompt;
  assert.match(prompt,/Zeno/);assert.match(prompt,/what is waiting/i);assert.match(prompt,/Forge/);assert.match(prompt,/Counsel/);
  assert.ok(prompt.length<=512);
  assert.equal(voiceHarness(false).recs[0].initialPrompt,undefined);
});

test('wake listening stays prompt-free to avoid biasing false activations',()=>{
  assert.doesNotMatch(functions('voice.js',['wireWake'],''),/initialPrompt/);
});

test('Stop/abort discards a finalized PTT phrase instead of dispatching it from onend',async()=>{
  const h=voiceHarness();h.down();await flush();h.recs[0].onresult(result('must not run'));await h.api.abort();await flush();
  assert.deepEqual(h.dispatched,[]);assert.equal(h.recs[0].active,false);
});

test('PTT handoff waits for native closure and a released hold cannot queue a later start',async()=>{
  const h=voiceHarness();let release;h.setIdle(new Promise(r=>release=r));h.down();
  assert.equal(h.recs[0].started,0);h.element('button').handlers.get('pointerup')({pointerId:1});release();await flush();
  assert.equal(h.recs[0].started,0);assert.equal(h.context.MIC.ptt,false);
});

test('Command PTT gives an actionable conflict while Counsel owns the microphone',async()=>{
  const h=voiceHarness();h.context.document.body.dataset.zenoCapture='counsel';h.down();await flush();
  assert.equal(h.recs[0].started,0);assert.ok(h.outcomes.some(args=>args[0].includes('Counsel')));
});


function wakeHarness(){
  let close=Promise.resolve(),idle=Promise.resolve();const started=[],messages=[];
  const window={setInterval:()=>1,clearInterval(){},clearTimeout(){},setTimeout:()=>1,addEventListener(){}};
  const context=vm.createContext({console,Promise,window,localSpeech:true,
    document:{body:{dataset:{}}},listener:{arm(){},disarm(){}},
    recognition:{start:()=>started.push(true),abort(){}},
    abortPtt:()=>close,waitForSpeechIdle:()=>idle,closeRecognizer:()=>Promise.resolve(),
    writeWakePref(){},setStatus(){},setHeard(){},setOutcome:m=>messages.push(m),render(){},pulse(){}});
  vm.runInContext('let wakeOn=false,engineUp=false,consecutiveFailures=0,restartTimer=null,uiTimer=null;let turnWakeOff,abortWake;\n'+
    functions('voice.js',['externalCaptureOwner','captureOwnerLabel'],'')+'\n'+
    functions('voice.js',['startEngine','scheduleRestart','turnOn','turnOff'],'  ')+
    '\nthis.api={on:turnOn,off:turnOff};',context);
  return {api:context.api,context,started,messages,setClose:p=>close=p,setIdle:p=>idle=p};
}

test('wake handoff waits for PTT end and native closure before starting',async()=>{
  const h=wakeHarness();let close,idle;h.setClose(new Promise(r=>close=r));h.setIdle(new Promise(r=>idle=r));
  const turning=h.api.on();assert.equal(h.started.length,0);close();await flush();assert.equal(h.started.length,0);
  idle();await turning;assert.equal(h.started.length,1);
});

test('turning wake off during handoff cancels the pending start; Counsel conflict is actionable',async()=>{
  const h=wakeHarness();let close;h.setClose(new Promise(r=>close=r));const turning=h.api.on();
  await h.api.off();close();await turning;assert.equal(h.started.length,0);
  h.context.document.body.dataset.zenoCapture='counsel';await h.api.on();assert.equal(h.started.length,0);
  assert.ok(h.messages.some(m=>m.includes('Counsel')));
});

test('wake CTA refuses Counsel microphone ownership before opening its disclosure',()=>{
  let turnedOn=0,opened=0,closed=0,turnedOff=0;
  const context=vm.createContext({
    document:{body:{dataset:{zenoCapture:'counsel'}}},
    ui:{disclosure:{hidden:true}},
    turnOn(){turnedOn++;},
    turnOff(){turnedOff++;},
    openDisclosure(){opened++;},
    closeDisclosure(){closed++;},
  });
  vm.runInContext(
    'let wakeOn=false;'+functions('voice.js',['externalCaptureOwner'],'')+functions('voice.js',['toggleWake'],'  ')+'\nthis.run=toggleWake;',
    context,
  );
  context.run();
  assert.equal(turnedOn,1,'the existing ownership guard is reached');
  assert.equal(opened,0,'no modal may cover the live Counsel overlay');
  assert.equal(closed,0);
  assert.equal(turnedOff,0);
});

test('Counsel treats archive.readable false as an error instead of an empty healthy archive',async()=>{
  const state={archive:'loading',archiveNote:'',meetings:[{id:'stale'}],failed:[]};
  const context=vm.createContext({
    call:async()=>({ok:true,data:{meetings:[],failed:[],archive:{readable:false,reason:'Folder is unreadable.',resolve:'Check its permissions.'}}}),
    renderCalls(){},renderCall(){},renderAsk(){},
  });
  vm.runInContext('let S=state;'+functions('counsel.js',['loadArchive'])+'\nthis.run=loadArchive;',
    Object.assign(context,{state}));
  await context.run();
  assert.equal(state.archive,'error');
  assert.equal(state.meetings.length,0);
  assert.match(state.archiveNote,/Folder is unreadable/);
  assert.match(state.archiveNote,/Check its permissions/);
});

test('Counsel treats a malformed successful archive response as unknown, never empty',async()=>{
  const state={archive:'loading',archiveNote:'',meetings:[{id:'stale'}],failed:[]};
  const context=vm.createContext({
    call:async()=>({ok:true,data:{}}),renderCalls(){},renderCall(){},renderAsk(){},
  });
  vm.runInContext('let S=state;'+functions('counsel.js',['loadArchive'])+'\nthis.run=loadArchive;',
    Object.assign(context,{state}));
  await context.run();
  assert.equal(state.archive,'error');
  assert.equal(state.meetings.length,0);
  assert.match(state.archiveNote,/archive response/i);
  assert.match(state.archiveNote,/unknown/i);
});

test('Counsel cannot query the local model while a meeting is active',async()=>{
  const requests=[];
  const state={asking:false,archive:'ok',askDraft:'live question',thread:[]};
  const context=vm.createContext({
    call:async(method,url,body)=>{requests.push({method,url,body});return {ok:true,data:{answer:'should not be reachable'}};},
    el:()=>({}),renderAsk(){},answerBlock:()=>({}),warmCache:async()=>{},
  });
  vm.runInContext(
    'let S=state,CALL={title:"Active meeting"};'+functions('counsel.js',['ask1'])+
      '\nthis.ask=ask1;this.end=()=>{CALL=null;};',
    Object.assign(context,{state}),
  );

  await context.ask('Tell me what to say next');
  assert.equal(requests.length,0,'the handler guard blocks model access, even if UI disabling is bypassed');
  assert.equal(state.asking,false);
  assert.equal(state.askDraft,'live question');

  context.end();
  await context.ask('What did we decide?');
  assert.equal(requests.length,1,'post-meeting cited-note questions still use the normal route');
  assert.equal(requests[0].method,'POST');
  assert.equal(requests[0].url,'/counsel/ask');
  assert.equal(requests[0].body.question,'What did we decide?');
});

test('Counsel preflight keeps the focused field and caret when an async check rerenders it',()=>{
  class FakeElement{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.parent=null;this.style={};this.dataset={};this.listeners={};this.id='';this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.selectionStart=0;this.selectionEnd=0;}
    append(...nodes){for(const node of nodes){if(node&&typeof node==='object'){node.parent=this;this.children.push(node);}}}
    replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];this.append(...nodes);}
    contains(node){for(let cur=node;cur;cur=cur.parent)if(cur===this)return true;return false;}
    setAttribute(name,value){this[name]=String(value);}
    addEventListener(name,fn){this.listeners[name]=fn;}
    focus(){document.activeElement=this;}
    setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  }
  const walk=(node,id)=>{if(node.id===id)return node;for(const child of node.children){const found=walk(child,id);if(found)return found;}return null;};
  const document={activeElement:null,getElementById:id=>walk(pre.card,id)};
  const pre={card:new FakeElement(),title:'Migration sync',participants:'Priya',consent:false,focused:false,
    meetingCandidates:[{key:'aaaaaaaaaaaaaaaaaaaaaaaa',provider:'Zoom',title:'Zoom Meeting'}],selectedMeetingKey:'',beginPending:false,checks:{
    mic:{state:'checking',text:'checking'},sys:{state:'no',text:'not captured'},meeting:{state:'ok',text:'1 supported meeting window found'},model:{state:'checking',text:'checking'},
    retention:{state:'ok',text:'text only'},consent:{state:'no',text:'not confirmed'},overlay:{state:'unverified',text:'not verified'},
  }};
  const el=(tag,cls,text)=>{const node=new FakeElement(tag);node.className=cls||'';node.textContent=text||'';return node;};
  const context=vm.createContext({document,localSpeech:true,SpeechRecognition:function(){},
    clear:node=>{node.replaceChildren();return node;},el,add:(parent,...nodes)=>parent.append(...nodes),
    btn:(cls,label,action)=>{const node=el('button',cls,label);node.addEventListener('click',action);return node;},
    prow(){},beginCall(){},closePreflight(){},canBegin:()=>true,whyNotBegin:()=>null,
  });
  vm.runInContext('let PRE=pre;const S={archive:"ok"};'+functions('counsel.js',['renderPreflight'])+'\nthis.run=renderPreflight;',
    Object.assign(context,{pre}));
  context.run();
  const first=document.getElementById('zc-pre-title');
  first.focus();first.setSelectionRange(3,7);
  context.run();
  const restored=document.getElementById('zc-pre-title');
  assert.notEqual(restored,first,'the dialog was rebuilt for the new check result');
  assert.equal(document.activeElement,restored);
  assert.equal(restored.selectionStart,3);
  assert.equal(restored.selectionEnd,7);
  assert.equal(restored.value,'Migration sync');
  const zoom=document.getElementById('zc-source-aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.ok(zoom,'the detected meeting is an explicit source choice');
  zoom.checked=true;zoom.listeners.change();
  assert.equal(pre.selectedMeetingKey,'aaaaaaaaaaaaaaaaaaaaaaaa');
});

test('Counsel refuses an attachment that disappears during the final pre-capture check',async()=>{
  let appended=0,started=0,renders=0;
  const pre={
    title:'Migration sync',participants:'Priya',consent:true,selectedMeetingKey:'aaaaaaaaaaaaaaaaaaaaaaaa',
    meetingCandidates:[{key:'aaaaaaaaaaaaaaaaaaaaaaaa',provider:'Zoom',title:'Zoom Meeting'}],
    beginPending:false,checks:{meeting:{state:'ok',text:'found'}},
  };
  const context=vm.createContext({
    console,Promise,Date,
    window:{zenoMeeting:{detect:async()=>({supported:true,status:'none',candidates:[]})}},
    document:{body:{dataset:{},appendChild(){appended++;}}},
    normalizeMeetingPresence:null,
    canBegin:()=>true,
    renderPreflight:()=>{renders++;},
    closePreflight(){},
    el(){return {querySelector(){return null;}};},
    startEngine(){started++;},
    fmtElapsed(){return '00:00';},
    announce(){},
  });
  vm.runInContext(
    'let PRE=pre,CALL=null;'+
      functions('counsel.js',['normalizeMeetingPresence'],'')+
      functions('counsel.js',['readMeetingPresence','beginCall'])+
      '\nthis.run=beginCall;this.getCall=()=>CALL;',
    Object.assign(context,{pre}),
  );
  await context.run();
  assert.equal(context.getCall(),null);
  assert.equal(appended,0);
  assert.equal(started,0);
  assert.equal(pre.selectedMeetingKey,'');
  assert.match(pre.checks.meeting.text,/no longer present/);
  assert.ok(renders>=2);
});
