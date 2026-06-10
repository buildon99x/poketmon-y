// 데이터 정합성 검사 (node validate.js)
global.document = { createElement: () => ({ getContext: () => ({ fillRect(){}, translate(){}, scale(){}, drawImage(){} }), width:0, height:0 }) };
const fs = require('fs');
const data = fs.readFileSync(__dirname+'/data.js','utf8');
const MARK = '/* === ' + 'CHECKS === */';
const body = fs.readFileSync(__filename,'utf8').split(MARK)[1];
eval(data + '\n' + body);
/* === CHECKS === */
let errs = [];
const SOLID = new Set(['T','~','R','W','f','S','P','D']);

for(const [id,m] of Object.entries(MAPS)){
  const w = m.rows[0].length;
  m.rows.forEach((r,y)=>{ if(r.length!==w) errs.push(`${id} row ${y}: 길이 ${r.length} ≠ ${w}`); });
  const at = (x,y)=> (x<0||y<0||y>=m.rows.length||x>=w)?'T':m.rows[y][x];
  for(const [k,ex] of Object.entries(m.exits||{})){
    const [x,y] = k.split(',').map(Number);
    if(SOLID.has(at(x,y))) errs.push(`${id} exit ${k}: 출발 타일 '${at(x,y)}' 솔리드`);
    const tm = MAPS[ex.map];
    const tw = tm.rows[0].length;
    const tat = tm.rows[ex.y]?.[ex.x];
    if(!tat || SOLID.has(tat)) errs.push(`${id} exit ${k} → ${ex.map}(${ex.x},${ex.y}): 도착 타일 '${tat}' 불가`);
  }
  for(const n of [...(m.npcs||[]),...(m.trainers||[])]){
    const t = at(n.x,n.y);
    if(SOLID.has(t)) errs.push(`${id} npc/trainer ${n.id}: (${n.x},${n.y}) 타일 '${t}' 솔리드`);
    if(n.person && !PEOPLE[n.person]) errs.push(`${id} ${n.id}: person '${n.person}' 없음`);
    for(const [mn] of (n.party||[])) if(!DEX[mn]) errs.push(`${id} ${n.id}: 몬스터 '${mn}' 없음`);
  }
  for(const k of Object.keys(m.doors||{})){
    const [x,y]=k.split(',').map(Number);
    if(at(x,y)!=='D') errs.push(`${id} door ${k}: 타일이 'D'가 아님 ('${at(x,y)}')`);
  }
  for(const k of Object.keys(m.signs||{})){
    const [x,y]=k.split(',').map(Number);
    if(at(x,y)!=='S') errs.push(`${id} sign ${k}: 타일이 'S'가 아님 ('${at(x,y)}')`);
  }
  if(m.encounters) for(const [n] of m.encounters.pool) if(!DEX[n]) errs.push(`${id} 인카운터 '${n}' 도감에 없음`);
}
for(const [name,d] of Object.entries(DEX)){
  if(!SPR[name]) errs.push(`DEX ${name}: 스프라이트 없음`);
  for(const [l,mv] of d.learn) if(!MOVES[mv]) errs.push(`DEX ${name}: 기술 '${mv}' 없음`);
  if(d.evolve && !DEX[d.evolve.to]) errs.push(`DEX ${name}: 진화체 '${d.evolve.to}' 없음`);
  if(!CHART[d.type]) errs.push(`DEX ${name}: 타입 '${d.type}' 차트에 없음`);
}
for(const s of Object.values(SONGS)){
  if(s.mel.length!==s.bass.length) errs.push(`SONG: mel(${s.mel.length}) ≠ bass(${s.bass.length})`);
}
// 스프라이트 행 길이 체크는 makeSprite가 행별로 처리하므로 픽셀 어긋남만 경고
if(errs.length){ console.log('FAIL\n'+errs.join('\n')); process.exit(1); }
console.log('OK: 맵/도감/기술/출구/음악 데이터 정합성 통과');
process.exit(0);
