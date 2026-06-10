"use strict";
/* ================================================================
   POCKET MONSTERS Y — 게임 엔진
   ================================================================ */
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;
const TILE = 16, VW = 320, VH = 288;
const SAVE_KEY = 'pmy-save-v2';

/* ================= 유틸 ================= */
// rAF 기반 + 백그라운드 탭에서 rAF가 멈춰도 진행되도록 setTimeout 폴백
const frame = () => new Promise(r=>{
  let done=false; const f=()=>{ if(!done){ done=true; r(); } };
  requestAnimationFrame(f); setTimeout(f,50);
});
const wait = ms => new Promise(r=>setTimeout(r,ms));
const lerp = (a,b,t)=>a+(b-a)*t;
const rnd = n => Math.floor(Math.random()*n);

// 한국어 조사 자동 선택 (받침 유무)
const DIGIT_JONG = {0:1,1:1,2:0,3:1,4:0,5:0,6:1,7:1,8:1,9:0};
function hasJong(w){
  const ch = String(w).slice(-1);
  if(/[0-9]/.test(ch)) return !!DIGIT_JONG[ch];
  const code = ch.charCodeAt(0);
  if(code<0xAC00 || code>0xD7A3) return false;
  return (code-0xAC00)%28 > 0;
}
function josa(w,pair){
  const j = hasJong(w);
  const tail = {'이가':j?'이':'가','을를':j?'을':'를','은는':j?'은':'는','과와':j?'과':'와',
    '으로':(j && (String(w).slice(-1).charCodeAt(0)-0xAC00)%28!==8)?'으로':'로'}[pair];
  return w+tail;
}

/* ================= 몬스터 생성/계산 ================= */
function statOf(base,lvl){ return Math.floor(base*lvl/50)+5; }
function maxHpOf(base,lvl){ return Math.floor(base*lvl/50)+lvl+10; }
function expToNext(lvl){ return Math.floor(0.8*lvl*lvl*lvl); }
function makeMon(name,lvl){
  const d = DEX[name];
  const moves = d.learn.filter(([l])=>l<=lvl).map(([,m])=>m).slice(-4);
  return {name,lvl,maxhp:maxHpOf(d.hp,lvl),hp:maxHpOf(d.hp,lvl),exp:expToNext(lvl),moves};
}
function typeMul(a,d){ return (CHART[a]||{})[d] ?? 1; }

/* ================= 게임 상태 ================= */
let mode = 'title';   // title|intro|world|battle|evolve|ending|dex
const game = {
  map:'town', px:13, py:6, dir:'down', moving:false, mx:0, my:0, prog:0,
  trail:[{x:13,y:7},{x:13,y:7}],
  party:[], box:[],
  items:{ball:0, potion:2, spotion:0},
  money:3000,
  flags:{starter:false, champion:false, trainers:{}},
  dex:{seen:[], caught:[]},
  lock:false,
};
const curMap = ()=>MAPS[game.map];
function dexSee(n){ if(!game.dex.seen.includes(n)) game.dex.seen.push(n); }
function dexCaught(n){ dexSee(n); if(!game.dex.caught.includes(n)) game.dex.caught.push(n); }

/* ================= 오디오 ================= */
let AC = null;
const audio = {on:true, want:null, timer:null, step:0};
const m2f = m => 440*Math.pow(2,(m-69)/12);
function ensureAudio(){
  if(!AC){ try{ AC = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){return;} playSong(audio.want); }
  else if(AC.state==='suspended') AC.resume();
}
function tone(f,t,dur,type,vol){
  if(!AC || !audio.on || f<=0) return;
  const o=AC.createOscillator(), g=AC.createGain();
  o.type=type; o.frequency.value=f;
  g.gain.setValueAtTime(vol,t);
  g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t+dur);
}
function playSong(name){
  audio.want = name;
  if(audio.timer){ clearInterval(audio.timer); audio.timer=null; }
  if(!name || !AC || !audio.on) return;
  const s = SONGS[name], spb = 60/s.bpm/2;
  audio.step = 0;
  audio.timer = setInterval(()=>{
    if(s.once && audio.step >= s.mel.length){ clearInterval(audio.timer); audio.timer=null; return; }
    const i = audio.step % s.mel.length, t = AC.currentTime + 0.02;
    if(s.mel[i]) tone(m2f(s.mel[i]), t, spb*0.9, 'square', 0.028);
    if(s.bass[i]) tone(m2f(s.bass[i]), t, spb*0.95, 'triangle', 0.05);
    audio.step++;
  }, spb*1000);
}
function toggleSound(){
  audio.on = !audio.on;
  if(!audio.on && audio.timer){ clearInterval(audio.timer); audio.timer=null; }
  else if(audio.on) playSong(audio.want);
}
function sfx(kind){
  if(!AC || !audio.on) return;
  const t = AC.currentTime;
  ({sel:   ()=>tone(880,t,.06,'square',.04),
    bump:  ()=>tone(110,t,.07,'square',.04),
    hit:   ()=>{tone(200,t,.12,'sawtooth',.08); tone(150,t+.05,.1,'sawtooth',.06);},
    faint: ()=>[400,300,220,150].forEach((f,i)=>tone(f,t+i*.09,.09,'square',.06)),
    ball:  ()=>{tone(523,t,.08,'square',.05); tone(392,t+.1,.08,'square',.05);},
    catch: ()=>{tone(660,t,.1,'square',.05); tone(880,t+.12,.22,'square',.05);},
    heal:  ()=>[523,659,784,1047].forEach((f,i)=>tone(f,t+i*.08,.12,'square',.05)),
    lvl:   ()=>[523,659,784,1047,1319].forEach((f,i)=>tone(f,t+i*.07,.1,'square',.05)),
    run:   ()=>{tone(900,t,.05,'square',.04); tone(700,t+.06,.05,'square',.04);},
    money: ()=>{tone(988,t,.07,'square',.05); tone(1319,t+.08,.14,'square',.05);},
  })[kind]?.();
}

/* ================= UI 프리미티브 ================= */
const dialog = {active:false, text:'', shown:0, res:null};
let chooser = {active:false};
function say(text){
  return new Promise(async res=>{
    dialog.active=true; dialog.text=text; dialog.shown=0; dialog.res=res;
    while(dialog.active && dialog.shown < dialog.text.length){
      // A를 누르고 있으면 글자가 빨리 나온다
      dialog.shown = Math.min(dialog.text.length, dialog.shown + (keys.A?3:1));
      await frame();
    }
  });
}
function choose(options, cfg={}){
  return new Promise(res=>{ chooser = {active:true, options, idx:cfg.idx||0, cfg, res}; });
}
let keyWaiters = [];
function waitAnyKey(){ return new Promise(r=>keyWaiters.push(r)); }

/* ================= 입력 ================= */
const keys = {};
function normKey(k){
  k = (k||'').toLowerCase();
  return {arrowup:'up',w:'up',arrowdown:'down',s:'down',arrowleft:'left',a:'left',
          arrowright:'right',d:'right',z:'A',enter:'A',' ':'A',x:'B',shift:'B',escape:'B',m:'M'}[k]||null;
}
function handleKey(k){
  if(k==='M'){ toggleSound(); return; }
  if(keyWaiters.length){ const ws=keyWaiters; keyWaiters=[]; ws.forEach(r=>r(k)); return; }
  if(chooser.active){
    const c = chooser, n = c.options.length, cols = c.cfg.cols||1;
    if(k==='up'){ c.idx=(c.idx-cols+n)%n; sfx('sel'); }
    if(k==='down'){ c.idx=(c.idx+cols)%n; sfx('sel'); }
    if(k==='left'){ c.idx=(c.idx-1+n)%n; sfx('sel'); }
    if(k==='right'){ c.idx=(c.idx+1)%n; sfx('sel'); }
    if(k==='A'){ sfx('sel'); chooser={active:false}; c.res(c.idx); }
    if(k==='B' && c.cfg.cancel!==false){ chooser={active:false}; c.res(-1); }
    return;
  }
  if(dialog.active){
    if(k==='A'||k==='B'){
      if(dialog.shown < dialog.text.length) dialog.shown = dialog.text.length;
      else { const r=dialog.res; dialog.active=false; dialog.res=null; sfx('sel'); r&&r(); }
    }
    return;
  }
  if(mode==='world' && !game.lock){
    if(k==='A') tryInteract();
    if(k==='B') fieldMenu();
  }
  if(mode==='title' && k==='A') titleMenu();
}
addEventListener('keydown', e=>{
  const k = normKey(e.key);
  if(!k) return;
  e.preventDefault();
  ensureAudio();
  // 새로 눌렀을 때만 처리 (홀드 리핏으로 대사가 마구 넘어가는 것 방지)
  if(!keys[k]){ keys[k]=true; handleKey(k); }
});
addEventListener('keyup', e=>{ const k=normKey(e.key); if(k) keys[k]=false; });

// 탭이 백그라운드로 가면 음악 정지, 돌아오면 재개
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden){ if(audio.timer){ clearInterval(audio.timer); audio.timer=null; } }
  else playSong(audio.want);
});

// 터치 컨트롤
document.querySelectorAll('[data-k]').forEach(btn=>{
  const k = btn.dataset.k;
  const dn = e=>{ e.preventDefault(); ensureAudio(); if(!keys[k]){ keys[k]=true; handleKey(k); } };
  const up = e=>{ e.preventDefault(); keys[k]=false; };
  btn.addEventListener('touchstart',dn,{passive:false});
  btn.addEventListener('touchend',up,{passive:false});
  btn.addEventListener('mousedown',dn);
  btn.addEventListener('mouseup',up);
  btn.addEventListener('mouseleave',up);
});

/* ================= 세이브 ================= */
function saveGame(){
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    ver:2, map:game.map, px:game.px, py:game.py, dir:game.dir,
    party:game.party, box:game.box, items:game.items, money:game.money,
    flags:game.flags, dex:game.dex,
  }));
}
function loadGame(){
  try{
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if(!s || s.ver!==2 || !s.party?.length) return false;
    Object.assign(game,{map:s.map,px:s.px,py:s.py,dir:s.dir||'down',
      party:s.party,box:s.box||[],items:s.items,money:s.money,flags:s.flags,dex:s.dex});
    game.flags.trainers = game.flags.trainers||{};
    game.trail = [{x:game.px,y:game.py},{x:game.px,y:game.py}];
    return true;
  }catch(e){ return false; }
}

/* ================= 월드 ================= */
const tileAt = (x,y)=>{
  const m = curMap();
  return (x<0||y<0||y>=m.rows.length||x>=m.rows[0].length) ? 'T' : m.rows[y][x];
};
const SOLID = new Set(['T','~','R','W','f','S','P','D']);
function occupied(x,y){
  return [...(curMap().npcs||[]), ...(curMap().trainers||[])].some(n=>n.x===x&&n.y===y);
}
function canWalk(x,y){
  if(SOLID.has(tileAt(x,y))) return false;
  if(occupied(x,y)) return false;
  return true;
}
const banner = {text:'', t:0};
const fade = {t:0};
function setMap(id,x,y,dir){
  game.map=id; game.px=x; game.py=y; game.dir=dir||game.dir;
  game.trail=[{x,y},{x,y}];
  banner.text = MAPS[id].name; banner.t = 2.2;
  fade.t = 1;   // 맵 전환 페이드 인
}
let bumpCool = 0, turnCool = 0, npcIdleT = 2;
function updateWorld(dt){
  bumpCool = Math.max(0,bumpCool-dt);
  turnCool = Math.max(0,turnCool-dt);
  if(dialog.active || chooser.active || game.lock) return;
  // NPC가 가끔 두리번거린다 (트레이너는 시야가 고정이므로 제외)
  npcIdleT -= dt;
  if(npcIdleT<=0){
    npcIdleT = 1.5+Math.random()*2.5;
    const ns = curMap().npcs||[];
    if(ns.length) ns[rnd(ns.length)].dir = ['up','down','left','right'][rnd(4)];
  }
  if(game.moving){
    game.prog += dt*5.5;
    if(game.prog>=1){
      game.trail.unshift({x:game.px,y:game.py}); game.trail.length=2;
      game.px=game.mx; game.py=game.my; game.moving=false; game.prog=0;
      onStep();
    }
    return;
  }
  for(const dir of ['up','down','left','right']){
    if(!keys[dir]) continue;
    // 다른 방향을 누르면 한 박자 제자리 회전 (짧게 누르면 방향만 바꾼다)
    if(game.dir !== dir){ game.dir = dir; turnCool = .09; break; }
    if(turnCool>0) break;
    const d = {up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[dir];
    const nx=game.px+d[0], ny=game.py+d[1];
    if(canWalk(nx,ny)){ game.mx=nx; game.my=ny; game.moving=true; game.prog=0; }
    else if(bumpCool<=0){ sfx('bump'); bumpCool=.35; }
    break;
  }
}
async function onStep(){
  // 출구
  const ex = (curMap().exits||{})[game.px+','+game.py];
  if(ex){
    if(!game.flags.starter && game.map==='town'){
      game.py += 1; // 되돌리기
      await say('연구원: 잠깐! 몬스터도 없이 풀숲에 가는 건 위험해!\n남쪽 연구소의 박사님을 먼저 만나 보게.');
      return;
    }
    setMap(ex.map, ex.x, ex.y, ex.dir);
    return;
  }
  // 트레이너 시야
  if(await checkSight()) return;
  // 야생 인카운터
  const enc = curMap().encounters;
  if(enc && tileAt(game.px,game.py)==='w' && Math.random()<enc.rate && game.party.some(m=>m.hp>0)){
    let r=Math.random(), name=enc.pool[0][0];
    for(const [n,p] of enc.pool){ if(r<p){name=n;break;} r-=p; }
    const boost = game.flags.champion ? 8 : 0;  // 클리어 후엔 강한 야생이 나온다
    const lvl = enc.lvl[0] + rnd(enc.lvl[1]-enc.lvl[0]+1) + boost;
    await startBattle({wild:makeMon(name,lvl)});
  }
}
const alert_ = {x:0,y:0,t:0};
async function checkSight(){
  for(const tr of curMap().trainers||[]){
    if(game.flags.trainers[tr.id]) continue;
    const d = {up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[tr.dir];
    let hit = false;
    for(let i=1;i<=tr.range;i++){
      const tx=tr.x+d[0]*i, ty=tr.y+d[1]*i;
      if(SOLID.has(tileAt(tx,ty))) break;
      if(game.px===tx && game.py===ty){ hit=true; break; }
    }
    if(!hit) continue;
    game.lock = true;
    alert_.x=tr.x; alert_.y=tr.y; alert_.t=.7;
    sfx('sel');
    // 플레이어가 트레이너를 바라보게
    game.dir = {up:'down',down:'up',left:'right',right:'left'}[tr.dir];
    await wait(700);
    game.lock = false;
    await startBattle({trainer:tr});
    return true;
  }
  return false;
}
function facingTile(){
  const d = {up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[game.dir];
  return [game.px+d[0], game.py+d[1]];
}
function tryInteract(){
  const [tx,ty] = facingTile();
  const m = curMap();
  const npc = (m.npcs||[]).find(n=>n.x===tx&&n.y===ty);
  if(npc){
    npc.dir = {up:'down',down:'up',left:'right',right:'left'}[game.dir];
    if(npc.special==='professor') return professorTalk();
    return (async()=>{ for(const l of npc.lines) await say(l); })();
  }
  const tr = (m.trainers||[]).find(n=>n.x===tx&&n.y===ty);
  if(tr){
    if(game.flags.trainers[tr.id]) return say(tr.name+': '+tr.after);
    return (async()=>{ await startBattle({trainer:tr}); })();
  }
  const sign = (m.signs||{})[tx+','+ty];
  if(sign) return say(sign);
  const door = (m.doors||{})[tx+','+ty];
  if(door==='heal') return healHouse();
  if(door==='shop') return shopFlow();
  if(door==='pc') return pcFlow();
}
const healFx = {t:0};
async function healHouse(){
  await say('엄마: 어서 오렴! 모두들 푹 쉬고 가~');
  sfx('heal');
  healFx.t = 1;                 // 화면이 부드럽게 밝아지는 회복 연출
  for(const mn of game.party){ mn.hp = mn.maxhp; }
  await wait(500);
  await say('포켓 몬스터들이 모두 기운을 되찾았다!');
  saveGame();
}
async function professorTalk(){
  if(!game.flags.starter){
    await say('박사: 오오, 노랑! 기다리고 있었단다.');
    await say('박사: 풀숲에는 야생 포켓 몬스터가 우글우글하지.\n혼자서는 위험해!');
    await say('박사: 이 아이를 데려가렴. 전기 몬스터 「볼티」다!');
    sfx('catch');
    game.party.push(makeMon('볼티',5));
    dexCaught('볼티');
    await say('노랑은 볼티를 받았다!');
    await say('박사: 몬스터볼 5개와 도감도 챙기렴.\n많은 몬스터를 잡아 도감을 채워 다오!');
    game.items.ball += 5;
    game.flags.starter = true;
    saveGame();
    await say('볼티가 기쁜 듯이 노랑의 뒤를 따라왔다!');
  } else if(game.dex.caught.length>=DEX_ORDER.length && !game.flags.dexReward){
    game.flags.dexReward = true;
    await say('박사: 도감을 전부 완성했다고!? 놀랍구나!');
    sfx('money');
    game.items.spotion += 3;
    await say('축하 선물로 고급 물약 3개를 받았다!');
    saveGame();
  } else if(game.flags.champion){
    await say('박사: 챔피언이 되었다고? 정말 자랑스럽구나!\n도감 완성도 잊지 말려무나.');
  } else {
    await say(`박사: 도감은 ${game.dex.caught.length}/${DEX_ORDER.length}종 모았구나.\n북쪽 스타디움의 관장에게 도전해 보렴!`);
  }
}
async function shopFlow(){
  await say('점원: 어서 오세요! 무엇을 드릴까요?');
  while(true){
    const opts = Object.keys(ITEMS).map(k=>`${ITEMS[k].name} ${ITEMS[k].price}원 (보유 ${game.items[k]})`).concat('나가기');
    const c = await choose(opts,{x:45,y:60,w:230,prompt:`소지금 ${game.money}원`});
    if(c<0 || c===opts.length-1) break;
    const key = Object.keys(ITEMS)[c], it = ITEMS[key];
    if(game.money < it.price){ await say('점원: 손님, 돈이 모자라요!'); continue; }
    game.money -= it.price; game.items[key]++;
    sfx('money');
    await say(`${josa(it.name,'을를')} 샀다! (보유 ${game.items[key]}개)`);
  }
  await say('점원: 또 오세요~!');
  saveGame();
}
async function pcFlow(){
  if(!game.flags.starter){ await say('연구소의 몬스터 보관 시스템이다.\n…아직 쓸 일이 없다.'); return; }
  await say('연구소 보관함에 접속했다!');
  while(true){
    if(!game.box.length){ await say('보관함이 비어 있다.'); return; }
    const opts = game.box.map(m=>`${m.name} Lv${m.lvl}`).concat('닫기');
    const c = await choose(opts,{x:40,y:40,w:200,prompt:'데려갈 몬스터는?'});
    if(c<0 || c===opts.length-1) return;
    if(game.party.length<6){
      const mn = game.box.splice(c,1)[0];
      game.party.push(mn);
      await say(`${josa(mn.name,'을를')} 파티에 데려왔다!`);
    } else {
      const opts2 = game.party.map(m=>`${m.name} Lv${m.lvl}`).concat('그만두기');
      const p = await choose(opts2,{x:40,y:40,w:200,prompt:'맡길 몬스터는?'});
      if(p<0 || p===opts2.length-1) continue;
      const out = game.party[p], inn = game.box[c];
      game.party[p] = inn; game.box[c] = out;
      await say(`${josa(out.name,'을를')} 맡기고 ${josa(inn.name,'을를')} 데려왔다!`);
    }
    saveGame();
  }
}

/* ================= 필드 메뉴 ================= */
let menuBusy = false;
async function fieldMenu(){
  if(menuBusy || !game.flags.starter) return;
  menuBusy = true;
  try{
    while(true){
      const c = await choose(['도감','포켓몬','가방','리포트','옵션','닫기'],{x:VW-112,y:8,w:104});
      if(c<0 || c===5) break;
      if(c===0) await dexScreen();
      if(c===1) await partyScreen();
      if(c===2) await bagScreen();
      if(c===3){ saveGame(); await say('리포트를 기록했다!'); }
      if(c===4){
        const s = await choose([`소리: ${audio.on?'켜짐':'꺼짐'} (전환)`,'돌아가기'],{x:VW-150,y:8,w:142});
        if(s===0){ toggleSound(); }
      }
    }
  } finally { menuBusy = false; }
}
const dexUI = {sel:0};
async function dexScreen(){
  const prev = mode; mode='dex'; dexUI.sel=0;
  while(true){
    const k = await waitAnyKey();
    const n = DEX_ORDER.length;
    if(k==='up'){ dexUI.sel=(dexUI.sel+n-1)%n; sfx('sel'); }
    else if(k==='down'){ dexUI.sel=(dexUI.sel+1)%n; sfx('sel'); }
    else if(k==='A'||k==='B') break;
  }
  mode = prev;
}
async function partyScreen(){
  while(true){
    const opts = game.party.map(m=>`${m.name} Lv${m.lvl} ${m.hp}/${m.maxhp}`).concat('돌아가기');
    const c = await choose(opts,{x:30,y:30,w:230,prompt:'포켓몬'});
    if(c<0 || c===opts.length-1) return;
    const mn = game.party[c];
    const a = await choose(['상태 보기','선두로','돌아가기'],{x:80,y:90,w:140});
    if(a===0){
      const d = DEX[mn.name];
      const cur = mn.exp - expToNext(mn.lvl), need = expToNext(mn.lvl+1)-expToNext(mn.lvl);
      await say(`${mn.name} Lv${mn.lvl} (${TYPE_KO[d.type]})\nHP ${mn.hp}/${mn.maxhp}  공격${statOf(d.atk,mn.lvl)} 방어${statOf(d.def,mn.lvl)} 스피드${statOf(d.spd,mn.lvl)}`);
      await say(`경험치 ${cur}/${need}\n기술: ${mn.moves.join(' / ')}`);
    }
    if(a===1 && c>0){
      game.party.unshift(game.party.splice(c,1)[0]);
      await say(`${josa(mn.name,'을를')} 선두로 보냈다!`);
    }
  }
}
async function bagScreen(){
  while(true){
    const opts = [`물약 ×${game.items.potion}`,`고급 물약 ×${game.items.spotion}`,`몬스터볼 ×${game.items.ball}`,'닫기'];
    const c = await choose(opts,{x:VW-170,y:8,w:162,prompt:`소지금 ${game.money}원`});
    if(c<0 || c===3) return;
    if(c===2){ await say('몬스터볼은 배틀 중에 사용할 수 있다.'); continue; }
    const key = c===0?'potion':'spotion', amount = c===0?20:60;
    if(game.items[key]<=0){ await say('하나도 없다!'); continue; }
    const popts = game.party.map(m=>`${m.name} ${m.hp}/${m.maxhp}`).concat('그만두기');
    const p = await choose(popts,{x:30,y:60,w:200,prompt:'누구에게?'});
    if(p<0 || p===popts.length-1) continue;
    const mn = game.party[p];
    if(mn.hp<=0){ await say('쓰러진 몬스터에게는 쓸 수 없다!'); continue; }
    if(mn.hp>=mn.maxhp){ await say('체력이 가득하다!'); continue; }
    game.items[key]--; mn.hp = Math.min(mn.maxhp, mn.hp+amount);
    sfx('heal');
    await say(`${mn.name}의 체력이 회복되었다!`);
  }
}

/* ================= 배틀 ================= */
const battle = {
  on:false, enemy:null, trainer:null, trIdx:0, meIdx:0,
  dispE:0, dispP:0, dispExp:0, shakeE:0, shakeP:0, lungeP:0, lungeE:0, flash:0,
  faintE:0, faintP:0, introT:1,
  evolveQueue:[], trans:0,
};
const activeMon = ()=>game.party[battle.meIdx];
function calcDamage(att, def, move){
  const m = MOVES[move], aD = DEX[att.name], dD = DEX[def.name];
  const atk = statOf(aD.atk,att.lvl), dfn = statOf(dD.def,def.lvl);
  const mul = typeMul(m.type, dD.type);
  const stab = m.type===aD.type ? 1.5 : 1;
  const crit = Math.random()<0.0625 ? 1.7 : 1;
  const base = ((2*att.lvl/5+2)*m.power*atk/dfn)/50+2;
  return {dmg:Math.max(1,Math.floor(base*mul*stab*crit*(0.85+Math.random()*0.15))), mul, crit:crit>1};
}
async function battleTransition(){
  for(let t=0;t<=1.01;t+=0.07){ battle.trans=t; await frame(); await frame(); }
}
async function startBattle(opts){
  if(battle.on) return; // 중복 전투 방지
  const tr = opts.trainer||null;
  game.lock = true;     // 전환 연출 중 이동 금지
  await battleTransition();
  mode='battle'; battle.on=true; battle.trainer=tr; battle.trIdx=0;
  battle.meIdx = Math.max(0, game.party.findIndex(m=>m.hp>0));
  battle.enemy = tr ? makeMon(tr.party[0][0], tr.party[0][1]) : opts.wild;
  battle.flash=1; battle.trans=0;
  battle.faintE=0; battle.faintP=0; battle.introT=0;
  battle.evolveQueue=[];
  dexSee(battle.enemy.name);
  battle.dispE = battle.enemy.hp/battle.enemy.maxhp;
  battle.dispP = activeMon().hp/activeMon().maxhp;
  battle.dispExp = expRatio(activeMon());
  playSong('battle');
  if(tr){
    await say(`${josa(tr.name,'이가')} 승부를 걸어왔다!`);
    await say(tr.intro);
    await say(`${josa(tr.name,'은는')} ${josa(battle.enemy.name,'을를')} 내보냈다!`);
  } else {
    await say(`앗! 야생 ${josa(battle.enemy.name,'이가')} 나타났다!`);
  }
  await say(`가라! ${activeMon().name}!`);
  await battleLoop();
}
function expRatio(mn){
  const cur = mn.exp - expToNext(mn.lvl), need = expToNext(mn.lvl+1)-expToNext(mn.lvl);
  return Math.max(0,Math.min(1,cur/need));
}
async function battleLoop(){
  while(battle.on){
    const c = await choose(['싸운다','가방','포켓몬','도망간다'],
      {cols:2, tag:'battle-main', cancel:false, prompt:`${josa(activeMon().name,'은는')} 무엇을 할까?`});
    if(c===0){ // 싸운다
      const mv = await choose(activeMon().moves, {tag:'battle-moves'});
      if(mv<0) continue;
      await turn({move:mv});
    }
    else if(c===1){ // 가방
      const b = await choose([`몬스터볼 ×${game.items.ball}`,`물약 ×${game.items.potion}`,`고급 물약 ×${game.items.spotion}`],{tag:'battle-moves'});
      if(b<0) continue;
      if(b===0){ await turn({ball:true}); }
      else { await turn({potion:b===1?'potion':'spotion'}); }
    }
    else if(c===2){ // 포켓몬
      const opts = game.party.map((m,i)=>`${m.name} Lv${m.lvl} ${m.hp}/${m.maxhp}${i===battle.meIdx?' ◀':''}`);
      const p = await choose(opts,{tag:'battle-moves'});
      if(p<0) continue;
      if(p===battle.meIdx){ await say('이미 싸우고 있다!'); continue; }
      if(game.party[p].hp<=0){ await say('쓰러져 있어서 싸울 수 없다!'); continue; }
      await turn({switch:p});
    }
    else { // 도망 — 내 몬스터가 빠르면 반드시 성공
      if(battle.trainer){ await say('트레이너 승부에서 도망칠 수는 없다!'); continue; }
      const mySpd = statOf(DEX[activeMon().name].spd, activeMon().lvl);
      const enSpd = statOf(DEX[battle.enemy.name].spd, battle.enemy.lvl);
      if(mySpd>=enSpd || Math.random()<0.6){ sfx('run'); await say('무사히 도망쳤다!'); return endBattle(); }
      await say('도망칠 수 없었다!');
      await turn({pass:true});
    }
  }
}
async function turn(act){
  const en = battle.enemy;
  // 플레이어 액션이 공격일 때만 스피드 순서, 그 외엔 액션 후 적 공격
  if(act.move!==undefined){
    const me = activeMon();
    const meFirst = statOf(DEX[me.name].spd,me.lvl) >= statOf(DEX[en.name].spd,en.lvl);
    const seq = meFirst ? ['me','en'] : ['en','me'];
    for(const who of seq){
      if(!battle.on) return;
      if(who==='me'){
        if(me.hp<=0) continue;
        await doMove(me,en,me.moves[act.move],true);
        if(en.hp<=0){ await enemyFainted(); return; }
      } else {
        if(en.hp<=0) continue;
        await enemyAttack();
        if(!battle.on) return;
        if(activeMon().hp<=0){ await playerFainted(); return; }
      }
    }
    return;
  }
  if(act.ball) {
    const done = await throwBall();
    if(done===null) return;          // 던질 수 없었음 — 턴을 소비하지 않는다
    if(done||!battle.on) return;
  }
  if(act.potion){
    const key = act.potion, amount = key==='potion'?20:60;
    if(game.items[key]<=0){ await say('하나도 없다!'); return; }
    const me = activeMon();
    if(me.hp>=me.maxhp){ await say('체력이 가득하다!'); return; }
    game.items[key]--; me.hp = Math.min(me.maxhp, me.hp+amount);
    sfx('heal');
    await say(`${me.name}의 체력이 회복되었다!`);
  }
  if(act.switch!==undefined){
    await say(`돌아와, ${activeMon().name}!`);
    battle.meIdx = act.switch;
    battle.dispP = activeMon().hp/activeMon().maxhp;
    battle.dispExp = expRatio(activeMon());
    await say(`가라! ${activeMon().name}!`);
  }
  // 적의 반격
  if(en.hp>0){
    await enemyAttack();
    if(battle.on && activeMon().hp<=0) await playerFainted();
  }
}
async function enemyAttack(){
  const en = battle.enemy, me = activeMon();
  let mv;
  if(battle.trainer && Math.random()<0.6){
    // 트레이너는 상성·위력이 좋은 기술을 고른다
    const score = m => MOVES[m].power
      * typeMul(MOVES[m].type, DEX[me.name].type)
      * (MOVES[m].type===DEX[en.name].type ? 1.5 : 1);
    mv = en.moves.reduce((b,m)=>score(m)>score(b)?m:b, en.moves[0]);
  } else {
    mv = en.moves[rnd(en.moves.length)];
  }
  await doMove(en,me,mv,false);
}
async function doMove(user,target,move,isPlayer){
  await say(`${isPlayer?'':(battle.trainer?'상대 ':'야생 ')}${user.name}의 ${move}!`);
  if(isPlayer){ battle.lungeP=1; } else { battle.lungeE=1; }
  await wait(120);
  sfx('hit');
  if(isPlayer) battle.shakeE=1; else battle.shakeP=1;
  const {dmg,mul,crit} = calcDamage(user,target,move);
  target.hp = Math.max(0, target.hp-dmg);
  if(mul>1 || crit) battle.flash = Math.max(battle.flash,0.35);  // 강타 시 화면 섬광
  await wait(250);
  await hpSettle();                  // HP바가 다 줄어든 뒤에 결과를 알린다
  if(crit) await say('급소에 맞았다!');
  if(mul>1) await say('효과가 굉장했다!');
  else if(mul<1) await say('효과가 별로인 듯하다…');
}
// HP바 애니메이션이 실제 수치를 따라잡을 때까지 잠깐 대기
async function hpSettle(){
  for(let i=0;i<90 && battle.on && battle.enemy;i++){
    const me = activeMon(), en = battle.enemy;
    if(Math.abs(battle.dispE-en.hp/en.maxhp)<.02 &&
       Math.abs(battle.dispP-me.hp/me.maxhp)<.02) break;
    await frame();
  }
}
// 쓰러진 몬스터가 가라앉으며 사라지는 연출
async function faintAnim(key){
  const t0 = performance.now();
  while(performance.now()-t0 < 450){
    battle[key] = Math.min(1,(performance.now()-t0)/450);
    await frame();
  }
  battle[key] = 1;
}
async function gainExp(faintedEnemy){
  const me = activeMon();
  let gain = Math.floor(DEX[faintedEnemy.name].exp * faintedEnemy.lvl / 5) + 1;
  if(battle.trainer) gain = Math.floor(gain*1.5);
  me.exp += gain;
  await say(`${josa(me.name,'은는')} 경험치 ${josa(gain,'을를')} 얻었다!`);
  while(me.exp >= expToNext(me.lvl+1)){
    me.lvl++;
    const grow = maxHpOf(DEX[me.name].hp,me.lvl) - me.maxhp;
    me.maxhp += grow; me.hp = Math.min(me.maxhp, me.hp+grow);
    sfx('lvl');
    await say(`${josa(me.name,'은는')} 레벨 ${josa(me.lvl,'이가')} 되었다!\n최대 HP ${me.maxhp} (+${grow})`);
    for(const [l,mv] of DEX[me.name].learn){
      if(l===me.lvl && !me.moves.includes(mv)){
        if(me.moves.length>=4){
          const old = me.moves.shift();
          await say(`${josa(me.name,'은는')} ${josa(old,'을를')} 잊고…`);
        }
        me.moves.push(mv);
        await say(`${josa(mv,'을를')} 배웠다!`);
      }
    }
    const ev = DEX[me.name].evolve;
    if(ev && me.lvl>=ev.lv && !battle.evolveQueue.includes(me)) battle.evolveQueue.push(me);
  }
}
async function enemyFainted(){
  const en = battle.enemy, tr = battle.trainer;
  sfx('faint');
  await faintAnim('faintE');
  await say(`${tr?'상대 ':'야생 '}${josa(en.name,'은는')} 쓰러졌다!`);
  if(!tr) playSong('victory');   // 야생전 승리 팡파르 (경험치 메시지 동안 재생)
  await gainExp(en);
  if(tr){
    battle.trIdx++;
    if(battle.trIdx < tr.party.length){
      const next = makeMon(tr.party[battle.trIdx][0], tr.party[battle.trIdx][1]);
      // 상대가 다음 몬스터를 내기 전에 교체 기회를 준다 (턴 소비 없음)
      const hasOther = game.party.some((m,i)=>m.hp>0 && i!==battle.meIdx);
      if(hasOther){
        await say(`${josa(tr.name,'은는')} ${josa(next.name,'을를')}\n내보내려 한다.`);
        const sw = await choose(['그대로 싸운다','교체한다'],{tag:'battle-moves',cancel:false,prompt:'몬스터를 교체할까?'});
        if(sw===1){
          while(true){
            const opts = game.party.map((m,i)=>`${m.name} Lv${m.lvl} ${m.hp}/${m.maxhp}${i===battle.meIdx?' ◀':''}`);
            const p = await choose(opts,{tag:'battle-moves'});
            if(p<0 || p===battle.meIdx) break;   // 취소하면 그대로 싸운다
            if(game.party[p].hp<=0){ await say('쓰러져 있어서 싸울 수 없다!'); continue; }
            await say(`돌아와, ${activeMon().name}!`);
            battle.meIdx = p;
            battle.dispP = activeMon().hp/activeMon().maxhp;
            battle.dispExp = expRatio(activeMon());
            battle.faintP = 0;
            await say(`가라! ${activeMon().name}!`);
            break;
          }
        }
      }
      battle.enemy = next;
      dexSee(battle.enemy.name);
      battle.dispE = 1; battle.faintE = 0;
      await say(`${josa(tr.name,'은는')} ${josa(battle.enemy.name,'을를')} 내보냈다!`);
      return; // battleLoop 계속
    }
    playSong('victory');
    await say(`${josa(tr.name,'과와')}의 승부에서 이겼다!`);
    await say(tr.name+': '+tr.lose);
    game.money += tr.prize;
    sfx('money');
    await say(`상금으로 ${tr.prize}원을 받았다!`);
    game.flags.trainers[tr.id] = true;
    endBattle();
    if(tr.champion) await endingSequence();
    return;
  }
  endBattle();
}
async function playerFainted(){
  sfx('faint');
  await faintAnim('faintP');
  await say(`${josa(activeMon().name,'은는')} 쓰러졌다…`);
  const alive = game.party.map((m,i)=>i).filter(i=>game.party[i].hp>0);
  if(alive.length){
    const opts = alive.map(i=>`${game.party[i].name} Lv${game.party[i].lvl} ${game.party[i].hp}/${game.party[i].maxhp}`);
    const c = await choose(opts,{tag:'battle-moves',cancel:false,prompt:'다음 몬스터는?'});
    battle.meIdx = alive[c];
    battle.dispP = activeMon().hp/activeMon().maxhp;
    battle.dispExp = expRatio(activeMon());
    battle.faintP = 0;
    await say(`가라! ${activeMon().name}!`);
    return;
  }
  await say('노랑은 눈앞이 캄캄해졌다…');
  for(const m of game.party) m.hp = m.maxhp;
  const half = Math.floor(game.money/2);
  if(half>0){ game.money -= half; await say(`당황한 나머지 ${half}원을 떨어뜨렸다…`); }
  endBattle();
  setMap('town',13,6,'down');
  saveGame();
}
async function throwBall(){
  if(battle.trainer){ await say('남의 몬스터에게 볼을 던질 수는 없다!'); return null; }
  if(game.items.ball<=0){ await say('몬스터볼이 없다!'); return null; }
  game.items.ball--;
  const en = battle.enemy;
  sfx('ball');
  battle.ballAnim = {rock:0};   // 적 스프라이트 대신 볼을 그린다
  await say(`몬스터볼을 던졌다! (남은 볼 ${game.items.ball}개)`);
  const chance = DEX[en.name].catch * (1.6 - en.hp/en.maxhp);
  const shakes = Math.random()<chance ? 3 : rnd(3);
  for(let i=0;i<Math.min(shakes,3);i++){
    battle.ballAnim.rock = 1;
    sfx('bump');
    await wait(620);
  }
  await wait(350);
  if(shakes>=3){
    sfx('catch');
    playSong('victory');
    en.hp = Math.max(1,en.hp);
    await say(`신난다! ${josa(en.name,'을를')} 잡았다!`);
    dexCaught(en.name);
    if(game.party.length<6){ game.party.push(en); await say(`${josa(en.name,'이가')} 동료가 되었다!`); }
    else { game.box.push(en); await say(`파티가 가득 차 ${josa(en.name,'은는')}\n연구소 보관함으로 보내졌다.`); }
    endBattle();
    return true;
  }
  battle.ballAnim = null;
  battle.flash = 0.6;           // 볼에서 탈출하는 섬광
  await say('아앗! 나와버렸다!');
  return false;
}
function endBattle(){
  battle.on=false; battle.enemy=null; battle.trainer=null; battle.ballAnim=null;
  game.lock=false;
  mode='world';
  playSong(curMap().music);
  saveGame();
  if(battle.evolveQueue.length){
    const q=[...battle.evolveQueue]; battle.evolveQueue=[];
    (async()=>{ for(const mn of q) await evolveScene(mn); })();
  }
}

/* ================= 진화 ================= */
const evolve = {mon:null, from:'', to:'', t:0};
async function evolveScene(mn){
  const ev = DEX[mn.name].evolve;
  if(!ev) return;
  mode='evolve';
  evolve.mon=mn; evolve.from=mn.name; evolve.to=ev.to; evolve.t=0;
  await say(`엇!? ${mn.name}의 모습이…!`);
  const t0 = performance.now();
  let bReleased = !keys.B;   // 직전 대사를 닫은 B 홀드는 무시
  while(performance.now()-t0 < 2600){
    if(!keys.B) bReleased = true;
    if(bReleased && keys.B){  // B로 진화 취소 (다음 레벨 업 때 다시 시도)
      evolve.t = 0;
      mode='world';
      await say(`어라!? ${josa(mn.name,'이가')} 진화를 멈췄다!`);
      return;
    }
    evolve.t=(performance.now()-t0)/2600; await frame();
  }
  const oldName = mn.name, ratio = mn.hp/mn.maxhp;
  mn.name = ev.to;
  mn.maxhp = maxHpOf(DEX[mn.name].hp, mn.lvl);
  mn.hp = Math.max(1,Math.floor(mn.maxhp*ratio));
  dexCaught(mn.name);
  evolve.t=1;
  sfx('lvl');
  await say(`축하합니다! ${josa(oldName,'은는')}\n${josa(mn.name,'으로')} 진화했다!`);
  mode='world';
  saveGame();
}

/* ================= 엔딩 ================= */
const ending = {y:0};
async function endingSequence(){
  game.flags.champion = true;
  mode='ending'; ending.y = VH+20;
  playSong('title');
  const total = CREDITS.length*22 + VH + 60;
  while(ending.y > -CREDITS.length*22 + VH/2 - 40){
    ending.y -= 0.45;
    await frame();
    if(keys.A) ending.y -= 2;
  }
  await waitAnyKey();
  mode='world';
  playSong(curMap().music);
  await say('박사에게서 통신이 왔다!\n"챔피언 등극을 축하한다, 노랑!"');
  saveGame();
}

/* ================= 타이틀 / 새 게임 ================= */
let titleBusy=false;
async function titleMenu(){
  if(titleBusy) return; titleBusy=true;
  try{
    const has = !!localStorage.getItem(SAVE_KEY);
    if(has){
      // 저장된 모험의 요약을 보여준다
      let info = '';
      try{
        const s = JSON.parse(localStorage.getItem(SAVE_KEY));
        if(s?.party?.length) info = `${MAPS[s.map]?.name||'?'} · ${s.party[0].name} Lv${s.party[0].lvl}`;
      }catch(e){}
      const c = await choose(['이어하기','새로운 모험'],{x:VW/2-85,y:184,w:170,cancel:false,prompt:info});
      if(c===0 && loadGame()){
        mode='world'; banner.text=curMap().name; banner.t=2;
        playSong(curMap().music);
        return;
      }
      const ok = await choose(['돌아가기','네, 처음부터 시작'],{x:VW/2-90,y:190,w:180,prompt:'기존 기록이 지워집니다!'});
      if(ok!==1) return;
    }
    await newGame();
  } finally { titleBusy=false; }
}
async function newGame(){
  localStorage.removeItem(SAVE_KEY);
  Object.assign(game,{
    map:'town',px:13,py:6,dir:'down',moving:false,prog:0,
    trail:[{x:13,y:7},{x:13,y:7}],
    party:[],box:[],items:{ball:0,potion:2,spotion:0},money:3000,
    flags:{starter:false,champion:false,trainers:{}},dex:{seen:[],caught:[]},lock:false,
  });
  mode='intro';
  playSong(null);
  await say('박사: 안녕! 포켓 몬스터 세계에 온 것을 환영한다!');
  await say('박사: 이 세계에는 신비한 생물,\n포켓 몬스터들이 곳곳에 살고 있지.');
  await say('박사: 너의 이름은… 그래, 「노랑」이구나!');
  await say('박사: 너만의 몬스터와 함께하는 모험이\n지금 시작된다! 연구소에서 기다리마!');
  mode='world';
  setMap('town',13,6,'down');
  playSong('field');
}

/* ================= 렌더링 ================= */
const C = {grass:'#7ec850',grassD:'#6ab33e',tall:'#3f9132',tallD:'#2c7a24',path:'#e8d8a8',pathD:'#d4c08a',
  tree1:'#2c6e31',tree2:'#1e5424',trunk:'#7a4a22',water:'#4a90e8',waterD:'#3a78c8',
  roof:'#d23b3b',roofD:'#a82828',wall:'#e8dcc8',door:'#7a4a22',sign:'#b08850',fence:'#c0a060',
  flower:'#e85a8a',sand:'#e8dcb0',sandD:'#d8c898',pillar:'#b0a8a0',pillarD:'#88807a'};
let clock = 0;
function drawTile(t,sx,sy){
  switch(t){
    case '.':
      ctx.fillStyle=C.grass; ctx.fillRect(sx,sy,16,16);
      ctx.fillStyle=C.grassD; ctx.fillRect(sx+3,sy+5,2,2); ctx.fillRect(sx+10,sy+11,2,2);
      break;
    case 'w':
      ctx.fillStyle=C.tall; ctx.fillRect(sx,sy,16,16);
      ctx.fillStyle=C.tallD;
      for(let i=0;i<4;i++){ ctx.fillRect(sx+1+i*4,sy+4,2,9); ctx.fillRect(sx+i*4,sy+2,1,4); }
      break;
    case ',':
      ctx.fillStyle=C.path; ctx.fillRect(sx,sy,16,16);
      ctx.fillStyle=C.pathD; ctx.fillRect(sx+4,sy+8,3,2); ctx.fillRect(sx+11,sy+3,2,2);
      break;
    case ':':
      ctx.fillStyle=C.sand; ctx.fillRect(sx,sy,16,16);
      ctx.fillStyle=C.sandD; ctx.fillRect(sx+2,sy+4,2,1); ctx.fillRect(sx+9,sy+12,3,1); ctx.fillRect(sx+12,sy+6,2,1);
      break;
    case 'P':
      ctx.fillStyle=C.sand; ctx.fillRect(sx,sy,16,16);
      ctx.fillStyle=C.pillar; ctx.fillRect(sx+3,sy,10,16);
      ctx.fillStyle=C.pillarD; ctx.fillRect(sx+3,sy,2,16); ctx.fillRect(sx+3,sy+13,10,3);
      ctx.fillStyle='#d8d0c8'; ctx.fillRect(sx+2,sy,12,2);
      break;
    case 'F': {
      ctx.fillStyle=C.grass; ctx.fillRect(sx,sy,16,16);
      const fy = Math.sin(clock*2+sx)>0?0:1;
      ctx.fillStyle=C.flower;
      ctx.fillRect(sx+3,sy+4+fy,4,4); ctx.fillRect(sx+10,sy+9-fy,4,4);
      ctx.fillStyle='#ffe06b'; ctx.fillRect(sx+4,sy+5+fy,2,2); ctx.fillRect(sx+11,sy+10-fy,2,2);
      break; }
    case 'T':
      ctx.fillStyle=C.grass; ctx.fillRect(sx,sy,16,16);
      ctx.fillStyle=C.trunk; ctx.fillRect(sx+6,sy+11,4,5);
      ctx.fillStyle=C.tree1; ctx.fillRect(sx+1,sy+4,14,9);
      ctx.fillStyle=C.tree2; ctx.fillRect(sx+3,sy+1,10,5); ctx.fillRect(sx+1,sy+10,14,3);
      break;
    case '~': {
      const ph = Math.floor(clock*2)%2;
      ctx.fillStyle=C.water; ctx.fillRect(sx,sy,16,16);
      ctx.fillStyle=C.waterD; ctx.fillRect(sx+2+ph*4,sy+4,6,1); ctx.fillRect(sx+6-ph*3,sy+11,6,1);
      break; }
    case 'R':
      ctx.fillStyle=C.roof; ctx.fillRect(sx,sy,16,16);
      ctx.fillStyle=C.roofD; ctx.fillRect(sx,sy+6,16,2); ctx.fillRect(sx,sy+13,16,2);
      break;
    case 'W':
      ctx.fillStyle=C.wall; ctx.fillRect(sx,sy,16,16);
      ctx.fillStyle='#c8b898'; ctx.fillRect(sx,sy+7,16,1); ctx.fillRect(sx+8,sy,1,7); ctx.fillRect(sx+4,sy+8,1,8);
      break;
    case 'D':
      ctx.fillStyle=C.wall; ctx.fillRect(sx,sy,16,16);
      ctx.fillStyle=C.door; ctx.fillRect(sx+3,sy+3,10,13);
      ctx.fillStyle='#ffe06b'; ctx.fillRect(sx+10,sy+9,2,2);
      break;
    case 'S':
      ctx.fillStyle=C.grass; ctx.fillRect(sx,sy,16,16);
      ctx.fillStyle=C.sign; ctx.fillRect(sx+2,sy+3,12,8); ctx.fillRect(sx+7,sy+11,2,4);
      ctx.fillStyle='#7a5c30'; ctx.fillRect(sx+4,sy+5,8,1); ctx.fillRect(sx+4,sy+8,8,1);
      break;
    case 'f':
      ctx.fillStyle=C.grass; ctx.fillRect(sx,sy,16,16);
      ctx.fillStyle=C.fence; ctx.fillRect(sx,sy+6,16,3); ctx.fillRect(sx+2,sy+3,3,10); ctx.fillRect(sx+11,sy+3,3,10);
      break;
  }
}
function panel(x,y,w,h){
  ctx.fillStyle='#fffce8'; ctx.fillRect(x,y,w,h);
  ctx.strokeStyle='#222034'; ctx.lineWidth=2; ctx.strokeRect(x+1,y+1,w-2,h-2);
}
function wrapText(text,x,y,maxW,lh){
  let line='', yy=y;
  for(const ch of text){
    if(ch==='\n' || ctx.measureText(line+ch).width>maxW){ ctx.fillText(line,x,yy); line = ch==='\n'?'':ch; yy+=lh; }
    else line+=ch;
  }
  ctx.fillText(line,x,yy);
}
function drawWorld(){
  let pxf=game.px, pyf=game.py;
  if(game.moving){ pxf=lerp(game.px,game.mx,game.prog); pyf=lerp(game.py,game.my,game.prog); }
  const m = curMap(), MW = m.rows[0].length, MH = m.rows.length;
  let camX = pxf*TILE+8-VW/2, camY = pyf*TILE+8-VH/2;
  camX = Math.round(Math.max(0,Math.min(MW*TILE-VW,camX)));
  camY = Math.round(Math.max(0,Math.min(MH*TILE-VH,camY)));
  const x0=Math.floor(camX/TILE), y0=Math.floor(camY/TILE);
  for(let y=y0;y<=y0+VH/TILE;y++)
    for(let x=x0;x<=x0+VW/TILE;x++)
      drawTile(tileAt(x,y), x*TILE-camX, y*TILE-camY);
  // NPC + 트레이너
  for(const n of [...(m.npcs||[]),...(m.trainers||[])]){
    const spr = PEOPLE[n.person][n.dir||'down'];
    ctx.drawImage(spr, n.x*TILE-camX, n.y*TILE-camY-3, 16,16);
  }
  // ! 표시
  if(alert_.t>0){
    panel(alert_.x*TILE-camX+2, alert_.y*TILE-camY-18, 12,14);
    ctx.fillStyle='#d23b3b'; ctx.font='bold 11px sans-serif';
    ctx.fillText('!', alert_.x*TILE-camX+6, alert_.y*TILE-camY-7);
  }
  // 따라다니는 파트너
  if(game.party.length){
    const t1=game.trail[0], t2=game.trail[1]||t1;
    let fx=t1.x, fy=t1.y;
    if(game.moving){ fx=lerp(t2.x,t1.x,game.prog); fy=lerp(t2.y,t1.y,game.prog); }
    const hop = game.moving ? -Math.abs(Math.sin(game.prog*Math.PI))*2 : 0;
    ctx.drawImage(SPR[game.party[0].name], Math.round(fx*TILE-camX), Math.round(fy*TILE-camY-1+hop), 16,16);
  }
  // 플레이어
  const bob = game.moving ? (Math.floor(game.prog*4)%2) : 0;
  const spr = PEOPLE.player[game.dir];
  const walkFlip = game.moving && (game.dir==='up'||game.dir==='down') && (game.px+game.py)%2===0;
  ctx.save();
  if(walkFlip){ ctx.translate(Math.round(pxf*TILE-camX)+16, 0); ctx.scale(-1,1); ctx.drawImage(spr,0,Math.round(pyf*TILE-camY-3-bob),16,16); }
  else ctx.drawImage(spr, Math.round(pxf*TILE-camX), Math.round(pyf*TILE-camY-3-bob), 16,16);
  ctx.restore();
  // 풀숲 위에 서 있으면 하반신이 풀에 가려진다
  const grassTiles = [[game.px,game.py]];
  if(game.moving) grassTiles.push([game.mx,game.my]);
  if(game.party.length){
    grassTiles.push([game.trail[0].x,game.trail[0].y]);
    if(game.moving && game.trail[1]) grassTiles.push([game.trail[1].x,game.trail[1].y]);
  }
  for(const [gx,gy] of grassTiles){
    if(tileAt(gx,gy)!=='w') continue;
    const sx=gx*TILE-camX, sy=gy*TILE-camY;
    ctx.fillStyle=C.tall; ctx.fillRect(sx,sy+10,16,6);
    ctx.fillStyle=C.tallD;
    for(let i=0;i<4;i++) ctx.fillRect(sx+1+i*4,sy+8,2,7);
  }
  // 맵 이름 배너
  if(banner.t>0){
    const a = Math.min(1,banner.t);
    ctx.globalAlpha = a;
    panel(VW/2-70,10,140,26);
    ctx.fillStyle='#222034'; ctx.font='bold 13px sans-serif'; ctx.textAlign='center';
    ctx.fillText(banner.text, VW/2, 28);
    ctx.textAlign='left';
    ctx.globalAlpha = 1;
  }
  // 회복 연출 (흰 빛 페이드)
  if(healFx.t>0){
    ctx.fillStyle=`rgba(255,255,240,${Math.min(0.85,healFx.t)})`;
    ctx.fillRect(0,0,VW,VH);
  }
  // 맵 전환 페이드 인
  if(fade.t>0){
    ctx.fillStyle=`rgba(26,28,44,${Math.min(1,fade.t)})`;
    ctx.fillRect(0,0,VW,VH);
  }
  // 배틀 전환 효과
  if(battle.trans>0){
    ctx.fillStyle='#222034';
    const r = battle.trans*VW*0.75;
    ctx.beginPath(); ctx.arc(VW/2,VH/2,r,0,7); ctx.fill();
  }
}
function hpColor(r){ return r>0.5?'#4fae4f':r>0.2?'#e8a020':'#e85a5a'; }
function drawHPBar(x,y,w,ratio){
  ctx.fillStyle='#222034'; ctx.fillRect(x,y,w,6);
  ctx.fillStyle=hpColor(ratio); ctx.fillRect(x+1,y+1,Math.max(0,Math.round((w-2)*ratio)),4);
}
function drawBattle(){
  // 장소에 따라 배경 분위기가 달라진다 (스타디움은 모래빛)
  const inStadium = game.map==='stadium';
  ctx.fillStyle = inStadium ? '#f6eed8' : '#f0f8e8'; ctx.fillRect(0,0,VW,VH);
  ctx.fillStyle = inStadium ? '#e4d6ae' : '#d8e8c8'; ctx.fillRect(0,170,VW,36);
  const en = battle.enemy, me = activeMon();
  // 배틀 시작 시 양쪽에서 미끄러져 들어오는 등장 연출
  const intro = 1-Math.pow(1-battle.introT,3);
  const slideE = (1-intro)*140, slideP = (1-intro)*-160;
  if(en){
    // 적
    const shE = battle.shakeE>0?Math.sin(battle.shakeE*40)*3:0;
    const lgE = battle.lungeE>0?Math.sin(battle.lungeE*Math.PI)*-8:0;
    ctx.fillStyle='#c8d8b0'; ctx.beginPath(); ctx.ellipse(232+slideE,108,46,12,0,0,7); ctx.fill();
    if(battle.ballAnim){
      // 포획 중: 몬스터볼이 흔들린다
      const ang = Math.sin(clock*22)*battle.ballAnim.rock*0.5;
      ctx.save(); ctx.translate(232,98); ctx.rotate(ang);
      ctx.fillStyle='#e84040'; ctx.beginPath(); ctx.arc(0,0,13,Math.PI,0); ctx.fill();
      ctx.fillStyle='#f8f8f8'; ctx.beginPath(); ctx.arc(0,0,13,0,Math.PI); ctx.fill();
      ctx.fillStyle='#222034'; ctx.fillRect(-13,-2,26,4);
      ctx.beginPath(); ctx.arc(0,0,4.5,0,7); ctx.fill();
      ctx.fillStyle='#f8f8f8'; ctx.beginPath(); ctx.arc(0,0,2.5,0,7); ctx.fill();
      ctx.restore();
    } else if(battle.faintE<1){
      ctx.save(); ctx.globalAlpha = 1-battle.faintE;
      ctx.drawImage(SPR[en.name],0,0,16,16, 200+shE+lgE+slideE, 48+battle.faintE*32, 64,64);
      ctx.restore();
    }
    panel(12,12,148,46);
    ctx.fillStyle='#222034'; ctx.font='bold 12px sans-serif';
    ctx.fillText(`${en.name}  Lv${en.lvl}`, 20, 30);
    drawHPBar(20,38,124,battle.dispE);
    if(battle.trainer){
      ctx.font='10px sans-serif';
      ctx.fillText(`${battle.trIdx+1}/${battle.trainer.party.length}`, 138, 30);
    }
    // 아군
    const shP = battle.shakeP>0?Math.sin(battle.shakeP*40)*3:0;
    const lgP = battle.lungeP>0?Math.sin(battle.lungeP*Math.PI)*8:0;
    ctx.fillStyle='#c8d8b0'; ctx.beginPath(); ctx.ellipse(80+slideP,196,50,12,0,0,7); ctx.fill();
    if(battle.faintP<1){
      ctx.save(); ctx.globalAlpha = 1-battle.faintP;
      ctx.translate(116+shP+lgP+slideP,128+battle.faintP*32); ctx.scale(-1,1);
      ctx.drawImage(SPR[me.name],0,0,16,16,-36,0,72,72);
      ctx.restore();
    }
    panel(164,134,148,62);
    ctx.fillStyle='#222034'; ctx.font='bold 12px sans-serif';
    ctx.fillText(`${me.name}  Lv${me.lvl}`, 172, 150);
    drawHPBar(172,156,124,battle.dispP);
    // 저체력 경고: HP바가 깜빡인다
    if(battle.dispP>0 && battle.dispP<0.25){
      ctx.globalAlpha = 0.25+0.25*Math.sin(clock*9);
      ctx.fillStyle='#fffce8';
      ctx.fillRect(173,157,Math.max(1,Math.round(122*battle.dispP)),4);
      ctx.globalAlpha = 1;
    }
    ctx.font='11px sans-serif';
    // HP 숫자도 바와 함께 줄어드는 애니메이션
    const shownHp = Math.abs(battle.dispP - me.hp/me.maxhp)<.01
      ? me.hp : Math.max(0,Math.round(battle.dispP*me.maxhp));
    ctx.fillText(`${shownHp} / ${me.maxhp}`, 172, 174);
    // EXP 바
    ctx.fillStyle='#222034'; ctx.fillRect(172,180,124,4);
    ctx.fillStyle='#4a90e8'; ctx.fillRect(173,181,Math.round(122*battle.dispExp),2);
  }
  // 하단 박스
  panel(0,206,VW,82);
  ctx.fillStyle='#222034'; ctx.font='bold 13px sans-serif';
  if(dialog.active){
    wrapText(dialog.text.slice(0,dialog.shown), 14, 230, VW-28, 19);
    if(dialog.shown>=dialog.text.length) ctx.fillText('▼', VW-24, 280+(Math.floor(clock*3)%2));
  }
  else if(chooser.active && chooser.cfg.tag==='battle-main'){
    ctx.fillText(chooser.cfg.prompt||'', 14, 226);
    chooser.options.forEach((s,i)=>{
      const x = 24+(i%2)*150, y = 250+Math.floor(i/2)*22;
      ctx.fillText(`${i===chooser.idx?'▶':'  '} ${s}`, x, y);
    });
  }
  else if(chooser.active && chooser.cfg.tag==='battle-moves'){
    if(chooser.cfg.prompt) ctx.fillText(chooser.cfg.prompt, 170, 226);
    const lh = chooser.options.length>4 ? 12 : 15;       // 6마리 파티도 박스 안에
    if(chooser.options.length>4) ctx.font='bold 11px sans-serif';
    chooser.options.forEach((s,i)=>{
      ctx.fillText(`${i===chooser.idx?'▶':'  '} ${s}`, 14, 224+i*lh);
    });
    ctx.font='bold 13px sans-serif';
    const sel = chooser.options[chooser.idx];
    const mv = MOVES[sel];
    if(mv){
      ctx.font='11px sans-serif';
      let info = `타입:${TYPE_KO[mv.type]}  위력:${mv.power}`;
      if(battle.enemy){
        const mul = typeMul(mv.type, DEX[battle.enemy.name].type);
        if(mul>1) info += '  ▲굉장';
        else if(mul<1) info += '  ▽별로';
      }
      ctx.fillText(info, 178, 282);
    }
  }
  if(battle.flash>0){ ctx.fillStyle=`rgba(255,255,255,${battle.flash})`; ctx.fillRect(0,0,VW,VH); }
}
function drawTitle(){
  const g = ctx.createLinearGradient(0,0,0,VH);
  g.addColorStop(0,'#1a2a5a'); g.addColorStop(1,'#4a3a8a');
  ctx.fillStyle=g; ctx.fillRect(0,0,VW,VH);
  // 별
  ctx.fillStyle='#fffce8';
  for(let i=0;i<30;i++){
    const x=(i*97)%VW, y=(i*53)%140;
    if(Math.sin(clock*2+i)>0) ctx.fillRect(x,y,2,2);
  }
  const bounce = Math.abs(Math.sin(clock*2.5))*8;
  ctx.drawImage(SPR['볼티'],0,0,16,16, VW/2-48, 64-bounce, 96,96);
  ctx.textAlign='center';
  ctx.fillStyle='#ffd93b'; ctx.font='bold 26px sans-serif';
  ctx.fillText('포켓 몬스터즈 Y', VW/2, 42);
  ctx.fillStyle='#fffce8'; ctx.font='bold 13px sans-serif';
  ctx.fillText('— 옐로 어드벤처 —', VW/2, 60);
  if(!chooser.active && Math.floor(clock*1.5)%2===0){
    ctx.fillStyle='#fffce8'; ctx.font='bold 14px sans-serif';
    ctx.fillText('PRESS  Z / ENTER', VW/2, 215);
  }
  ctx.fillStyle='rgba(255,252,232,.6)'; ctx.font='10px sans-serif';
  ctx.fillText('© 2026 CLAUDE GAME FREAK-ISH', VW/2, VH-12);
  ctx.textAlign='left';
}
function drawIntro(){
  ctx.fillStyle='#222034'; ctx.fillRect(0,0,VW,VH);
  ctx.drawImage(PEOPLE.professor.down,0,0,16,16, VW/2-40, 56, 80,80);
  const bounce = Math.abs(Math.sin(clock*3))*4;
  ctx.drawImage(SPR['볼티'],0,0,16,16, VW/2+30, 100-bounce, 40,40);
}
function drawEvolve(){
  ctx.fillStyle='#222034'; ctx.fillRect(0,0,VW,VH);
  const t = evolve.t;
  const flash = Math.sin(t*t*60)>0;
  const name = (t>=1) ? evolve.to : (flash&&t>0.3 ? evolve.to : evolve.from);
  if(flash&&t>0.1&&t<1){
    ctx.fillStyle='rgba(255,255,255,.25)'; ctx.fillRect(0,0,VW,VH);
  }
  ctx.drawImage(SPR[name],0,0,16,16, VW/2-48, VH/2-70, 96,96);
}
function drawEnding(){
  ctx.fillStyle='#1a1c2c'; ctx.fillRect(0,0,VW,VH);
  ctx.textAlign='center'; ctx.fillStyle='#fffce8'; ctx.font='bold 13px sans-serif';
  CREDITS.forEach((line,i)=>{
    const y = ending.y + i*22;
    if(y>-20 && y<VH+20) ctx.fillText(line, VW/2, y);
  });
  const bounce = Math.abs(Math.sin(clock*2.5))*5;
  ctx.drawImage(SPR['볼티'],0,0,16,16, VW-50, VH-50-bounce, 32,32);
  ctx.textAlign='left';
}
function drawDex(){
  drawWorld();
  panel(8,10,VW-16,VH-20);
  ctx.fillStyle='#222034'; ctx.font='bold 13px sans-serif';
  ctx.fillText(`몬스터 도감  포획 ${game.dex.caught.length}·발견 ${game.dex.seen.length}/${DEX_ORDER.length}`, 20, 30);
  // 왼쪽: 목록
  ctx.font='12px sans-serif';
  DEX_ORDER.forEach((n,i)=>{
    const y = 52+i*17;
    const caught = game.dex.caught.includes(n), seen = game.dex.seen.includes(n);
    const mark = caught?'●':seen?'○':'·';
    const label = (caught||seen) ? n : '？？？';
    if(i===dexUI.sel){ ctx.fillStyle='#e8e0c0'; ctx.fillRect(16,y-12,128,16); }
    ctx.fillStyle='#222034';
    ctx.fillText(`${i===dexUI.sel?'▶':' '}${String(DEX[n].no).padStart(2,'0')} ${mark} ${label}`, 18, y);
  });
  // 오른쪽: 상세
  const name = DEX_ORDER[dexUI.sel];
  const caught = game.dex.caught.includes(name), seen = game.dex.seen.includes(name);
  ctx.strokeStyle='#222034'; ctx.lineWidth=1; ctx.strokeRect(156,42,148,224);
  if(seen||caught){
    ctx.fillStyle='#eef2da'; ctx.fillRect(186,52,88,88);
    if(caught) ctx.drawImage(SPR[name],0,0,16,16, 198,62,64,64);
    else { ctx.save(); ctx.filter='brightness(0)'; ctx.drawImage(SPR[name],0,0,16,16, 198,62,64,64); ctx.restore(); }
    ctx.fillStyle='#222034'; ctx.font='bold 13px sans-serif';
    ctx.fillText(name, 166, 158);
    ctx.font='11px sans-serif';
    ctx.fillText(`${TYPE_KO[DEX[name].type]} 타입`, 166, 174);
    if(caught) wrapText(DEX[name].desc, 166, 192, 130, 15);
    else ctx.fillText('포획하면 정보가 기록된다.', 166, 192);
  } else {
    ctx.fillStyle='#888'; ctx.font='12px sans-serif';
    ctx.fillText('데이터 없음', 200, 150);
  }
  ctx.fillStyle='#222034'; ctx.font='10px sans-serif';
  ctx.fillText('↑↓ 선택  Z/X 닫기', 166, 258);
}
function drawChooser(){
  if(!chooser.active || chooser.cfg.tag) return;
  const c = chooser, cfg = c.cfg;
  const w = cfg.w || 120;
  const lh = 18;
  const promptH = cfg.prompt ? 20 : 0;
  const h = c.options.length*lh + 14 + promptH;
  const x = cfg.x ?? (VW-w-8), y = cfg.y ?? 8;
  panel(x,y,w,h);
  ctx.fillStyle='#222034'; ctx.font='bold 12px sans-serif';
  if(cfg.prompt) ctx.fillText(cfg.prompt, x+10, y+16);
  c.options.forEach((s,i)=>{
    ctx.fillText(`${i===c.idx?'▶':'  '} ${s}`, x+8, y+16+promptH+i*lh);
  });
}
function drawDialogBox(){
  if(!dialog.active || mode==='battle') return;
  panel(4,VH-66,VW-8,62);
  ctx.fillStyle='#222034'; ctx.font='bold 13px sans-serif';
  wrapText(dialog.text.slice(0,dialog.shown), 16, VH-46, VW-36, 19);
  if(dialog.shown>=dialog.text.length) ctx.fillText('▼', VW-28, VH-12+(Math.floor(clock*3)%2));
}

/* ================= 메인 루프 ================= */
let last = performance.now();
function loop(now){
  const dt = Math.min(0.05,(now-last)/1000); last = now;
  clock += dt;
  banner.t = Math.max(0,banner.t-dt);
  alert_.t = Math.max(0,alert_.t-dt);
  fade.t = Math.max(0,fade.t-dt*3);
  battle.shakeE = Math.max(0,battle.shakeE-dt*3);
  battle.shakeP = Math.max(0,battle.shakeP-dt*3);
  battle.lungeE = Math.max(0,battle.lungeE-dt*4);
  battle.lungeP = Math.max(0,battle.lungeP-dt*4);
  battle.flash = Math.max(0,battle.flash-dt*2);
  if(battle.on) battle.introT = Math.min(1,battle.introT+dt*2.2);
  if(battle.ballAnim) battle.ballAnim.rock = Math.max(0,battle.ballAnim.rock-dt*2.2);
  healFx.t = Math.max(0,healFx.t-dt*1.2);
  // HP/EXP 바 애니메이션
  if(battle.on && battle.enemy){
    battle.dispE += ((battle.enemy.hp/battle.enemy.maxhp)-battle.dispE)*Math.min(1,dt*6);
    const me = activeMon();
    battle.dispP += ((me.hp/me.maxhp)-battle.dispP)*Math.min(1,dt*6);
    battle.dispExp += (expRatio(me)-battle.dispExp)*Math.min(1,dt*4);
  }
  if(mode==='world') updateWorld(dt);
  switch(mode){
    case 'title': drawTitle(); break;
    case 'intro': drawIntro(); break;
    case 'battle': drawBattle(); break;
    case 'evolve': drawEvolve(); break;
    case 'ending': drawEnding(); break;
    case 'dex': drawDex(); break;
    default: drawWorld();
  }
  drawChooser();
  drawDialogBox();
  // 음소거 표시 (모든 화면 공통, 우상단)
  if(!audio.on){
    ctx.fillStyle='rgba(34,32,52,.7)'; ctx.fillRect(VW-26,4,22,16);
    ctx.fillStyle='#fffce8'; ctx.font='10px sans-serif'; ctx.fillText('♪✕', VW-23, 16);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
// 백그라운드 탭에서 rAF가 멈췄을 때도 게임이 최소 10fps로 진행되게 한다
setInterval(()=>{ if(performance.now()-last>200) loop(performance.now()); }, 100);

/* 디버그 핸들 */
window.DBG = {game, battle, dialog, get chooser(){return chooser;}, get mode(){return mode;}, set mode(v){mode=v;},
  makeMon, startBattle, setMap, saveGame, loadGame, newGame, handleKey, evolveScene, MAPS, DEX, audio};
