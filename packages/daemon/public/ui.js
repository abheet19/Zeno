/* UI layer ported verbatim from design artifact b551a806.
   Interaction/navigation for every screen and CTA. Mock data is replaced by
   real daemon state in bind.js, which loads after this file. */

(function(){
  const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
  const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  // ---------- screens ----------
  const screens=$$('.screen'), navs=$$('.nav-i');
  let show=function(name){ screens.forEach(s=>s.classList.toggle('on', s.dataset.screen===name));
    navs.forEach(n=>{ n.dataset.screen===name ? n.setAttribute('aria-current','page') : n.removeAttribute('aria-current'); });
    const m=$('.main'); if(m) m.scrollTop=0; }
  navs.forEach(n=> n.addEventListener('click', ()=>{ if(n.dataset.screen) show(n.dataset.screen); }));
  document.addEventListener('click', e=>{ const j=e.target.closest('[data-screen-jump]'); if(j){ e.stopPropagation(); show(j.dataset.screenJump); } });

  // ---------- Settings (floating) ----------
  const smodal=$('#settings-modal');
  $$('[data-open-settings]').forEach(b=> b.addEventListener('click', e=>{ e.preventDefault(); smodal.hidden=false; }));
  smodal.querySelectorAll('[data-close]').forEach(b=> b.addEventListener('click', ()=> smodal.hidden=true));
  document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ smodal.hidden=true; $('#msheet').hidden=true; $('#pair-sheet').hidden=true; } });
  // Settings categories — Antigravity-style left nav, one pane at a time
  (function(){ const setTitle=smodal.querySelector('[data-set-title]'), setSub=smodal.querySelector('[data-set-sub]');
    function setCat(cat){ smodal.querySelectorAll('[data-setcat]').forEach(b=> b.dataset.setcat===cat ? b.setAttribute('aria-current','page') : b.removeAttribute('aria-current'));
      smodal.querySelectorAll('.set-pane').forEach(p=> p.classList.toggle('on', p.dataset.setpane===cat));
      const nav=smodal.querySelector('.set-navi[data-setcat="'+cat+'"]'); const pane=smodal.querySelector('.set-pane[data-setpane="'+cat+'"]');
      if(nav&&setTitle) setTitle.textContent=nav.querySelector('.lbl').textContent;
      if(pane&&setSub) setSub.textContent=pane.dataset.sub||''; const body=smodal.querySelector('.set-body2'); if(body) body.scrollTop=0; }
    smodal.querySelectorAll('[data-setcat]').forEach(b=> b.addEventListener('click', ()=> setCat(b.dataset.setcat)));
    smodal.querySelectorAll('[data-set-signout]').forEach(b=> b.addEventListener('click', ()=> toast('Owner token released — this window is now read-only. Reopen Zeno to approve again.')));
    smodal.querySelectorAll('[data-set-managemodels]').forEach(b=> b.addEventListener('click', ()=>{ smodal.hidden=true; toast('The model manager lives in Forge → ＋ Models — pull or remove local models there.'); }));
    smodal.querySelectorAll('[data-set-customize]').forEach(b=> b.addEventListener('click', e=>{ e.preventDefault(); smodal.hidden=true; toast('Customize: Skills · Connectors · Plugins — each added by you, all behind the approval gate.'); }));
  })();
  function grp(sel){ $$(sel).forEach(b=> b.addEventListener('click', ()=>{ b.parentElement.querySelectorAll('[aria-current]').forEach(x=>x.removeAttribute('aria-current')); b.setAttribute('aria-current','page'); })); }
  grp('.filterpill'); grp('.segsm button');
  $$('.toggle').forEach(t=>{ if(t.id==='rm-toggle') return; const f=()=> t.setAttribute('aria-checked', t.getAttribute('aria-checked')==='true'?'false':'true'); t.addEventListener('click',f); t.addEventListener('keydown',e=>{ if(e.key===' '||e.key==='Enter'){ e.preventDefault(); f(); } }); });
  $$('.composer textarea').forEach(t=> t.addEventListener('input', ()=>{ t.style.height='auto'; t.style.height=Math.min(t.scrollHeight,160)+'px'; }));

  // Receipts: click a row to open its detail
  document.addEventListener('click', e=>{ const r=e.target.closest('[data-toggle-detail]'); if(!r) return; const d=r.nextElementSibling; if(d&&d.classList.contains('rdetail')) d.hidden=!d.hidden; });
  // Vault import preview
  const ic=$('#import-card'); $$('[data-import]').forEach(b=> b.addEventListener('click', ()=>{ ic.hidden=false; ic.scrollIntoView({block:'nearest'}); }));
  $$('[data-import-cancel]').forEach(b=> b.addEventListener('click', ()=> ic.hidden=true));

  // ---------- CHAT MODEL: Home = live chat; Chats = history, open one to continue ----------
  let WORK_ID=9; function nextWork(){ WORK_ID=10+CHATS.length; return WORK_ID; }
  const TASK_RE=/\b(rotate|add|fix|build|create|refactor|write|implement|deploy|update|remove|rename|migrate|test|ship|change|make)\b/i;
  const CHATS=[
    { title:'What changed in the sandbox since my last approval?', became:'answered', when:'2m ago', turns:[
      {who:'you', html:'<p>What changed in the sandbox since my last approval?</p>'},
      {who:'z', html:'<details class="thinking" open><summary><b>Working…</b> read local state · 3 steps · 0.6s</summary><span>· read <span class="cite">/state</span> — 2 uncommitted files</span><span>· read <span class="cite">/forge/status</span> — 1 run applied, 1 waiting</span><span>· diffed the sandbox against the last sealed receipt</span></details><p>Two files changed since receipt <span class="cite">78f2…6ce4</span>: <b>src/App.tsx</b> (a 48-byte edit an agent applied after your approval) and <b>src/ingest.ts</b> (still uncommitted, waiting on the INGEST-12 decision). Nothing reached the network.</p>'} ]},
    { title:'Draft a task to rotate the ingest token', became:'→ Forge · INGEST-12', when:'1h ago', turns:[
      {who:'you', html:'<p>Draft a task to rotate the ingest token</p>'},
      {who:'z', html:'<p>That reads as work. I drafted it as <b>INGEST-12</b> (T2) and routed it to Forge — the proposed fix is now waiting for your approval.</p>'} ]},
    { title:"Summarize today's receipts", became:'answered', when:'3h ago', turns:[
      {who:'you', html:"<p>Summarize today's receipts</p>"},
      {who:'z', html:'<p>Four effects settled today, all sealed and chain-verified: one T2 write to <b>src/App.tsx</b>, one T1 Forge run that added three test files, one memory commit, and one T2 commit "scaffold the App shell".</p>'} ]}
  ];
  const chatsList=$('#chats-list'), chatsListView=$('#chats-list-view'), chatsOpen=$('#chats-open-view'), chatsTurns=$('#chats-turns'), chatsTitle=$('#chats-title'), chatsCount=$('#chats-count');
  let openChatIdx=null;
  function turnEl(t){ const d=document.createElement('div'); d.className='turn '+t.who; d.innerHTML='<div class="who">'+(t.who==='you'?'A':'Z')+'</div><div class="bt">'+t.html+'</div>'; return d; }
  function renderChatsList(){ chatsList.innerHTML=''; chatsCount.textContent=CHATS.length;
    CHATS.forEach((c,i)=>{ const r=document.createElement('div'); r.className='lrow'; r.dataset.chat=i;
      const pill = c.became.startsWith('→') ? '<span class="pill cy"><span class="d"></span>'+esc(c.became)+'</span>' : '<span class="pill wt">'+esc(c.became)+'</span>';
      r.innerHTML='<span class="tier">'+esc(c.when)+'</span><div><div class="tt">'+esc(c.title)+'</div><div class="mm">'+c.turns.length+' turns</div></div>'+pill; chatsList.append(r); }); }
  function openChat(i){ openChatIdx=i; const c=CHATS[i]; chatsTitle.textContent=c.title; chatsTurns.innerHTML=''; c.turns.forEach(t=> chatsTurns.append(turnEl(t)));
    chatsListView.hidden=true; chatsOpen.hidden=false; }
  chatsList.addEventListener('click', e=>{ const r=e.target.closest('[data-chat]'); if(r) openChat(+r.dataset.chat); });
  $('#chats-back').addEventListener('click', ()=>{ chatsOpen.hidden=true; chatsListView.hidden=false; openChatIdx=null; });
  renderChatsList();

  function zenoReply(text){ const isTask=TASK_RE.test(text);
    if(isTask) return { isTask, html:'<p>That reads as work, not a question. I\'ll draft it as a ticket and route it to Forge — nothing runs until you approve the result.</p><div class="route"><span>Draft <b>WORK-'+(nextWork())+'</b> · T1 · agent: local qwen3:8b</span><span class="grow"></span><button class="btn p sm" data-route="forge">Start in Forge</button><button class="btn g sm" data-route="answer">Just answer</button></div>' };
    return { isTask, html:'<details class="thinking" open><summary><b>Working…</b> read local state · 2 steps · 0.4s</summary><span>· read <span class="cite">/state</span></span><span>· read <span class="cite">/memory</span> — 2 recalled</span></details><p>Grounded from your local snapshot — here\'s what I can say with citations. (In the live app this is the model\'s answer over <span class="cite">/state</span> and your Vault; it never approves anything.)</p>' }; }

  // route chips (delegated, both threads)
  document.addEventListener('click', e=>{ const b=e.target.closest('[data-route]'); if(!b) return; const wrap=b.closest('.turns'); const route=b.closest('.route');
    if(b.dataset.route==='forge'){ route.innerHTML='<span><b>Drafted</b> as a ticket and routed to Forge. It now shows in <b>Work</b>; the result will come back here as an approval.</span><span class="grow"></span><button class="btn g sm" data-screen-jump="work">Open Work</button>';
      const wl=$('#work-list'); if(wl){ const r=document.createElement('div'); r.className='lrow'; r.innerHTML='<span class="tier">WORK-'+(WORK_ID)+'</span><div><div class="tt">'+esc(wrap.dataset.lastTask||'New task from Home')+'</div><div class="mm">T1 · routed to Forge · from chat</div></div><span class="pill cy"><span class="d"></span>in Forge</span>'; wl.prepend(r); $('#work-count').textContent=wl.children.length; } }
    else { route.innerHTML='<span>Okay — answering instead of building.</span>'; } });

  // ---- Home: the live chat, in place ----
  const heroBlock=$('#hero-block'), startersBlock=$('#starters-block'), homeThread=$('#home-thread'), homeTurns=$('#home-turns'), homeTA=$('#home-ta');
  let homeChat=null;
  function enterThread(){ heroBlock.hidden=true; startersBlock.hidden=true; homeThread.hidden=false; }
  function resetHome(){ heroBlock.hidden=false; startersBlock.hidden=false; homeThread.hidden=true; homeTurns.innerHTML=''; homeChat=null; homeTA.value=''; homeTA.style.height='auto'; ORB.kick(); }
  function sendHome(){ const t=homeTA.value.trim(); if(!t) return; enterThread();
    if(!homeChat){ homeChat={ title:t.length>64?t.slice(0,61)+'…':t, became:'answered', when:'now', turns:[] }; CHATS.unshift(homeChat); }
    const you={who:'you', html:'<p>'+esc(t)+'</p>'}; homeChat.turns.push(you); homeTurns.append(turnEl(you));
    const r=zenoReply(t); const z={who:'z', html:r.html}; homeChat.turns.push(z); homeTurns.append(turnEl(z)); homeTurns.dataset.lastTask=t;
    if(r.isTask) homeChat.became='→ Forge';
    renderChatsList(); homeTA.value=''; homeTA.style.height='auto'; homeTurns.lastElementChild.scrollIntoView({block:'end',behavior:'smooth'}); }
  $('#home-send').addEventListener('click', sendHome);
  homeTA.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendHome(); } });
  $('#home-newchat').addEventListener('click', resetHome);
  $$('[data-newchat]').forEach(b=> b.addEventListener('click', ()=>{ resetHome(); show('home'); homeTA.focus(); }));
  $$('[data-fill]').forEach(b=> b.addEventListener('click', ()=>{ homeTA.value=b.dataset.fill; homeTA.dispatchEvent(new Event('input')); homeTA.focus(); }));

  // ---- Chats: continue an opened conversation ----
  function sendChats(){ const ta=$('#chats-ta'), t=ta.value.trim(); if(!t||openChatIdx===null) return; const c=CHATS[openChatIdx];
    const you={who:'you', html:'<p>'+esc(t)+'</p>'}; c.turns.push(you); chatsTurns.append(turnEl(you));
    const r=zenoReply(t); const z={who:'z', html:r.html}; c.turns.push(z); chatsTurns.append(turnEl(z)); chatsTurns.dataset.lastTask=t; if(r.isTask) c.became='→ Forge';
    ta.value=''; ta.style.height='auto'; chatsTurns.lastElementChild.scrollIntoView({block:'end',behavior:'smooth'}); renderChatsList(); }
  $('#chats-send').addEventListener('click', sendChats);
  $('#chats-ta').addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChats(); } });


  // ---------- PRODUCT SWITCH: Command / Forge / Counsel ----------
  const products=$$('.product'), segBtns=$$('.seg [data-product]'), TITLES={command:'Zeno Command',forge:'Zeno Forge',counsel:'Zeno Counsel'};
  function showProduct(p){ products.forEach(x=> x.classList.toggle('on', x.dataset.product===p)); segBtns.forEach(b=>{ b.dataset.product===p ? b.setAttribute('aria-current','page') : b.removeAttribute('aria-current'); });
    document.title=TITLES[p]||'Zeno'; if(p==='command'){ setTimeout(()=>{ size(); ORB.kick(); },0); } }
  segBtns.forEach(b=> b.addEventListener('click', ()=> showProduct(b.dataset.product)));
  document.addEventListener('click', e=>{ const g=e.target.closest('[data-product-go]'); if(!g) return; showProduct(g.dataset.productGo); if(g.dataset.then) show(g.dataset.then); });

  // ---------- FORGE — native workbench + Zeno session ----------
  const ide=$('#ide');
  const IDE_VISIBLE=()=> $('.product[data-product="forge"]').classList.contains('on');
  // Agent | Editor
  // The agent lives in the secondary side panel (Ctrl+Alt+B toggles it) — it is not a mode, so there is no Agent/Editor switch.
  // Forge run-mode: Code / Ask / Plan (Ask = read-only, Plan = plan-first, Code = governed writes)
  const FMODES=[
    {id:'code', label:'Code', glyph:'</>', desc:'Can write and edit code', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12"/></svg>'},
    {id:'ask', label:'Ask', glyph:'◇', desc:'Reads but won’t edit', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/></svg>'},
    {id:'plan', label:'Plan', glyph:'▤', desc:'Plan changes before implementing', icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l5 5v13H6z"/><path d="M9 12h7M9 16h5M14 3v6h6"/></svg>'} ];
  let FMODE='code', fmodeEl=null;
  function applyFmode(id){ const m=FMODES.find(x=>x.id===id)||FMODES[0]; FMODE=m.id; const k=$('#s-kind'); if(k) k.textContent=m.glyph+' '+m.label+' ▾'; }
  function closeFmode(){ if(fmodeEl){ fmodeEl.remove(); fmodeEl=null; } }
  function openFmode(anchor){ if(fmodeEl){ closeFmode(); return; } fmodeEl=document.createElement('div'); fmodeEl.className='fmode-menu'; fmodeEl.setAttribute('role','menu');
    fmodeEl.innerHTML=FMODES.map(m=>'<button class="fmode-opt" role="menuitemradio" data-fmode="'+m.id+'" aria-checked="'+(FMODE===m.id)+'"><span class="mi">'+m.icon+'</span><span class="t"><b>'+m.label+'</b><span>'+esc(m.desc)+'</span></span><span class="ck">'+(FMODE===m.id?'✓':'')+'</span></button>').join('')+'<div class="fmode-foot">Use <kbd>Ctrl .</kbd> to switch modes</div>';
    document.body.append(fmodeEl); fmodeEl.querySelectorAll('[data-fmode]').forEach(b=> b.addEventListener('click', ()=>{ const id=b.dataset.fmode; applyFmode(id); closeFmode(); if(id==='ask') toast('Ask mode — Zeno reads and answers, grounded in your repo; it never edits files.'); else if(id==='plan') toast('Plan mode — Zeno drafts a plan for your approval before it touches code.'); }));
    const r=anchor.getBoundingClientRect(); const h=fmodeEl.offsetHeight||170; fmodeEl.style.left=Math.max(8,r.left)+'px'; fmodeEl.style.top=Math.max(8,r.top-h-8)+'px'; }
  { const sk=$('#s-kind'); if(sk){ applyFmode('code'); sk.addEventListener('click', e=>{ e.stopPropagation(); openFmode(sk); }); } }
  document.addEventListener('click', e=>{ if(fmodeEl && !e.target.closest('.fmode-menu') && e.target.id!=='s-kind') closeFmode(); });
  // layout toggles (duplicated in title bar + panel; keep them in sync)
  function syncLayout(k, on){ $$('[data-layout="'+k+'"]').forEach(x=> x.setAttribute('aria-pressed', on?'true':'false')); ide.classList.toggle('no-'+k, !on); }
  $$('[data-layout]').forEach(b=> b.addEventListener('click', ()=>{ const k=b.dataset.layout; syncLayout(k, ide.classList.contains('no-'+k)); }));
  // activity bar → side bar views
  $$('.vsact [data-vsview]').forEach(b=> b.addEventListener('click', ()=>{ const cur=b.hasAttribute('aria-current'); if(cur && !ide.classList.contains('no-side')){ syncLayout('side', false); return; }
    $$('.vsact [data-vsview]').forEach(x=>x.removeAttribute('aria-current')); b.setAttribute('aria-current','page'); $$('.vsside .vsview').forEach(v=> v.classList.toggle('on', v.dataset.vsview===b.dataset.vsview)); syncLayout('side', true); }));
  $$('[data-vsgo]').forEach(b=> b.addEventListener('click', ()=> $('.vsact [data-vsview="'+b.dataset.vsgo+'"]').click()));
  // explorer tree
  $$('.vsdir[data-dir]').forEach(d=> d.addEventListener('click', ()=>{ const kids=d.nextElementSibling; const open=d.classList.toggle('open'); d.querySelector('.chev').textContent=open?'▾':'▸'; if(kids&&kids.classList.contains('vskids')) kids.hidden=!open; }));
  $$('.vssect').forEach(s=> s.addEventListener('click', e=>{ if(e.target.closest('.fico')) return; const c=s.querySelector('.chev'); if(!c) return; const open=s.classList.toggle('open'); c.textContent=open?'▾':'▸'; let n=s.nextElementSibling; while(n && !n.classList.contains('vssect') && !n.classList.contains('vsvh')){ n.hidden=!open; n=n.nextElementSibling; } }));
  const CODE={ 'App.tsx': $('#vs-code').innerHTML,
    'ingest.ts': $('#vs-pane2 .fcode').innerHTML,
    'ingest.spec.ts': '<span class="ln">1</span><span class="kw">import</span> { describe, it, expect } <span class="kw">from</span> <span class="st">\'vitest\'</span>\n<span class="ln">2</span><span class="kw">import</span> { readFileSync } <span class="kw">from</span> <span class="st">\'node:fs\'</span>\n<span class="ln">3</span>\n<span class="ln add">4</span><span class="add"><span class="fn">describe</span>(<span class="st">\'ingest token\'</span>, () =&gt; {</span>\n<span class="ln add">5</span><span class="add">  <span class="fn">it</span>(<span class="st">\'never references the retired V1 token\'</span>, () =&gt; {</span>\n<span class="ln add">6</span><span class="add">    <span class="kw">const</span> src = readFileSync(<span class="st">\'src/ingest.ts\'</span>, <span class="st">\'utf8\'</span>)</span>\n<span class="ln add">7</span><span class="add">    expect(src).not.toContain(<span class="st">\'INGEST_TOKEN_V1\'</span>)</span>\n<span class="ln add">8</span><span class="add">  })</span>\n<span class="ln add">9</span><span class="add">})</span>',
    'kernel.ts': '<span class="ln">1</span><span class="cm">// classify → preview → approve → commit. One attempt. Content-addressed.</span>\n<span class="ln">2</span><span class="kw">export function</span> <span class="fn">propose</span>(effect: Effect) {\n<span class="ln">3</span>  <span class="kw">return</span> preview(classify(effect))   <span class="cm">// never commits here</span>\n<span class="ln">4</span>}',
    'Capsule.tsx': '<span class="ln">1</span><span class="kw">export function</span> <span class="fn">Capsule</span>({ items, onApprove }: Props) {\n<span class="ln">2</span>  <span class="cm">/* one row per held action; the seal is drawn only from a receipt */</span>\n<span class="ln">3</span>}',
    'Receipt.tsx': '<span class="ln">1</span><span class="kw">export function</span> <span class="fn">Receipt</span>({ seal, prev }: Props) {\n<span class="ln">2</span>  <span class="cm">/* Ed25519 · hash-chained · never drawn on a click */</span>\n<span class="ln">3</span>}',
    'types.ts': '<span class="ln">1</span><span class="kw">export type</span> Tier = <span class="nu">0</span> | <span class="nu">1</span> | <span class="nu">2</span> | <span class="nu">3</span> | <span class="nu">4</span>\n<span class="ln">2</span><span class="kw">export type</span> Effect = { kind: <span class="st">\'fs.write\'</span> | <span class="st">\'vcs.commit\'</span> | <span class="st">\'net.egress\'</span>; hash: string; tier: Tier }',
    'README.md': '<span class="ln">1</span><span class="cm"># sandbox</span>\n<span class="ln">2</span>A Zeno scratch repository. Every change here arrives as an approval.',
    'AGENTS.md': '<span class="ln">1</span><span class="cm"># Rules for agents working in this repository</span>\n<span class="ln">2</span>- Propose; never apply. Every effect goes through the approval kernel.\n<span class="ln">3</span>- Minimal, root-cause changes. No drive-by refactors.\n<span class="ln">4</span>- Tests live beside the code they cover.\n<span class="ln">5</span>- Never say a thing was sent, saved or verified unless a receipt says so.',
    'CLAUDE.md': '<span class="ln">1</span><span class="cm"># Claude Code · project instructions</span>\n<span class="ln">2</span>- Run <span class="st">`npm test`</span> before proposing.\n<span class="ln">3</span>- Ask before touching <span class="st">.zeno/</span>.',
    '.gitignore': '<span class="ln">1</span>node_modules/\n<span class="ln">2</span>dist/\n<span class="ln">3</span>.zeno/proposer.token',
    'package.json': '<span class="ln">1</span>{\n<span class="ln">2</span>  <span class="st">"name"</span>: <span class="st">"sandbox"</span>,\n<span class="ln">3</span>  <span class="st">"scripts"</span>: { <span class="st">"test"</span>: <span class="st">"vitest run"</span>, <span class="st">"typecheck"</span>: <span class="st">"tsc --noEmit"</span> }\n<span class="ln">4</span>}',
    'tsconfig.json': '<span class="ln">1</span>{ <span class="st">"compilerOptions"</span>: { <span class="st">"strict"</span>: <span class="kw">true</span>, <span class="st">"jsx"</span>: <span class="st">"react-jsx"</span> } }' };
  const ICON=n=> /\.tsx$/.test(n)?'tsx':/\.ts$/.test(n)?'ts':/\.md$/.test(n)?'md':/\.json$/.test(n)?'json':/gitignore/.test(n)?'git':'txt';
  const ICONTXT=k=> k==='md'?'M↓':k==='json'?'{}':k==='git'?'◆':k==='txt'?'≡':'TS';
  function openFile(name){ $$('.vsfile[data-file]').forEach(f=> f.classList.toggle('on', f.dataset.file===name)); let tab=$$('.vstab').find(t=>t.dataset.vstab===name);
    if(!tab){ tab=document.createElement('button'); tab.className='vstab'; tab.dataset.vstab=name; const k=ICON(name); tab.innerHTML='<span class="vsi '+k+'">'+ICONTXT(k)+'</span>'+name+'<span class="x">×</span>'; $('.vstabs .fgrow').before(tab); bindTab(tab); }
    $$('.vstab').forEach(t=> t.setAttribute('aria-selected', t===tab?'true':'false')); $('#vs-crumb').textContent=name; $('#tb-cmd').textContent='sandbox — '+name;
    $('#vs-code').innerHTML=CODE[name]||('<span class="ln">1</span><span class="cm">// '+name+' — opened read-only</span>'); $('.vsstat [data-lang]').textContent=({tsx:'TypeScript JSX',ts:'TypeScript',md:'Markdown',json:'JSON',git:'Ignore',txt:'Plain Text'})[ICON(name)]; }
  function bindTab(t){ t.addEventListener('click', e=>{ if(e.target.classList.contains('x')){ e.stopPropagation(); const all=$$('.vstab'); if(all.length>1){ const next=(t.nextElementSibling&&t.nextElementSibling.classList.contains('vstab'))?t.nextElementSibling:all.find(x=>x!==t); t.remove(); openFile(next.dataset.vstab); } return; } openFile(t.dataset.vstab); }); }
  $$('.vsfile[data-file]').forEach(f=> f.addEventListener('click', ()=> openFile(f.dataset.file)));
  $$('.vstab').forEach(bindTab);
  $$('.vsresl').forEach(r=> r.addEventListener('click', ()=> openFile(r.previousElementSibling&&r.previousElementSibling.classList.contains('vsresf')? r.previousElementSibling.textContent.trim().split(/\s/)[1]||'ingest.ts' : 'ingest.ts')));
  $('#vs-split').addEventListener('click', ()=>{ const p=$('#vs-pane2'); p.hidden=!p.hidden; });
  document.addEventListener('click', e=>{ const o=e.target.closest('[data-file-open]'); if(o){ showProduct('forge'); openFile(o.dataset.fileOpen); } });
  // bottom panel
  function showPanel(name){ $$('.vsptabs [data-vsp]').forEach(b=> b.setAttribute('aria-selected', b.dataset.vsp===name?'true':'false')); $$('.vspbody .vsp').forEach(p=> p.classList.toggle('on', p.dataset.vsp===name)); syncLayout('panel', true); }
  $$('.vsptabs [data-vsp]').forEach(b=> b.addEventListener('click', ()=> showPanel(b.dataset.vsp)));
  document.addEventListener('click', e=>{ const o=e.target.closest('[data-vsp-open]'); if(o){ showPanel(o.dataset.vspOpen); if(o.dataset.vspOpen==='terminal') termIn.focus(); } });
  $('#vsp-max').addEventListener('click', ()=> ide.classList.toggle('panel-max'));
  $('#vsp-hide').addEventListener('click', ()=> syncLayout('panel', false));
  // terminal — real one-shot commands with honest exit codes; effects are held for approval
  const term=$('#vs-term'), termIn=$('#vs-termin'); const PS='PS D:\\Code\\Zeno\\.zeno\\sandbox&gt; ';
  const TERM={
    'git status': ' M src/App.tsx\n M src/ingest.ts\n?? tests/ingest.spec.ts', 'git status --short': ' M src/App.tsx\n M src/ingest.ts\n?? tests/ingest.spec.ts',
    'git log': 'c41e0f2 (HEAD -> main) scaffold the App shell · sealed 78f2…6ce4\n9ab77d1 init sandbox', 'git diff --stat': ' src/App.tsx   | 1 +\n src/ingest.ts | 2 +-\n 2 files changed, 2 insertions(+), 1 deletion(-)',
    'npm test': '\n RUN  v2.1.0  D:/Code/Zeno/.zeno/sandbox\n\n ✓ tests/ingest.spec.ts (1)\n ✓ 141 existing tests\n\n Test Files  8 passed (8)\n      Tests  142 passed (142)\n   Duration  3.1s', 'npm run typecheck': 'tsc --noEmit\n(no errors)',
    'ls': 'src  tests  docs  .zeno  AGENTS.md  CLAUDE.md  package.json  tsconfig.json', 'dir': 'src  tests  docs  .zeno  AGENTS.md  CLAUDE.md  package.json  tsconfig.json', 'pwd': 'D:\\Code\\Zeno\\.zeno\\sandbox',
    'node -v': 'v22.11.0', 'npm -v': '10.9.0', 'zeno status': 'daemon 127.0.0.1:7317 · owner token held · policy built-in · chain verified (7 receipts) · 1 approval waiting',
    'help': 'This is a real shell scoped to the worktree. Read-only commands run now. Anything that writes outside the worktree, pushes, or leaves this machine is classified and held for your approval in Command.' };
  const HELD=[/^git (push|commit)/, /^rm /, /^del /, /^curl /, /^npm publish/, /^npx .*deploy/, /^scp /, /^ssh /];
  function runTerm(cmd){ const c=cmd.trim(); if(!c) return; let out, code=0;
    if(c==='clear'){ term.innerHTML=PS+'<span id="vs-termecho"></span><span class="cursor">▍</span>'; return; }
    if(HELD.some(r=>r.test(c))){ out='<span style="color:var(--amber)">held</span> — this is an effect, not a read. Previewed as T2 and sent to Command → Approvals; nothing ran. (exited 0 · held)'; }
    else if(TERM[c]!==undefined){ out=esc(TERM[c]); }
    else if(/^echo /.test(c)){ out=esc(c.slice(5)); }
    else { out='<span style="color:var(--red)">'+esc(c.split(' ')[0])+' : not recognized in this sandbox — exited 1</span>'; code=1; }
    $('#vs-termecho').insertAdjacentHTML('beforebegin', esc(c)+'\n'+out+'\n'+PS); term.scrollTop=term.scrollHeight; if(code) $('#vs-lastexit').textContent='exit 1'; else $('#vs-lastexit').textContent='exit 0'; }
  term.addEventListener('click', ()=> termIn.focus());
  termIn.addEventListener('input', ()=>{ $('#vs-termecho').textContent=termIn.value; });
  termIn.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); const v=termIn.value; termIn.value=''; $('#vs-termecho').textContent=''; runTerm(v); } });
  // menus + command center
  const MENUS={ File:[['New File','Ctrl+N',()=>openFile('untitled-1.ts')],['New Window','Ctrl+Shift+N'],['Open Folder…','Ctrl+K Ctrl+O'],'-',['Save','Ctrl+S',()=>toast('Saved to the worktree — nothing applied until you approve')],['Save All','Ctrl+K S'],['Auto Save ✓'],'-',['Preferences → Settings','Ctrl+,',()=>{ smodal.hidden=false; }],'-',['Exit','Alt+F4']],
    Edit:[['Undo','Ctrl+Z'],['Redo','Ctrl+Y'],'-',['Cut','Ctrl+X'],['Copy','Ctrl+C'],['Paste','Ctrl+V'],'-',['Find','Ctrl+F'],['Replace','Ctrl+H'],['Find in Files','Ctrl+Shift+F',()=>$('.vsact [data-vsview="search"]').click()]],
    Selection:[['Select All','Ctrl+A'],['Expand Selection','Shift+Alt+→'],['Add Cursor Below','Ctrl+Alt+↓'],['Select All Occurrences','Ctrl+Shift+L']],
    View:[['Command Palette…','Ctrl+Shift+P',()=>openQuick('>')],['Open View…'],'-',['Explorer','Ctrl+Shift+E',()=>$('.vsact [data-vsview="explorer"]').click()],['Search','Ctrl+Shift+F',()=>$('.vsact [data-vsview="search"]').click()],['Source Control','Ctrl+Shift+G',()=>$('.vsact [data-vsview="scm"]').click()],['Extensions','Ctrl+Shift+X',()=>$('.vsact [data-vsview="extensions"]').click()],['Zeno',null,()=>$('.vsact [data-vsview="zeno"]').click()],'-',['Terminal','Ctrl+`',()=>{ showPanel('terminal'); termIn.focus(); }],['Problems','Ctrl+Shift+M',()=>showPanel('problems')],['Toggle Panel','Ctrl+J',()=>$('[data-layout="panel"]').click()],['Toggle Primary Side Bar','Ctrl+B',()=>$('[data-layout="side"]').click()],['Toggle Session Panel','Ctrl+Alt+B',()=>$('[data-layout="sess"]').click()],'-',['Word Wrap','Alt+Z'],['Minimap ✓']],
    Go:[['Go to File…','Ctrl+P',()=>openQuick('')],['Go to Symbol…','Ctrl+Shift+O',()=>openQuick('@')],['Go to Line…','Ctrl+G',()=>openQuick(':')],'-',['Back','Alt+←'],['Forward','Alt+→'],'-',['Next Problem','F8'],['Previous Problem','Shift+F8']],
    Run:[['Start Debugging','F5',null,'no launch.json'],['Run Without Debugging','Ctrl+F5',null,'no launch.json'],'-',['Add Configuration…',null,()=>openFile('launch.json')],['Run Tests',null,()=>{ showPanel('terminal'); runTerm('npm test'); }]],
    Terminal:[['New Terminal','Ctrl+Shift+`',()=>{ showPanel('terminal'); term.insertAdjacentHTML('beforeend','\n'+PS); termIn.focus(); }],['Split Terminal','Ctrl+Shift+5'],'-',['Run Task…',null,()=>openQuick('task ')],['Run Build Task…','Ctrl+Shift+B',()=>{ showPanel('terminal'); runTerm('npm run typecheck'); }],['Run Test Task…',null,()=>{ showPanel('terminal'); runTerm('npm test'); }]],
    Help:[['Welcome'],['Show All Commands','Ctrl+Shift+P',()=>openQuick('>')],['Documentation'],['Keyboard Shortcuts Reference','Ctrl+K Ctrl+R'],'-',['View Receipts',null,()=>{ showProduct('command'); show('receipts'); }],['About Zeno',null,()=>toast('Zeno 0.9 · release 662f5e7 · daemon 127.0.0.1:7317 · local-first')]] };
  let menuEl=null; function closeMenu(){ if(menuEl){ menuEl.remove(); menuEl=null; } $$('.tbmenu button[aria-expanded]').forEach(b=>b.removeAttribute('aria-expanded')); }
  function openMenu(btn){ closeMenu(); const items=MENUS[btn.textContent.trim()]; if(!items) return; btn.setAttribute('aria-expanded','true'); menuEl=document.createElement('div'); menuEl.className='menu'; const r=btn.getBoundingClientRect(); menuEl.style.left=r.left+'px'; menuEl.style.top=(r.bottom+4)+'px';
    items.forEach(it=>{ if(it==='-'){ menuEl.append(document.createElement('hr')); return; } const b=document.createElement('button'); b.innerHTML=esc(it[0])+(it[3]?' <span style="color:var(--ink-3);font-size:11px">— '+esc(it[3])+'</span>':'')+(it[1]?'<kbd>'+esc(it[1])+'</kbd>':''); if(it[3]) b.disabled=true; b.addEventListener('click', ()=>{ closeMenu(); if(it[2]) it[2](); else toast(it[0]+' — no-op in this prototype'); }); menuEl.append(b); }); document.body.append(menuEl); }
  $$('.tbmenu button').forEach(b=>{ b.addEventListener('click', e=>{ e.stopPropagation(); b.getAttribute('aria-expanded')==='true' ? closeMenu() : openMenu(b); }); b.addEventListener('mouseenter', ()=>{ if(menuEl) openMenu(b); }); });
  document.addEventListener('click', e=>{ if(menuEl && !e.target.closest('.menu')) closeMenu(); });
  // quick open (Ctrl+P) — files, > commands, : line, @ symbol
  const quick=$('#quick'), quickIn=$('#quick-in'), quickList=$('#quick-list');
  const FILES=Object.keys(CODE).concat(['tests/ingest.spec.ts','.zeno/policy.json']);
  const CMDS=[['Zeno: Start a governed run',()=>{ syncLayout('sess', true); newSession(); }],['Zeno: Review approvals',()=>{ showProduct('command'); show('approvals'); }],['Zeno: Show receipts',()=>{ showProduct('command'); show('receipts'); }],['Zeno: Choose model…',()=>openModelPicker($('#s-model'))],['View: Toggle Terminal',()=>showPanel('terminal')],['View: Toggle Minimap'],['Preferences: Open Settings',()=>{ smodal.hidden=false; }],['Git: Commit (governed)',()=>$('.vsact [data-vsview="scm"]').click()],['Extensions: Install Extensions',()=>$('.vsact [data-vsview="extensions"]').click()],['Test: Run All Tests',()=>{ showPanel('terminal'); runTerm('npm test'); }]];
  function openQuick(prefix){ quick.hidden=false; quickIn.value=prefix; quickIn.focus(); renderQuick(); }
  function renderQuick(){ const v=quickIn.value; quickList.innerHTML=''; let rows=[];
    if(v.startsWith('>')){ const q=v.slice(1).trim().toLowerCase(); rows=CMDS.filter(c=>c[0].toLowerCase().includes(q)).map(c=>({t:c[0], m:'command', go:c[1]})); }
    else if(v.startsWith(':')){ rows=[{t:'Go to line '+(v.slice(1)||'…'), m:'App.tsx has 11 lines', go:()=>{}}]; }
    else if(v.startsWith('@')){ rows=['App','createIngestClient','Capsule','usePending'].filter(s=>s.toLowerCase().includes(v.slice(1).toLowerCase())).map(s=>({t:s, m:'symbol · App.tsx', go:()=>openFile('App.tsx')})); }
    else if(v.startsWith('task ')){ rows=['npm: test','npm: typecheck','zeno: seal receipt (governed)'].map(s=>({t:s, m:'task', go:()=>{ showPanel('terminal'); runTerm(s.startsWith('npm: ')?'npm '+(s.slice(5)==='test'?'test':'run typecheck'):'zeno status'); }})); }
    else { const q=v.trim().toLowerCase(); rows=FILES.filter(f=>f.toLowerCase().includes(q)).map(f=>({t:f.split('/').pop(), m:f.includes('/')?f:'src/'+f, go:()=>openFile(f.split('/').pop())})); }
    if(!rows.length) rows=[{t:'No matching results', m:'', go:()=>{}}];
    rows.forEach((r,i)=>{ const b=document.createElement('button'); b.className='mp-row'; if(i===0) b.setAttribute('aria-checked','true'); b.innerHTML='<span class="mi"></span><span class="mn">'+esc(r.t)+'<span>'+esc(r.m)+'</span></span><span></span>'; b.addEventListener('click', ()=>{ quick.hidden=true; r.go(); }); quickList.append(b); }); }
  quickIn.addEventListener('input', renderQuick);
  quickIn.addEventListener('keydown', e=>{ if(e.key==='Enter'){ const f=quickList.querySelector('.mp-row'); if(f) f.click(); } if(e.key==='Escape') quick.hidden=true; });
  quick.addEventListener('click', e=>{ if(e.target===quick) quick.hidden=true; });
  $('.tbcmd').addEventListener('click', ()=>openQuick(''));
  // keyboard — only while Forge is on screen
  document.addEventListener('keydown', e=>{ if(!IDE_VISIBLE()) return; const k=e.key.toLowerCase();
    if(e.ctrlKey && !e.altKey && k==='p'){ e.preventDefault(); openQuick(e.shiftKey?'>':''); }
    else if(e.ctrlKey && !e.altKey && k==='b'){ e.preventDefault(); $('[data-layout="side"]').click(); }
    else if(e.ctrlKey && e.altKey && k==='b'){ e.preventDefault(); $('[data-layout="sess"]').click(); }
    else if(e.ctrlKey && k==='j'){ e.preventDefault(); $('[data-layout="panel"]').click(); }
    else if(e.ctrlKey && k==='`'){ e.preventDefault(); showPanel('terminal'); termIn.focus(); }
    else if(e.ctrlKey && k==='.'){ e.preventDefault(); if(!$('#s-body').dataset.open) newSession(); $('#s-ta').focus(); }
    else if(e.ctrlKey && k==='l'){ e.preventDefault(); syncLayout('sess', true); $('#s-ta').focus(); }
    else if(e.key==='Escape'){ quick.hidden=true; closeMenu(); closeModelPicker(); } });
  // toast
  function toast(msg){ let t=$('#toast'); if(!t){ t=document.createElement('div'); t.id='toast'; document.body.append(t); } t.textContent=msg; t.classList.add('on'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('on'),2400); }
  // ---- Session panel ----
  const sBody=$('#s-body'), sEmpty=$('#s-empty'), sHist=$('#s-history'), sTabs=$('#s-tabs'), sTurns=$('#s-turns'), sPlan=$('#s-plan');
  function showSTab(name){ $$('#s-tabs [data-stab]').forEach(b=> b.setAttribute('aria-selected', b.dataset.stab===name?'true':'false')); $$('.sessview').forEach(v=> v.hidden=v.dataset.stab!==name); }
  $$('#s-tabs [data-stab]').forEach(b=> b.addEventListener('click', ()=> showSTab(b.dataset.stab)));
  function newSession(){ sBody.dataset.open='1'; sEmpty.hidden=true; sHist.hidden=true; sTabs.hidden=false; $$('.dvsess').forEach(d=>d.classList.remove('on')); $('#s-title').textContent='New session'; const st=$('#s-status'); st.className='pill wt'; st.innerHTML='<span class="d"></span>idle'; sPlan.hidden=true; sTurns.innerHTML='<div class="fnote">Describe the change. Zeno plans it, works in an isolated worktree, and sends every effect to Command for your approval.</div>'; showSTab('chat'); $('#s-ta').focus(); }
  { const ss=$('#s-start'); if(ss) ss.addEventListener('click', newSession); }
  $('#s-close').addEventListener('click', ()=> syncLayout('sess', false));
  $('#s-tip').addEventListener('click', ()=>{ $('#s-tip').hidden=true; });

  /* ---- Devin-style first-run quick actions ---------------------------------
     Each goes somewhere real: a task, the file palette, the customization view,
     or the changes this session would make. */
  $$('.dv-act').forEach((b)=> b.addEventListener('click', ()=>{
    const k=b.dataset.dvq;
    if(k==='new'){ const t=$('#ag-ta'); if(t) t.focus(); }
    else if(k==='open'){ openQuick(''); }
    else if(k==='cust'){ const z=$('.vsact [data-vsview="zeno"]'); if(z) z.click(); }
    else if(k==='diffs'){ const g=$('.vsact [data-vsview="scm"]'); if(g) g.click(); }
  }));

  /* ---- composers grow with their text --------------------------------------
     field-sizing:content covers new Chrome; this is the fallback everywhere
     else, capped so a long paste scrolls instead of swallowing the pane. */
  function autosize(t){ if(!t) return;
    // Once the owner drags the resize handle, their height wins — stop managing it.
    if(t.dataset.userSized) return;
    const cap=Math.round(innerHeight*0.4);
    // An EMPTY textarea has a one-line scrollHeight, so measuring it collapses the
    // box below a placeholder that wraps — which is what was clipping "…/ for
    // actions". With no value, drop the inline height and let CSS min-height show
    // the placeholder in full.
    if(!t.value){ t.style.height=''; t.style.overflowY='hidden'; return; }
    t.style.height='auto';
    const want=t.scrollHeight;
    t.style.height=Math.min(want, cap)+'px';
    // Only show a scrollbar once the text genuinely exceeds the cap; otherwise a
    // short box renders native up/down arrows and hides the wrapped line.
    t.style.overflowY = want > cap ? 'auto' : 'hidden'; }
  document.addEventListener('input', (e)=>{ const t=e.target; if(t && t.tagName==='TEXTAREA') autosize(t); }, true);
  document.querySelectorAll('textarea').forEach(autosize);
  // A drag on the native resize handle changes offsetHeight without an input
  // event; observe it so the autosizer yields to the owner's chosen height.
  if (window.ResizeObserver) {
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        const t = en.target;
        if (document.activeElement === t && !t.dataset.autoH) t.dataset.userSized = '1';
      }
    });
    document.querySelectorAll('.composer textarea, .ag-composer textarea').forEach((t) => ro.observe(t));
  }

  syncLayout('sess', true); // boot Forge with the editor + the agent panel's first-run state (#s-empty)
  // extensions install (governed: shows as a held effect)

  // ---------- MODEL PICKER (shared) ----------
  // vram: GB VRAM footprint estimate (weights + KV + overhead), local models only; cloud = 0. Real installed models on this machine (Ollama, Q4_K_M).
  const MODELS=[
    {id:'route', g:'', name:'Route by policy', sub:'Local first · escalates to a cloud model only after you approve the egress', where:'route', icon:'route', vram:0},
    {id:'qwen3:8b', g:'Recommended · on this machine', name:'qwen3:8b', sub:'Ollama · RTX 3080 · Q4_K_M · 40K context', where:'local', ctx:'40K', cost:[0,0,0], str:[62,58,88], eff:1, vram:6},
    {id:'qwen3:4b', g:'Also installed · on this machine', name:'qwen3:4b', sub:'Ollama · Q4_K_M · 256K context · fastest', where:'local', ctx:'256K', cost:[0,0,0], str:[48,46,96], eff:1, vram:3},
    {id:'qwen3:14b', g:'', name:'qwen3:14b', sub:'Ollama · Q4_K_M · 40K context · slower, stronger', where:'local', ctx:'40K', cost:[0,0,0], str:[74,66,54], eff:1, vram:10.5},
    {id:'claude-opus-5', g:'Cloud · leaves this machine', name:'Claude Opus 5', sub:'Anthropic · 1M context', where:'cloud', ctx:'1M', cost:[5,0.5,25], str:[96,97,58], eff:2, key:true, vram:0},
    {id:'claude-sonnet-5', g:'', name:'Claude Sonnet 5', sub:'Anthropic · 1M context', where:'cloud', ctx:'1M', cost:[3,0.3,15], str:[90,88,80], eff:1, key:true, vram:0},
    {id:'gpt-5-codex', g:'', name:'GPT-5 Codex', sub:'OpenAI · 400K context', where:'cloud', ctx:'400K', cost:[1.25,0.125,10], str:[92,86,72], eff:1, key:false, locked:'needs an API key', vram:0} ];
  const MI={ local:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="10" rx="2"/><path d="M2 20h20M8 17h8"/></svg>', cloud:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4 4 0 0 1 0 9H7z"/></svg>', route:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h5a4 4 0 0 0 4-4v-2a4 4 0 0 1 4-4h-5"/></svg>' };
  let mpEl=null, mpdEl=null, mpAnchor=null, MODEL='qwen3:8b', MPMODE='single', RECALL=true, EFFORT={}, CMP=new Set(), ROUTE_FALLBACK='claude-sonnet-5';
  // GPU capability — in the real app this is fetched from GET /forge/models/capability (nvidia-smi + Ollama /api/ps); here it is this machine's real card.
  const GPU={ name:'RTX 3080', total:12, usable:11 };   // 12 GB card; ~1 GB reserved for the display + KV headroom
  let RUNMODE='parallel', RUNMODE_USER=false;             // 'parallel' | 'sequential' — chosen honestly from whether the models fit; RUNMODE_USER = owner overrode it
  const cmpLocals=ids=>[...ids].map(id=>MODELS.find(m=>m.id===id)).filter(m=>m&&m.where==='local');
  const localVram=ids=>cmpLocals(ids).reduce((s,m)=>s+(m.vram||0),0);
  const fitState=sum=> sum<=GPU.usable*0.85 ? 'ok' : sum<=GPU.usable ? 'tight' : 'over';
  function modelLabel(m){ return m.where==='local' ? m.name+' · local' : m.where==='cloud' ? m.name+' · cloud' : 'Route by policy'; }
  function applyModel(id){ MODEL=id; const m=MODELS.find(x=>x.id===id); const lab=modelLabel(m); const dotc = m.where==='cloud' ? 'am' : 'cy';
    $$('[data-model-pill]').forEach(p=>{ p.className=(p.classList.contains('chip')?'chip':'pill '+dotc); p.innerHTML='<span class="'+(p.classList.contains('chip')?'dot':'d')+'"'+(m.where==='cloud'?' style="background:var(--amber);box-shadow:0 0 7px 1px var(--amber)"':'')+'></span>'+esc(lab)+(p.dataset.modelPill==='caret'?' ▾':''); }); }
  function closeModelPicker(){ if(mpEl){ mpEl.remove(); mpEl=null; } if(mpdEl){ mpdEl.remove(); mpdEl=null; } mpAnchor=null; }
  function openModelPicker(anchor){ if(mpEl && mpAnchor===anchor){ closeModelPicker(); return; } closeModelPicker(); mpAnchor=anchor; mpEl=document.createElement('div'); mpEl.className='mp'; mpEl.setAttribute('role','dialog'); mpEl.setAttribute('aria-label','Choose a model');
    mpEl.innerHTML='<div class="mp-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input placeholder="Search all models" id="mp-q"><span style="font-family:var(--font-mono);font-size:9.5px">'+MODELS.filter(m=>m.where!=='route').length+' models</span></div><div class="mp-mode" role="group"><button data-mpm="single" title="One model does the run">Single</button><button data-mpm="compare" title="Run the same task on two models in two worktrees, keep the diff you prefer">Compare</button><button data-mpm="route" title="Local first; a cloud model only after you approve the egress">Route</button></div><div class="mp-list" id="mp-list"></div><div class="mp-foot" id="mp-foot"><span>Recall Vault memory<span class="sub">Ground this run in your notes · nothing leaves the machine</span></span><div class="toggle" id="mp-recall" role="switch" aria-checked="'+RECALL+'" tabindex="0"><span class="k"></span></div></div>';
    document.body.append(mpEl); renderMp(''); mpEl.querySelector('#mp-q').addEventListener('input', e=> renderMp(e.target.value)); mpEl.querySelectorAll('[data-mpm]').forEach(b=>{ b.setAttribute('aria-pressed', b.dataset.mpm===MPMODE?'true':'false'); b.addEventListener('click', ()=>{ MPMODE=b.dataset.mpm; mpEl.querySelectorAll('[data-mpm]').forEach(x=>x.setAttribute('aria-pressed', x===b?'true':'false')); if(MPMODE==='route') applyModel('route'); renderMp(mpEl.querySelector('#mp-q').value); syncFoot(); }); });
    syncFoot();
    const r=anchor.getBoundingClientRect(); const w=360, h=Math.min(520, mpEl.offsetHeight||460); let left=Math.min(Math.max(8, r.left), innerWidth-w-8); let top = r.top>h+12 ? r.top-h-8 : r.bottom+8; mpEl.style.left=left+'px'; mpEl.style.top=Math.max(8,top)+'px'; setTimeout(()=> mpEl.querySelector('#mp-q').focus(),0); }
  function renderMp(q){ const list=mpEl.querySelector('#mp-list'); list.innerHTML=''; if(MPMODE==='route'){ renderRoutePanel(list); return; } let lastG=null; const ql=q.trim().toLowerCase();
    MODELS.forEach(m=>{ if(MPMODE!=='route' && m.where==='route') return; if(ql && !(m.name+' '+m.sub).toLowerCase().includes(ql)) return; if(m.g && m.g!==lastG){ const g=document.createElement('div'); g.className='mp-g'; g.textContent=m.g; list.append(g); lastG=m.g; }
      const b=document.createElement('button'); b.className='mp-row'; b.dataset.mid=m.id; b.dataset.where=m.where; b.setAttribute('role', MPMODE==='compare'?'menuitemcheckbox':'menuitemradio'); b.setAttribute('aria-checked', (MPMODE==='compare'?CMP.has(m.id):MODEL===m.id)?'true':'false'); if(m.locked) b.dataset.locked='1';
      b.innerHTML='<span class="mi">'+MI[m.where]+'</span><span class="mn">'+esc(m.name)+'<span>'+esc(m.sub)+'</span></span><span class="mt '+(m.where==='local'?'loc':m.where==='cloud'?'eg':'')+'">'+(m.locked?esc(m.locked):m.where==='local'?'free · on-device':m.where==='cloud'?'T3 egress':'policy')+'</span>';
      b.addEventListener('mouseenter', ()=> showMpd(m, b)); b.addEventListener('focus', ()=> showMpd(m, b));
      b.addEventListener('click', ()=>{ if(MPMODE==='compare'){ if(m.locked){ toast('Add an API key to include '+m.name+' in a comparison'); return; } if(CMP.has(m.id)) CMP.delete(m.id); else { if(CMP.size>=3){ toast('Compare up to three models at once'); return; } CMP.add(m.id); } b.setAttribute('aria-checked', CMP.has(m.id)?'true':'false'); syncFoot(); return; } if(m.locked){ closeModelPicker(); smodal.hidden=false; toast('Add an API key under Settings → Runtime & models to unlock '+m.name); return; } applyModel(m.id); list.querySelectorAll('.mp-row').forEach(x=>x.setAttribute('aria-checked', x===b?'true':'false')); if(m.where==='cloud') toast(m.name+' selected — each call is a T3 egress effect and will ask you first'); });
      list.append(b); }); }
  function renderRoutePanel(list){
    const local=MODELS.find(m=>m.id==='qwen3:8b')||MODELS.find(m=>m.where==='local');
    const clouds=MODELS.filter(m=>m.where==='cloud');
    const fb=MODELS.find(m=>m.id===ROUTE_FALLBACK)||clouds[0];
    const wrap=document.createElement('div'); wrap.className='rt';
    wrap.innerHTML='<div class="rt-lead"><b>Local-first.</b> Zeno runs your task on-device and only reaches a cloud model <b>after you approve the egress</b> — nothing leaves this machine unless you say so.</div>'
      +'<div class="rt-ladder">'
      +'<div class="rt-step local"><span class="n">1</span><div><div class="rt-t">'+MI.local+esc(local.name)+'<span class="tag loc">free · on-device</span></div><div class="rt-s">Tries here first. Private, no bill, no egress tier — most tasks finish here.</div></div></div>'
      +'<div class="rt-step cloud"><span class="n">2</span><div><div class="rt-t">'+MI.cloud+'Escalate only if the local model can’t</div><div class="rt-s">Zeno proposes a cloud model and asks you before anything is sent. You choose which one:</div><select class="rt-sel" id="rt-fb" aria-label="Cloud model to escalate to">'+clouds.map(c=>'<option value="'+c.id+'"'+(c.id===fb.id?' selected':'')+(c.locked?' disabled':'')+'>Escalate to '+esc(c.name)+(c.locked?' · needs an API key':'')+'</option>').join('')+'</select></div></div>'
      +'</div>'
      +'<div class="rt-egress">'+MI.cloud+'<span>A cloud call is a <b>T3 egress</b> effect: previewed, approved once, sealed in a receipt. Route never sends silently.</span></div>';
    list.append(wrap);
    const sel=wrap.querySelector('#rt-fb'); if(sel) sel.addEventListener('change', ()=>{ ROUTE_FALLBACK=sel.value; const m=MODELS.find(x=>x.id===sel.value); toast('Route will escalate to '+(m?m.name:sel.value)+' — only after you approve the egress'); });
  }
  function showMpd(m, row){ if(mpdEl){ mpdEl.remove(); mpdEl=null; } if(m.where==='route'){ return; } mpdEl=document.createElement('div'); mpdEl.className='mpd'; const e=EFFORT[m.id]??m.eff; const pos=[14,50,86][e]; const isLocal=m.where==='local';
    mpdEl.innerHTML='<div class="mpd-h"><b>'+esc(m.name)+'</b><span class="pin" title="Pin as default">📌</span></div><div class="mpd-m"><span>'+m.ctx+' context</span><span>'+(isLocal?'runs on this GPU':'via '+m.sub.split(' · ')[0])+'</span></div>'
      +'<div class="mpd-k">Cost <span>Higher effort consumes more tokens</span></div><div class="mpd-bar"><i style="left:'+pos+'%"></i></div><div class="mpd-eff">'+['Low','Medium','High'].map((l,i)=>'<button data-eff="'+i+'" aria-pressed="'+(i===e)+'">'+l+'</button>').join('')+'</div>'
      +'<div class="mpd-cost"><div>Input<b>'+(isLocal?'0':'$'+m.cost[0])+' <em>/ 1M</em></b></div><div>Cached input<b>'+(isLocal?'0':'$'+m.cost[1])+' <em>/ 1M</em></b></div><div>Output<b>'+(isLocal?'0':'$'+m.cost[2])+' <em>/ 1M</em></b></div></div>'
      +'<div class="mpd-str">'+[['Code',m.str[0]],['Reasoning',m.str[1]],['Speed',m.str[2]]].map(s=>'<div>'+s[0]+'<i style="--w:'+s[1]+'%"></i><span>'+s[1]+'</span></div>').join('')+'</div>'
      +'<div class="mpd-priv '+(isLocal?'loc':'eg')+'">'+(isLocal?MI.local+'<span>Never leaves this machine. No egress tier, no key, no bill — receipts still sign the model hash.</span>':MI.cloud+'<span>Leaves this machine. Every call is a <b>T3 egress</b> effect: previewed, approved once, sealed in a receipt.</span>')+'</div>';
    document.body.append(mpdEl); const r=row.getBoundingClientRect(), mr=mpEl.getBoundingClientRect(); const w=330; const left = mr.left>w+16 ? mr.left-w-8 : mr.right+8; mpdEl.style.left=left+'px'; mpdEl.style.top=Math.min(Math.max(8, r.top-40), innerHeight-mpdEl.offsetHeight-8)+'px';
    mpdEl.querySelectorAll('[data-eff]').forEach(b=> b.addEventListener('click', ()=>{ EFFORT[m.id]=+b.dataset.eff; showMpd(m,row); $$('[data-effort-pill]').forEach(p=> p.textContent='effort: '+['low','medium','high'][+b.dataset.eff]+' ▾'); })); mpdEl.addEventListener('mouseleave', ()=>{ if(mpdEl){ mpdEl.remove(); mpdEl=null; } }); }
  document.addEventListener('click', e=>{ const a=e.target.closest('[data-model-pill],[data-effort-pill]'); if(a){ e.preventDefault(); openModelPicker(a); return; } if(mpEl && !e.target.closest('.mp,.mpd')) closeModelPicker(); });
  applyModel(MODEL);
  // ---- Compare mode: pick 2–3 models, run one task in parallel worktrees, keep the diff you prefer ----
  function syncFoot(){ const foot=mpEl&&mpEl.querySelector('#mp-foot'); if(!foot) return;
    if(MPMODE==='compare'){ const n=CMP.size;
      const locals=cmpLocals(CMP), sum=localVram(CMP), st=fitState(sum), locN=locals.length, cloudN=n-locN;
      if(st==='over') RUNMODE='sequential';                 // parallel isn't achievable — never offer a lie
      else if(!RUNMODE_USER) RUNMODE='parallel';            // fits again → default back to parallel unless the owner chose sequential
      const canPar = st!=='over';
      const note = locN===0 ? (cloudN?'Cloud models only — no local VRAM used, always parallel':'Pick models to compare')
                 : st==='ok' ? (locN>1?'Fits comfortably — local models run together':'Fits comfortably on this GPU')
                 : st==='tight' ? 'Fits — little headroom'+(locN>1?', runs together':'')
                 : 'Won’t fit at once — locals run one at a time';
      const pct=Math.min(100, GPU.total? sum/GPU.total*100 : 0), capPct=GPU.total? GPU.usable/GPU.total*100 : 100;
      const segs=locals.map(m=>'<i class="seg" style="width:'+(sum?m.vram/sum*100:0)+'%" title="'+esc(m.name)+' · '+m.vram+' GB"></i>').join('');
      const num=sum? (Number.isInteger(sum)?sum:sum.toFixed(1)) : 0;
      foot.style.display='block';
      foot.innerHTML=
        '<div class="mp-vram fit-'+st+'">'
          +'<div class="mp-vram-head"><span class="mp-vram-gpu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="12" rx="2"/><path d="M8 20h8M9 16v4M15 16v4M8 8h4M8 11h6"/></svg>'+esc(GPU.name)+' · '+GPU.total+' GB VRAM</span><span class="mp-vram-num">'+num+' / '+GPU.total+' GB</span></div>'
          +'<div class="mp-vram-bar" role="img" aria-label="VRAM used '+num+' of '+GPU.total+' gigabytes; '+note+'"><div class="mp-vram-fill" style="width:'+pct+'%">'+segs+'</div><span class="mp-vram-cap" style="left:'+capPct+'%" title="Usable budget ('+GPU.usable+' GB) — the rest is reserved for the display"></span></div>'
          +'<div class="mp-vram-note"><span class="mp-vram-dot"></span>'+note+(cloudN&&locN?' · +'+cloudN+' cloud off-GPU':'')+'</div>'
        +'</div>'
        +'<div class="mp-runmode" role="group" aria-label="How to run the comparison">'
          +'<button type="button" data-run="parallel" aria-pressed="'+(RUNMODE==='parallel')+'"'+(canPar?'':' disabled title="These models exceed VRAM — they can’t be held at once"')+'><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13M4 16h13M14 4l4 4-4 4M14 12l4 4-4 4"/></svg>Parallel</button>'
          +'<button type="button" data-run="sequential" aria-pressed="'+(RUNMODE==='sequential')+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h11l-3-3M4 7l3 3M20 17H9l3-3M20 17l-3 3"/></svg>Sequential</button>'
        +'</div>'
        +'<div class="mp-foot-row"><span>Compare<span class="sub">'+(n?('One task · '+n+' model'+(n>1?'s':'')+' · isolated worktrees'):'Select 2 or 3 models to run side by side')+'</span></span><button class="btn p sm" id="mp-run"'+(n<2?' disabled':'')+'>Compare'+(n?' '+n:'')+' →</button></div>';
      foot.querySelectorAll('[data-run]').forEach(b=> b.addEventListener('click', (e)=>{ if(b.disabled) return; e.stopPropagation(); RUNMODE=b.dataset.run; RUNMODE_USER=true; syncFoot(); }));
      // #mp-run's own click is claimed by bind/compare.js (a capturing,
      // stopImmediatePropagation listener on document) before it ever reaches
      // a handler attached here — see bind/compare.js's bind() for why.
    } else {
      foot.style.display='';
      foot.innerHTML='<span>Recall Vault memory<span class="sub">Ground this run in your notes · nothing leaves the machine</span></span><div class="toggle" id="mp-recall" role="switch" aria-checked="'+RECALL+'" tabindex="0"><span class="k"></span></div>';
      const rt=foot.querySelector('#mp-recall'); const flip=()=>{ RECALL=!RECALL; rt.setAttribute('aria-checked', RECALL); }; rt.addEventListener('click', flip); rt.addEventListener('keydown', e=>{ if(e.key===' '||e.key==='Enter'){ e.preventDefault(); flip(); } }); }
  }
  $('#vs-lastexit').textContent='exit 0';
  document.addEventListener('click', e=>{ const r=e.target.closest('[data-run-cmd]'); if(r){ showProduct('forge'); showPanel('terminal'); runTerm(r.dataset.runCmd); } });
  $$('[data-sched]').forEach(s=> s.addEventListener('click', ()=> toast('Scheduled tasks run under a T1 ceiling; edit them in Settings → Automation')));


  // ---------- MOBILE: bottom tabs, More sheet, pairing, Forge watch-mode ----------
  $$('.mtabs [data-screen]').forEach(b=> b.addEventListener('click', ()=> show(b.dataset.screen)));
  const _show=show; show=function(name){ _show(name); $$('.mtabs [data-screen]').forEach(b=>{ b.dataset.screen===name ? b.setAttribute('aria-current','page') : b.removeAttribute('aria-current'); }); };
  navs.forEach(n=> n.addEventListener('click', ()=>{ if(n.dataset.screen) $$('.mtabs [data-screen]').forEach(b=>{ b.dataset.screen===n.dataset.screen ? b.setAttribute('aria-current','page') : b.removeAttribute('aria-current'); }); }));
  const msheet=$('#msheet'); $$('[data-msheet]').forEach(b=> b.addEventListener('click', ()=> msheet.hidden=false)); msheet.querySelectorAll('[data-close]').forEach(b=> b.addEventListener('click', ()=> msheet.hidden=true));
  $$('[data-mscreen]').forEach(b=> b.addEventListener('click', ()=>{ msheet.hidden=true; show(b.dataset.mscreen); }));
  const pair=$('#pair-sheet');
  pair.querySelectorAll('[data-close]').forEach(b=> b.addEventListener('click', ()=> pair.hidden=true));
  $('#mf-editor').addEventListener('click', ()=>{ const on=ide.classList.toggle('m-editor'); $('#mf-editor').textContent=on?'Back to the run':'View code (read-only)'; });

  // ---------- COUNSEL — navigation chrome (bind/counsel.js owns the recorder) ----------
  function cnGo(v){ $$('.cnview').forEach(x=> x.classList.toggle('on', x.dataset.cnview===v)); $('.cnmain').scrollTop=0; }
  document.addEventListener('click', e=>{ const g=e.target.closest('[data-cngo]'); if(g) cnGo(g.dataset.cngo); });
  $$('[data-cntab]').forEach(b=> b.addEventListener('click', ()=>{ $$('.cntabs button').forEach(x=> x.setAttribute('aria-selected', x.dataset.cntab===b.dataset.cntab?'true':'false')); $$('.cnp').forEach(p=> p.classList.toggle('on', p.dataset.cntab===b.dataset.cntab)); }));
  $('#cn-send').addEventListener('click', e=>{ const st=$('#cn-mailstate'); st.className='pill am'; st.innerHTML='<span class="d"></span>not configured — add a mail provider in Settings; nothing left this machine'; e.target.disabled=true; });

  // ================= Standing Field — Gate-2 renderer =================
  const cvs=$('#orb'), ctx=cvs.getContext('2d');
  const GOLD='#D8BE7E', CY='#38C3D6', I3='#6C7480', AM='#E0A128', GR='#5BB98C', RD='#D8695A', INK2='#9AA1AC', INK='#ECEBE6', G1='#0A0C0E';
  const N=[
    {id:'zeno',   l:'Zeno',          k:'core',  hx:0,    hy:0,    hz:0},
    {id:'command',l:'Command',       k:'agent', hx:.58,  hy:-.22, hz:.30},
    {id:'forge',  l:'Forge',         k:'agent', att:'active', hx:-.48, hy:.28, hz:.44},
    {id:'counsel',l:'Counsel',       k:'agent', hx:-.62, hy:-.26, hz:-.18},
    {id:'claude', l:'Claude Code',   k:'agent', hx:-.26, hy:.60,  hz:.26},
    {id:'codex',  l:'Codex',         k:'agent', hx:-.68, hy:.42,  hz:-.28},
    {id:'models', l:'Local models',  k:'agent', hx:.36,  hy:.52,  hz:-.38},
    {id:'pc',     l:'This PC',       k:'dev',   hx:.26,  hy:-.62, hz:-.28},
    {id:'phone',  l:'Phone',         k:'dev',   hx:.54,  hy:-.44, hz:.32},
    {id:'sandbox',l:'sandbox',       k:'repo',  hx:-.32, hy:.16,  hz:.60},
    {id:'daemon', l:'daemon',        k:'repo',  hx:-.08, hy:.42,  hz:-.56},
    {id:'ingest', l:'INGEST-12',     k:'ticket',att:'needs', ageMin:14, hx:.22, hy:.68, hz:.28},
    {id:'docs',   l:'DOCS-4',        k:'ticket',att:'waiting', hx:.62, hy:.22, hz:.30},
    {id:'patch',  l:'patch.task',    k:'ticket',att:'verified', hx:-.42,hy:-.50,hz:.38},
    {id:'vault',  l:'Vault',         k:'repo',  hx:.18,  hy:-.30, hz:-.62},
    {id:'github', l:'github',        k:'src',   hx:.70,  hy:.06,  hz:-.40},
    {id:'meetings',l:'Meetings',     k:'repo',  hx:-.74, hy:-.02, hz:.22}
  ];
  N.forEach((n,i)=> n.ph=i*2.399963);
  const E=[['zeno','command'],['zeno','forge'],['zeno','counsel'],['zeno','pc'],['zeno','phone'],['zeno','vault'],['zeno','models'],
    ['forge','claude'],['forge','codex'],['forge','models'],['forge','sandbox'],['forge','daemon'],
    ['command','ingest'],['ingest','sandbox'],['ingest','forge'],['docs','daemon'],['docs','forge'],
    ['patch','forge'],['patch','sandbox'],['counsel','vault'],['counsel','meetings'],['command','pc'],['forge','github','eg']];
  const ACT=['zeno','forge','models','claude'];
  const F={rot:.62, tilt:.34, tilt0:.34, W:0, H:0, pad:0, hov:null};
  const ORB={motion:true, draw:null, kick:null};
  let DPR=Math.min(window.devicePixelRatio||1,2);
  function size(){ const w=cvs.clientWidth||780, h=cvs.clientHeight||460; cvs.width=w*DPR; cvs.height=h*DPR; F.W=cvs.width; F.H=cvs.height; F.pad=Math.min(F.W*.32,F.H*.62); }
  function rgba(hex,a){ const n=parseInt(hex.slice(1),16); return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')'; }
  function colOf(n){ return n.k==='core'?GOLD : (n.k==='agent'||n.k==='src')?CY : I3; }
  function attCol(a){ return a==='needs'?AM : (a==='blocked'||a==='error')?RD : a==='active'?CY : a==='verified'?GR : a==='waiting'?I3 : null; }
  function attPri(a){ return a==='error'?5:a==='needs'?4:a==='blocked'?3:a==='active'?2:a==='verified'?1:0; }
  function attPulse(a,t){ if(!ORB.motion) return 1; if(a==='needs') return 1+.26*Math.sin(t*3.4); if(a==='error') return 1+.34*Math.max(0,Math.sin(t*6.2)); if(a==='blocked') return 1+.15*Math.sin(t*1.3); if(a==='active') return 1+.11*Math.sin(t*2.2); return 1; }
  function urgOf(n){ return Math.min(1,(n.ageMin||0)/720); }
  function neighborsOf(id){ const s={}; E.forEach(e=>{ if(e[0]===id)s[e[1]]=1; if(e[1]===id)s[e[0]]=1; }); return s; }
  function g(id){ return N.find(n=>n.id===id); }
  function projPt(px,py,pz){ const cr=Math.cos(F.rot),sr=Math.sin(F.rot),ct=Math.cos(F.tilt),st=Math.sin(F.tilt);
    const x=px*cr-pz*sr, z=px*sr+pz*cr, y=py*ct-z*st, zz=py*st+z*ct, p=1/(1.85-zz*.46); return {x:x*p,y:y*p,d:zz}; }
  function lay(t){ const cx=F.W*.5, cy=F.H*.46, br=ORB.motion?t:0;
    N.forEach(n=>{ n.x=n.hx+(br?.045*Math.sin(br*.29+n.ph):0); n.y=n.hy+(br?.038*Math.sin(br*.22+n.ph*1.7):0); n.z=n.hz+(br?.045*Math.cos(br*.26+n.ph*2.3):0);
      const q=projPt(n.x,n.y,n.z); n._=q; n.sx=cx+q.x*F.pad; n.sy=cy+q.y*F.pad; }); }
  function dep(n){ return Math.max(0,Math.min(1,(n._.d+1.05)/2.1)); }
  function sphere(n,r,col,lit){ const grd=ctx.createRadialGradient(n.sx-r*.42,n.sy-r*.5,r*.12,n.sx,n.sy,r*1.06);
    grd.addColorStop(0,lit?'rgba(255,255,255,.95)':'rgba(255,255,255,.48)'); grd.addColorStop(.30,rgba(col,1)); grd.addColorStop(.80,rgba(col,.78)); grd.addColorStop(1,'rgba(0,0,0,.62)');
    ctx.beginPath(); ctx.arc(n.sx,n.sy,r,0,7); ctx.fillStyle=grd; ctx.fill(); }
  function draw(){ const c=ctx, t=performance.now()/1000, D=DPR; lay(t); c.clearRect(0,0,F.W,F.H);
    const focus=F.hov?F.hov.id:null, neigh=focus?neighborsOf(focus):null;
    let beaconId=null,best=-1; N.forEach(n=>{ const pr=attPri(n.att); if(pr>=3){ const sc=pr*1e5+(n.ageMin||0); if(sc>best){best=sc;beaconId=n.id;} } });
    const gy=F.H*.46+F.pad*.92, rG=F.pad*.95;
    const gg=c.createRadialGradient(F.W*.5,gy,2,F.W*.5,gy,rG); gg.addColorStop(0,'rgba(0,0,0,.5)'); gg.addColorStop(1,'rgba(0,0,0,0)');
    c.save(); c.translate(F.W*.5,gy); c.scale(1,.17); c.translate(-F.W*.5,-gy); c.beginPath(); c.arc(F.W*.5,gy,rG,0,7); c.fillStyle=gg; c.fill(); c.restore();
    E.slice().sort((p,q)=>(g(p[0])._.d+g(p[1])._.d)-(g(q[0])._.d+g(q[1])._.d)).forEach(e=>{
      const a=g(e[0]),b=g(e[1]),dm=(dep(a)+dep(b))/2, live=ACT.indexOf(a.id)>=0&&ACT.indexOf(b.id)>=0, conn=!focus||a.id===focus||b.id===focus, eg=e[2]==='eg';
      if(eg){ c.strokeStyle=AM; c.globalAlpha=(conn?.6:.18)+.12*dm; c.lineWidth=(1.1+1.0*dm)*(conn?1:.7)*D; c.setLineDash([5*D,4*D]); }
      else { const lg=c.createLinearGradient(a.sx,a.sy,b.sx,b.sy); lg.addColorStop(0,colOf(a)); lg.addColorStop(1,colOf(b)); c.strokeStyle=lg;
        c.globalAlpha=((live?.52:.20)+.30*dm)*(conn?1:.16); c.lineWidth=((live?1.5:.85)+1.15*dm)*(conn?1:.7)*D; c.setLineDash([]); }
      c.beginPath(); c.moveTo(a.sx,a.sy); c.lineTo(b.sx,b.sy); c.stroke();
      if(eg){ const mx=(a.sx+b.sx)/2,my=(a.sy+b.sy)/2; c.setLineDash([]); c.globalAlpha=conn?.9:.4;
        c.beginPath(); c.arc(mx,my,5.5*D,0,7); c.fillStyle=G1; c.fill(); c.fillStyle=AM; c.font='700 '+(8*D)+'px "IBM Plex Mono",monospace'; c.textAlign='center'; c.fillText('⚡',mx,my+2.7*D); c.textAlign='left'; }
    });
    c.setLineDash([]); c.globalAlpha=1;
    const placed=[];
    N.slice().sort((a,b)=>a._.d-b._.d).forEach(n=>{
      const d=dep(n), a=n.att, on=ACT.indexOf(n.id)>=0&&ORB.motion, sel=(n===F.hov);
      let r=(n.k==='core'?11:6.4)*D*(.46+1.08*d); const szf=(a==='needs'||a==='error')?1.16:a==='blocked'?1.08:1; r*=szf*attPulse(a,t);
      const col=colOf(n), acol=a?attCol(a):null, lit=!focus||n.id===focus||(neigh&&neigh[n.id]), dimf=lit?1:(a?.5:.24);
      if(!acol){ for(const m of N){ if(m!==n&&m.att&&neighborsOf(m.id)[n.id]){ const sc=attCol(m.att), sp=.10+(ORB.motion?.05*Math.sin(t*2.7+n.ph):0);
        const sg=c.createRadialGradient(n.sx,n.sy,1,n.sx,n.sy,r*3.4); sg.addColorStop(0,rgba(sc,sp)); sg.addColorStop(1,rgba(sc,0)); c.globalAlpha=1; c.beginPath(); c.arc(n.sx,n.sy,r*3.4,0,7); c.fillStyle=sg; c.fill(); break; } } }
      if(acol){ const ap=(a==='verified'||a==='waiting'?.24:.24+.20*(attPulse(a,t)-1)/.26)*(.72+.55*urgOf(n))*dimf, abr=r*6.8;
        const ag=c.createRadialGradient(n.sx,n.sy,r*.4,n.sx,n.sy,abr); ag.addColorStop(0,rgba(acol,ap)); ag.addColorStop(.5,rgba(acol,ap*.32)); ag.addColorStop(1,rgba(acol,0));
        c.globalAlpha=1; c.beginPath(); c.arc(n.sx,n.sy,abr,0,7); c.fillStyle=ag; c.fill(); }
      if(n.k==='core'||on||sel){ const br=r*(n.k==='core'?7:4.8), peak=(n.k==='core'?.36:.26)*(.45+.55*d);
        const bg=c.createRadialGradient(n.sx,n.sy,r*.35,n.sx,n.sy,br); bg.addColorStop(0,rgba(col,peak)); bg.addColorStop(.45,rgba(col,peak*.28)); bg.addColorStop(1,rgba(col,0));
        c.globalAlpha=1; c.beginPath(); c.arc(n.sx,n.sy,br,0,7); c.fillStyle=bg; c.fill(); }
      c.globalAlpha=Math.min(1,.46+.54*d)*dimf; c.shadowColor=acol||col; c.shadowBlur=(sel?16:acol?11:on?12:5)*(.4+.6*d)*D;
      sphere(n,r,col,sel||n.k==='core'); c.shadowBlur=0;
      if(acol){ c.globalAlpha=.92*dimf; c.beginPath(); c.arc(n.sx,n.sy,r+3.4*D,0,7); c.strokeStyle=acol; c.lineWidth=1.7*D; c.stroke(); }
      c.beginPath(); c.arc(n.sx,n.sy,r,0,7); c.strokeStyle=acol||col; c.globalAlpha=Math.min(1,.34+.66*d)*(sel?1:.8)*dimf; c.lineWidth=(n.k==='core'?1.7:1.1)*(.6+.7*d)*D; c.stroke();
      if(n.id===beaconId){ c.save(); c.strokeStyle=acol||AM;
        if(ORB.motion){ const pg=(t*.7)%1; c.globalAlpha=(1-pg)*.55; c.lineWidth=1.4*D; c.beginPath(); c.arc(n.sx,n.sy,r+5*D+pg*20*D,0,7); c.stroke(); }
        c.globalAlpha=.9; c.lineWidth=1.3*D; c.setLineDash([4.5*D,5.5*D]); c.lineDashOffset=ORB.motion?-t*13:0; c.beginPath(); c.arc(n.sx,n.sy,r+9*D,0,7); c.stroke(); c.restore(); c.setLineDash([]); }
      if(sel||n.k==='core'){ c.globalAlpha=Math.min(1,.5+.5*d); c.beginPath(); c.arc(n.sx-r*.30,n.sy-r*.34,r*.62,Math.PI*1.02,Math.PI*1.55); c.strokeStyle='rgba(255,255,255,.55)'; c.lineWidth=1.1*D; c.stroke(); c.globalAlpha=1; }
      if(sel||n.k==='core'||a||d>0.50){ const fs=(8.6+3.4*d)*D; c.font='500 '+fs.toFixed(1)+'px "IBM Plex Mono",monospace';
        const tw=c.measureText(n.l).width; let lx=n.sx+r+8*D, ly=n.sy+3.5*D; if(lx+tw>F.W-8*D) lx=n.sx-r-8*D-tw;
        const clash=y=> placed.some(b=> Math.abs(b.y-y)<13*D && lx<b.x+b.w+7*D && b.x<lx+tw+7*D);
        let cl=clash(ly); if(cl&&!clash(ly+15*D)){ly+=15*D;cl=false;} else if(cl&&!clash(ly-15*D)){ly-=15*D;cl=false;}
        if(!cl||sel||n.k==='core'){ if(cl)ly+=15*D; c.globalAlpha=Math.min(1,.52+.48*d); c.shadowColor='rgba(10,12,14,.95)'; c.shadowBlur=7*D; c.fillStyle=sel?INK:INK2;
          c.fillText(n.l,lx,ly); c.fillText(n.l,lx,ly); c.shadowBlur=0; placed.push({x:lx,y:ly,w:tw}); } }
      c.globalAlpha=1;
    });
  }
  ORB.draw=draw;
  let raf=0, last=0, drag=false, mx=0, my=0;
  function loop(t){ if(!ORB.motion||heroBlock.hidden){ raf=0; return; } const dt=last?Math.min(.05,(t-last)/1000):.016; last=t;
    if(!drag) F.rot+=dt*0.28; F.tilt=F.tilt0+Math.sin(t/6400)*.06; draw(); raf=requestAnimationFrame(loop); }
  ORB.kick=function(){ if(ORB.motion && !raf && !heroBlock.hidden){ last=0; raf=requestAnimationFrame(loop); } };
  const rm=$('#rm-toggle');
  if(rm){ const flip=()=>{ const willReduce=rm.getAttribute('aria-checked')!=='true'; rm.setAttribute('aria-checked', willReduce?'true':'false'); ORB.motion=!willReduce; if(ORB.motion) ORB.kick(); else draw(); };
    rm.addEventListener('click',flip); rm.addEventListener('keydown',e=>{ if(e.key===' '||e.key==='Enter'){ e.preventDefault(); flip(); } }); }
  function pick(e){ const rc=cvs.getBoundingClientRect(); const x=(e.clientX-rc.left)*(F.W/rc.width), y=(e.clientY-rc.top)*(F.H/rc.height); let hit=null,bd=Math.pow(24*DPR,2); N.forEach(n=>{ const dx=n.sx-x,dy=n.sy-y,dd=dx*dx+dy*dy; if(dd<bd){bd=dd;hit=n;} }); return hit; }
  cvs.addEventListener('pointerdown', e=>{ drag=true; mx=e.clientX; my=e.clientY; try{cvs.setPointerCapture(e.pointerId);}catch(_){} });
  cvs.addEventListener('pointermove', e=>{ if(drag){ F.rot+=(e.clientX-mx)*.008; F.tilt0=Math.max(-.6,Math.min(.95,F.tilt0-(e.clientY-my)*.006)); F.tilt=F.tilt0; mx=e.clientX; my=e.clientY; if(!ORB.motion) draw(); }
    else { const h=pick(e); if(h!==F.hov){ F.hov=h; cvs.style.cursor=h?'pointer':'grab'; if(!ORB.motion) draw(); } } });
  cvs.addEventListener('pointerup', ()=>{ drag=false; }); cvs.addEventListener('pointercancel', ()=>{ drag=false; });
  cvs.addEventListener('pointerleave', ()=>{ if(F.hov){ F.hov=null; cvs.style.cursor='grab'; if(!ORB.motion) draw(); } });
  // click a node → go where it lives
  cvs.addEventListener('click', ()=>{ const h=F.hov; if(!h) return; if(h.k==='ticket') show(h.att==='needs'?'approvals':'work'); else if(h.id==='vault') show('vault'); else if(h.k==='dev') show('devices'); else if(h.id==='github') show('integrations'); });
  function boot(){ size(); draw(); ORB.kick(); }
  boot(); requestAnimationFrame(boot); window.addEventListener('load', boot);
  window.addEventListener('resize', ()=>{ DPR=Math.min(window.devicePixelRatio||1,2); size(); draw(); });
  // returning to Home restarts the field
  navs.forEach(n=>{ if(n.dataset.screen==='home') n.addEventListener('click', ()=> setTimeout(()=>{ size(); ORB.kick(); },0)); });
})();
