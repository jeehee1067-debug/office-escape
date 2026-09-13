/* ============================================================
   check-spots.js — 방 안 클릭 영역 점검
   ------------------------------------------------------------
     node tools/check-spots.js

   · 단서 / 기믹 선택 칸 / 소품 / 낚시 / 자료 자리를 모두 모아
     ① 화면(0~100%) 밖으로 나가지 않는지
     ② 손가락으로 누르기 힘들 만큼 작지 않은지 (3% × 2.5% 이상)
     ③ 서로 겹쳐서 엉뚱한 게 눌리지 않는지 (작은 쪽 넓이의 12% 초과)
     를 확인합니다.

   배경 그림과 실제로 맞는지는 scratchpad/align.js 로 겹쳐 그려 확인합니다.
   ============================================================ */
'use strict';
global.window={}; global.document={addEventListener(){}};
require(require('path').join(__dirname,'..','assets','js','data.js'));
const R=window.DATA.ROOMS;
const bad=[];
for(const k of Object.keys(R)){
  const r=R[k], list=[];
  r.clues.forEach(c=>{ list.push([c.label,c.at]);
    if(c.gate&&c.gate.at) list.push([c.label+'(소품)',c.gate.at]);
    if(c.gate&&c.gate.spots) c.gate.spots.forEach((s,i)=>list.push([c.label+'#'+(i+1),s]));
  });
  (r.traps||[]).forEach(t=>list.push([t.label,t.at]));
  (r.hints||[]).forEach(t=>list.push([t.label,t.at]));
  list.forEach(([n,a])=>{
    if(a[0]<0||a[1]<0||a[0]+a[2]>100.01||a[1]+a[3]>100.01) bad.push(k+' '+n+' 화면 밖 '+JSON.stringify(a));
    if(a[2]<3||a[3]<2.5) bad.push(k+' '+n+' 너무 작음 '+JSON.stringify(a));
  });
  for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
    const [n1,a]=list[i],[n2,b]=list[j];
    if(n1.split('(')[0]===n2.split('(')[0]||n1.split('#')[0]===n2.split('#')[0]) continue;
    const ox=Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0]);
    const oy=Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]);
    if(ox>0&&oy>0){ const ar=ox*oy, mn=Math.min(a[2]*a[3],b[2]*b[3]);
      if(ar/mn>0.12) bad.push(k+'관 겹침 '+n1+' × '+n2+' ('+(ar/mn*100).toFixed(0)+'%)'); }
  }
  console.log(k+'관 클릭 영역 '+list.length+'개');
}
console.log(bad.length? '\n⚠️\n'+bad.join('\n') : '\n✅ 화면 밖·과도한 겹침 없음');
