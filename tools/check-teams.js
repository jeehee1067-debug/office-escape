/* ============================================================
   check-teams.js — 팀 구성 규칙 전수 점검
   ------------------------------------------------------------
     node tools/check-teams.js            1~48명 전부 점검
     node tools/check-teams.js 40          40명일 때만 자세히
     node tools/check-teams.js 14 26       SR3 14 · S1L 26 한 경우만

   admin.js 의 실제 배정 함수(planTeams · planTeamsRelaxed · diagnose)를
   그대로 불러 쓰므로, 코드를 고치면 이 점검 결과도 함께 바뀝니다.

   규칙
     · 한 팀 3명 (되도록) / 부득이하면 4명
     · 3명 팀 = SR3 2+S1L 1  또는  SR3 1+S1L 2
     · 4명 팀 = SR3 2+S1L 2
     → 같은 근무지가 한 팀에 3명 이상 들어가지 않는다
   ============================================================ */
'use strict';
const path = require('path');

/* admin.js 를 그대로 읽어 쓰기 위한 최소 껍데기 */
global.window = {};
global.document = { addEventListener: () => {} };
require(path.join(__dirname, '..', 'assets', 'js', 'data.js'));
const noop = () => {};
window.UI = {
  $: noop, el: noop, esc: (s) => s, modal: noop, toast: noop,
  confirmBox: noop, mmss: noop, SFX: { select: noop }
};
window.GAME = { S: { players: {}, teams: null } };
window.NET = { setTeams: noop, scoreOf: () => ({}) };
require(path.join(__dirname, '..', 'assets', 'js', 'admin.js'));
const { planTeams, planTeamsRelaxed, diagnose } = window.ADMIN;

/** 한 경우(a=SR3, b=S1L)의 결과 */
function judge(a, b) {
  const strict = planTeams(a, b);
  if (strict) return { level: 'ok', plan: strict };
  const relaxed = planTeamsRelaxed(a, b);
  if (relaxed) return { level: 'soft', plan: relaxed, why: diagnose(a, b).msg };
  return { level: 'bad', why: diagnose(a, b).msg, kind: diagnose(a, b).kind };
}
const shape = (p) =>
  [p.x && p.x + '×(2:1)', p.y && p.y + '×(1:2)', p.z && p.z + '×(2:2)',
   p.w && p.w + '×(1:3)', p.v && p.v + '×(3:1)'].filter(Boolean).join(' + ');
const teamsOf = (p) => (p.x || 0) + (p.y || 0) + (p.z || 0) + (p.w || 0) + (p.v || 0);

const args = process.argv.slice(2).map(Number).filter(n => !isNaN(n));

/* ---------- 한 경우만 ---------- */
if (args.length === 2) {
  const [a, b] = args;
  const r = judge(a, b);
  console.log('\nSR3 ' + a + '명 : S1L ' + b + '명  (총 ' + (a + b) + '명)');
  if (r.level === 'ok') console.log('  ✅ 규칙대로 배정됩니다 — ' + teamsOf(r.plan) + '팀 : ' + shape(r.plan));
  else if (r.level === 'soft') console.log('  ⚠️  ' + r.why + '\n     → ' + teamsOf(r.plan) + '팀 : ' + shape(r.plan));
  else console.log('  ❌ ' + r.why);
  console.log('');
  process.exit(0);
}

/* ---------- 인원수 하나 ---------- */
if (args.length === 1) {
  const n = args[0];
  console.log('\n총 ' + n + '명일 때 근무지 구성별 결과\n');
  console.log('  SR3 : S1L   판정');
  console.log('  ' + '-'.repeat(60));
  for (let a = 0; a <= n; a++) {
    const b = n - a, r = judge(a, b);
    const mark = r.level === 'ok' ? '✅' : (r.level === 'soft' ? '⚠️ ' : '❌');
    const tail = r.level === 'bad' ? r.why : teamsOf(r.plan) + '팀 : ' + shape(r.plan);
    console.log('  ' + String(a).padStart(3) + ' : ' + String(b).padEnd(4) + '  ' + mark + ' ' + tail);
  }
  console.log('');
  process.exit(0);
}

/* ---------- 전수 점검 ---------- */
const MAX = 48;
const bad = [], soft = [];
for (let n = 1; n <= MAX; n++) {
  for (let a = 0; a <= n; a++) {
    const b = n - a, r = judge(a, b);
    if (r.level === 'bad') bad.push({ n, a, b, kind: r.kind, why: r.why });
    else if (r.level === 'soft') soft.push({ n, a, b });
  }
}

console.log('\n[1] 1~' + MAX + '명 · 근무지 조합 전수 점검');
console.log('  전체 경우 ' + ((MAX + 1) * (MAX + 2) / 2 - 1) + '가지');
console.log('  ✅ 규칙대로  ' + (((MAX + 1) * (MAX + 2) / 2 - 1) - bad.length - soft.length) + '가지');
console.log('  ⚠️  한 팀만 완화 ' + soft.length + '가지');
console.log('  ❌ 규칙 불가  ' + bad.length + '가지');

console.log('\n[2] ⚠️  3·4명 팀만으로는 딱 한 명이 어긋나는 경우');
console.log('    → 4명 팀 하나를 (1:3) 으로 두어 자동 해결합니다. 나머지 팀은 규칙대로입니다.');
console.log('    많은 쪽 인원이 「적은 쪽 × 2」 에서 딱 1명 모자라거나 남을 때입니다.\n');
soft.forEach(x => console.log('    n=' + String(x.n).padStart(2) + '   SR3 ' +
  String(x.a).padStart(2) + ' : S1L ' + String(x.b).padStart(2)));

console.log('\n[3] ❌ 어떻게 해도 규칙을 지킬 수 없는 경우');
const byKind = {};
bad.forEach(x => (byKind[x.kind] = byKind[x.kind] || []).push(x));
const LABEL = {
  few: '참가자가 3명 미만 — 팀을 만들 수 없음',
  zero: '한쪽 근무지가 0명 — 그 근무지 전용 문제를 아무도 못 품',
  ratio: '한쪽이 다른 쪽의 2배 초과 — 같은 근무지 3명 팀이 생김'
};
Object.keys(byKind).forEach(k => {
  const list = byKind[k];
  console.log('\n  · ' + (LABEL[k] || k) + '  (' + list.length + '가지)');
  const sample = list.slice(0, 10).map(x => x.a + ':' + x.b).join(', ');
  console.log('    예) ' + sample + (list.length > 10 ? ' …' : ''));
});

console.log('\n[4] 실제로 예상되는 인원(30~44명) 점검');
for (let n = 30; n <= 44; n++) {
  const okA = [], softA = [];
  for (let a = 0; a <= n; a++) {
    const r = judge(a, n - a);
    if (r.level === 'ok') okA.push(a); else if (r.level === 'soft') softA.push(a);
  }
  console.log('  ' + String(n).padStart(2) + '명 : SR3 가 ' + okA[0] + '~' + okA[okA.length - 1] +
    '명이면 규칙대로' + (softA.length ? '   (SR3 ' + softA.join('·') + '명 → 4명 팀 하나만 1:3)' : '') +
    '   그 밖은 ❌');
}
console.log('\n  ※ 정리 — 적은 쪽 근무지가 전체의 1/3 이상이면 문제없이 배정됩니다.');
console.log('    많은 쪽이 「적은 쪽 × 2」 에서 1명 모자라거나 남을 때만 4명 팀 하나가 (1:3) 이 되고,');
console.log('    「적은 쪽 × 2 + 2」 이상으로 벌어지면 같은 근무지 3명 팀이 생겨 규칙이 깨집니다.\n');
