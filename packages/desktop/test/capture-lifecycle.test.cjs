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
    if(next) return tail.slice(0,match[0].length+next.index);
    // `name` is the LAST function at this indent in the file, so there is no
    // following declaration to use as a stop boundary. Close it by matching
    // braces instead of assuming one always follows — the file's tail is
    // real product code, not a fixture, and it changes shape over time.
    const bodyStart=tail.indexOf('{');
    assert.ok(bodyStart>=0,`missing body for ${name}`);
    let depth=0,i=bodyStart;
    for(;i<tail.length;i++){
      if(tail[i]==='{') depth++;
      else if(tail[i]==='}'){depth--;if(depth===0)break;}
    }
    assert.ok(depth===0,`unbalanced braces closing ${name}`);
    return tail.slice(0,i+1);
  }).join('\n');
}
function fakeTimers(){
  let n=0;const timers=new Map();
  return {setTimeout:f=>{timers.set(++n,f);return n;},clearTimeout:id=>timers.delete(id),clearInterval(){},setInterval:()=>0,
    fire(){for(const [id,f] of [...timers]){timers.delete(id);f();}}};
}
// Renderer code is now loaded from packages/daemon/public/bind/counsel.js — the
// module the running app actually ships (index.html/bind.js load bind/*.js only).
// The pre-rebuild packages/daemon/public/counsel.js these tests used to read has
// been deleted as dead code; bind/counsel.js is a careful, close port of the same
// functions (same names, same nesting inside bindCounsel()), so each handler is
// still extracted by name — only the injected dependencies changed, because
// bind/counsel.js reaches its daemon through the shared bind.js helpers
// (getJSON/token) and its own local postJSON(), not a single ad hoc `call()`.
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
    renderLive(){},announce:s=>announcements.push(s),
    authHeaders:()=>({}),
    // bind/counsel.js's own postJSON() (extracted below, real code) calls fetch()
    // directly — this is the one native boundary that is injected, same as the
    // old harness injected a `call()` helper.
    fetch:async(url,opts)=>{
      const body=opts&&opts.body?JSON.parse(opts.body):{};
      requests.push({method:(opts&&opts.method)||'GET',url,body});
      const r=response||{ok:true,data:{meeting:{id:'saved-meeting',utterances:body.utterances},redacted:0}};
      return {ok:r.ok!==false,status:r.ok===false?500:200,json:async()=>r.data};
    },
    showCnView(){},renderAskTab(){},loadArchive:async()=>{},openMeetingById:async()=>{}});
  vm.runInContext('let CALL=null;const cache=new Map();let lastRedactedId=null,lastRedactedCount=0;\n'+
    functions('bind/counsel.js',['counselSpeechPrompt'],'')+
    functions('bind/counsel.js',['postJSON'],'')+
    functions('bind/counsel.js',['armEngine','startEngine','commit','stopEngine','teardownCall','discardCall','endCall'])+
    '\nthis.api={startEngine,endCall,discardCall,setCall:v=>CALL=v,getCall:()=>CALL};',context);
  const create=()=>{
    const c={title:'Synthetic test',participants:[],utterances:[],seq:0,speaker:'owner',interim:'',startedAt:Date.now(),
      recognition:null,want:false,running:false,paused:false,saving:false,note:null,noteTone:'warn',tick:0,
      captureIncomplete:false,emptyPrompted:false};
    context.api.setCall(c);document.body.dataset.zenoCapture='counsel';return c;
  };
  return {api:context.api,recs,requests,announcements,create,timer,document,setIdle:p=>idle=p,setResponse:v=>response=v};
}
const result=text=>({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:true})]});
// startEngine() no longer arms the recognizer synchronously: bind/counsel.js
// releases Command's voice first (`zeno:release-command-voice`) and only starts
// capture after `Promise.all(handoff.waiters).then(waitForSpeechIdle)` settles.
// setImmediate runs after every pending microtask (however many `.then()` hops
// that chain has), so it is a robust way to wait for armEngine() to have run.
const flushMicrotasks=()=>new Promise(resolve=>setImmediate(resolve));

test('Counsel End waits for the recognizer final result before posting a transcript',async()=>{
  const h=counselHarness();h.create();h.api.startEngine();await flushMicrotasks();const rec=h.recs[0];rec.onstart();
  const ending=h.api.endCall();assert.equal(h.requests.length,0);assert.equal(rec.stopped,1);
  rec.onresult(result('The final spoken phrase.'));rec.onend();await ending;
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.utterances[0].text,'The final spoken phrase.');
  assert.equal(h.api.getCall(),null);
});

test('Counsel gives local Whisper a bounded vocabulary hint for this meeting',async()=>{
  const h=counselHarness();const call=h.create();call.title='Migration sync';call.participants=['Priya','A'.repeat(700)];
  h.api.startEngine();await flushMicrotasks();const prompt=h.recs[0].initialPrompt;
  assert.match(prompt,/Zeno/);assert.match(prompt,/Counsel/);assert.match(prompt,/Migration sync/);assert.match(prompt,/Priya/);
  assert.ok(prompt.length<=512);h.api.discardCall();
});

test('Counsel keeps the speaker selected at audio onset while transcription is queued',async()=>{
  const h=counselHarness();const call=h.create();h.api.startEngine();await flushMicrotasks();const rec=h.recs[0];rec.onstart();
  const segmentMeta=rec.onsegmentstart();
  call.speaker='other';
  const event=result('Captured while I was speaking.');event.segmentMeta=segmentMeta;rec.onresult(event);
  assert.equal(call.utterances[0].speaker,'owner','changing the next-line tag cannot rewrite queued audio');
  h.api.discardCall();
});

test('Counsel Discard aborts immediately, saves nothing and releases the UI ownership flag',async()=>{
  const h=counselHarness();h.create();h.api.startEngine();await flushMicrotasks();const rec=h.recs[0];rec.onstart();rec.onresult(result('discard me'));
  h.api.discardCall();assert.equal(rec.aborted,1);assert.equal(rec.stopped,0);assert.equal(h.requests.length,0);
  assert.equal(h.api.getCall(),null);assert.equal(h.document.body.dataset.zenoCapture,undefined);
});

test('old recognizer result/end/error cannot mutate or restart a newer Counsel call',async()=>{
  const h=counselHarness();h.create();h.api.startEngine();await flushMicrotasks();const old=h.recs[0];old.onstart();h.api.discardCall();
  const current=h.create();h.api.startEngine();await flushMicrotasks();h.recs[1].onstart();
  old.onresult(result('private previous call'));old.onend();old.onerror({error:'audio-capture'});
  assert.equal(current.utterances.length,0);assert.equal(current.want,true);assert.equal(current.running,true);
  assert.equal(old.started,1);h.api.discardCall();
});

test('a bounded final-drain timeout saves available lines with an explicit incomplete warning',async()=>{
  const h=counselHarness();h.create();h.api.startEngine();await flushMicrotasks();const rec=h.recs[0];rec.onstart();rec.onresult(result('already final'));
  const ending=h.api.endCall();assert.equal(h.requests.length,0);h.timer.fire();await ending;
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.utterances[0].text,'already final');
  assert.ok(rec.aborted>=1);assert.ok(h.announcements.some(s=>s.includes('may be incomplete')));
});

test('Counsel keeps the transcript when HTTP success carries no saved-meeting proof',async()=>{
  const h=counselHarness();const call=h.create();h.api.startEngine();await flushMicrotasks();const rec=h.recs[0];rec.onstart();
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

/* ===================================================================== *
 * Command's push-to-talk / wake voice control                          *
 * ===================================================================== *
 * bind/voice.js (the shipped module) restructured this internally —
 * ensurePttRecognition/startPtt/stopPtt/abortPttNow instead of one
 * wireRecognition()/closeRecognizer() pair, and turnWakeOn/disarmWake
 * instead of a nested turnOn/turnOff/scheduleRestart. While tracing that
 * port through, abortPttNow() was found to skip a step wireRecognition()'s
 * abortPtt() always did — clearing the just-finalized transcript BEFORE
 * aborting the recognizer — so a push-to-talk phrase captured right before
 * Stop/blur/a takeover can still reach dispatchTranscript() from the
 * wrapped onend handler once it re-invokes the original one. That is a
 * real, reproducible regression in code outside this agent's lane
 * (packages/daemon/public/bind/voice.js is owned by another agent in this
 * pass), so packages/daemon/public/voice.js — the one file that still
 * clears the pending transcript before closing the mic — is kept
 * undeleted rather than silently dropping this coverage, and every test
 * below is UNCHANGED. See the task's final report for the exact fix.
 * ===================================================================== */
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
  const context=vm.createContext({
    token:()=>'owner-token',
    getJSON:async()=>({ok:true,data:{meetings:[],failed:[],archive:{readable:false,reason:'Folder is unreadable.',resolve:'Check its permissions.'}}}),
    renderList(){},syncStartGate(){},renderAskTab(){},
  });
  vm.runInContext(
    'let archiveState="loading",archiveNote="",meetings=[{id:"stale"}],failedFiles=[];\n'+
      functions('bind/counsel.js',['loadArchive'])+
      '\nthis.run=loadArchive;this.getArchiveState=()=>archiveState;this.getMeetings=()=>meetings;this.getNote=()=>archiveNote;',
    context,
  );
  await context.run();
  assert.equal(context.getArchiveState(),'error');
  assert.equal(context.getMeetings().length,0);
  assert.match(context.getNote(),/Folder is unreadable/);
  assert.match(context.getNote(),/Check its permissions/);
});

test('Counsel treats a malformed successful archive response as unknown, never empty',async()=>{
  const context=vm.createContext({
    token:()=>'owner-token',
    getJSON:async()=>({ok:true,data:{}}),
    renderList(){},syncStartGate(){},renderAskTab(){},
  });
  vm.runInContext(
    'let archiveState="loading",archiveNote="",meetings=[{id:"stale"}],failedFiles=[];\n'+
      functions('bind/counsel.js',['loadArchive'])+
      '\nthis.run=loadArchive;this.getArchiveState=()=>archiveState;this.getMeetings=()=>meetings;this.getNote=()=>archiveNote;',
    context,
  );
  await context.run();
  assert.equal(context.getArchiveState(),'error');
  assert.equal(context.getMeetings().length,0);
  assert.match(context.getNote(),/response did not contain a readable meeting list/i);
  assert.match(context.getNote(),/unknown/i);
});

test('Counsel cannot query the local model while a meeting is active',async()=>{
  const requests=[];
  const context=vm.createContext({
    postJSON:async(url,body)=>{requests.push({method:'POST',url,body});return {ok:true,data:{answer:'should not be reachable'}};},
    el:()=>({}),renderAskTab(){},answerNode:()=>({}),warmCache:async()=>{},
  });
  vm.runInContext(
    'let asking=false,archiveState="ok",CALL={title:"Active meeting"},askThread=[];'+functions('bind/counsel.js',['ask1'])+
      '\nthis.ask=ask1;this.end=()=>{CALL=null;};this.isAsking=()=>asking;',
    context,
  );

  await context.ask('Tell me what to say next');
  assert.equal(requests.length,0,'the handler guard blocks model access, even if UI disabling is bypassed');
  assert.equal(context.isAsking(),false);

  context.end();
  await context.ask('What did we decide?');
  assert.equal(requests.length,1,'post-meeting cited-note questions still use the normal route');
  assert.equal(requests[0].method,'POST');
  assert.equal(requests[0].url,'/counsel/ask');
  assert.equal(requests[0].body.question,'What did we decide?');
});

test('Counsel preflight refreshing the meeting-source check cannot touch the title or consent fields',()=>{
  // bind/counsel.js redraws the preflight dialog differently from root
  // counsel.js's renderPreflight(): the title input and consent checkboxes are
  // static markup this binder only reads, and the async meeting-window re-check
  // (refreshMeetingCandidates -> renderMeetingSources) mounts and updates its
  // OWN box rather than rebuilding the whole card. That makes the old failure
  // mode ("an async check rebuilds the field the owner is typing in and loses
  // focus/caret") structurally impossible instead of something to detect after
  // the fact — verified here by confirming these functions never reference the
  // title field or the consent boxes at all.
  const region=functions('bind/counsel.js',['ensureMeetingSourcesBox','renderMeetingSources','refreshMeetingCandidates']);
  assert.doesNotMatch(region,/titleInput/,'the async meeting-window check never touches the title field the owner is typing in');
  assert.doesNotMatch(region,/\bc1\.|\bc2\./,'the async meeting-window check never touches the consent checkboxes');
});

test('Counsel refuses an attachment that disappears during the final pre-capture check',async()=>{
  let started=0,renders=0;
  const context=vm.createContext({
    console,Promise,Date,
    window:{zenoMeeting:{detect:async()=>({supported:true,status:'none',candidates:[]})},setInterval:()=>1},
    document:{body:{dataset:{}}},
    computeWhyDisabled:()=>null,
    renderMeetingSources:()=>{renders++;},
    syncStartGate(){},
    titleInput:null,
    renderAskTab(){},
    $:()=>null,
    root:{},
    showCnView(){},
    renderLive(){},
    startEngine:()=>{started++;},
    fmtElapsed:()=>'00:00',
  });
  vm.runInContext(
    'let CALL=null,selectedMeetingKey="aaaaaaaaaaaaaaaaaaaaaaaa",'+
      'meetingCandidates=[{key:"aaaaaaaaaaaaaaaaaaaaaaaa",provider:"Zoom",title:"Zoom Meeting"}],'+
      'meetingCheck={state:"ok",text:"1 supported meeting window found"},meetingCheckPending=false;\n'+
      functions('bind/counsel.js',['normalizeMeetingPresence'],'')+'\n'+
      functions('bind/counsel.js',['readMeetingPresence','beginCall'])+
      '\nthis.run=beginCall;this.getCall=()=>CALL;this.getKey=()=>selectedMeetingKey;this.getMeetingCheck=()=>meetingCheck;',
    context,
  );
  await context.run();
  assert.equal(context.getCall(),null);
  assert.equal(started,0);
  assert.equal(context.getKey(),'');
  assert.match(context.getMeetingCheck().text,/no longer present/);
  assert.ok(renders>=2);
});
