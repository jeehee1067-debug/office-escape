/* ============================================================
   check-bank.js — 문제은행 자가 점검 도구
   ------------------------------------------------------------
   자료(DOCS)를 고친 뒤 정답(ans)이 어긋나지 않았는지 확인합니다.

     node tools/check-bank.js

   1) 방마다 구성이 맞는지            (SR3 1 · S1L 1 · 고난도 2 · 일반 2)
   2) 자료 참조가 실제로 있는지        (q.docs → DOCS)
   3) 크레도 문제 정답이 만들어지는지  (CREDO.lines)
   4) 고난도 문제의 정답을 자료에서 다시 계산해 ans 와 비교
      → 계획표·좌석표를 고치면 여기서 바로 어긋난 곳을 알려줍니다.
   ============================================================ */
'use strict';
const path = require('path');

global.window = {};
global.document = { addEventListener: () => {} };
require(path.join(__dirname, '..', 'assets', 'js', 'data.js'));

const { CONFIG, BANK, DOCS, credoAnswers } = window.DATA;
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) fail++; };
const eq = (id, got, want) => ok(String(got) === String(want), id + '  자료로 계산 = ' + got + '  /  ans = ' + want);
const q = (r, id) => (BANK[r] || []).find(x => x.id === id);

/* ---------- 1~3) 구성 · 자료 참조 · 크레도 ---------- */
console.log('\n[1] 방별 구성');
for (let r = 1; r <= CONFIG.ROOM_COUNT; r++) {
  const bank = BANK[r] || [];
  const n = k => bank.filter(k).length;
  const sr3 = n(x => x.loc === 'SR3'), s1l = n(x => x.loc === 'S1L');
  const hard = n(x => !x.loc && x.tier === 'hard'), easy = n(x => !x.loc && x.tier !== 'hard');
  ok(sr3 >= 1 && s1l >= 1 && hard >= 1 && easy >= 1,
    r + '관 : 총 ' + bank.length + '문제 (SR3 ' + sr3 + ' · S1L ' + s1l + ' · 고난도 ' + hard + ' · 일반 ' + easy + ')');
  const ids = new Set(bank.map(x => x.id));
  if (ids.size !== bank.length) ok(false, r + '관 : 문제 id 가 겹칩니다');
}

console.log('\n[2] 자료 참조 · 정답 존재');
for (let r = 1; r <= CONFIG.ROOM_COUNT; r++) {
  (BANK[r] || []).forEach(x => {
    (x.docs || []).forEach(d => ok(!!DOCS[d], x.id + ' → 자료 ' + d));
    if (x.credo) ok(credoAnswers(x.credo).length > 0, x.id + ' 크레도 정답 = ' + credoAnswers(x.credo)[0]);
    else if (x.type !== 'order' && x.type !== 'choice') ok(!!(x.ans && x.ans.length), x.id + ' 정답 있음');
  });
}

/* ---------- 4) 고난도 문제 정답 재계산 ---------- */
console.log('\n[3] 고난도 문제 — 자료에서 정답 다시 계산');
const pad = v => String(v).padStart(2, '0');

// 1관 : 당직 배정표 + 좌석 배치도
const shift = DOCS.d1_shift, seat = DOCS.d1_seat;
const nightOf = d => (shift.rows.find(r => r[0] === d) || [])[2];
const seatOf = name => Object.entries(seat.cells).find(([, c]) => c.name === name) || ['??', { no: '??' }];
const today = (shift.uv[0].text.match(/오늘은 (.)요일/) || [])[1];
const [todaySeat, todayCell] = seatOf(nightOf(today));
eq('r1h1', todaySeat + todayCell.no, q(1, 'r1h1').ans[0]);
eq('r1h2', seatOf(nightOf('월'))[1].no + seatOf(nightOf('금'))[1].no, q(1, 'r1h2').ans[0]);

// 2관 : 예약 대장 (UV 로 취소 표시)
const book = DOCS.d2_book;
const first = book.rows[0];
eq('r2h1', first[0].slice(0, 2) + pad(first[3]), q(2, 'r2h1').ans[0]);
const cancelled = (book.uv[0].text.match(/^([0-9:]+)/) || [])[1];
const alive = book.rows.filter(r => r[0] !== cancelled);
const last = alive[alive.length - 1];
eq('r2h2', last[0].slice(0, 2) + pad(last[3]), q(2, 'r2h2').ans[0]);

// 3관 : 기동 수칙 + 점검 기록부 + 라벨 대장 + 트레이
const log = DOCS.d3_log, lastLog = log.rows[log.rows.length - 1];
const base = ['배기', '냉각수', '진공', '전원'];
eq('r3h1', (lastLog[3] === '재점검' ? base.filter(x => x !== '진공').concat('진공') : base).join(''),
  q(3, 'r3h1').order.join(''));
const person = (log.rows.filter(r => r[3] === '재점검').pop() || [])[2];
const spec = (DOCS.d3_tag.items.find(i => i.v.indexOf(person) >= 0) || {}).k;
const cell = (Object.entries(DOCS.d3_tray.cells).find(([, c]) => c.name === spec) || ['??'])[0];
eq('r3h2', cell, q(3, 'r3h2').ans[0]);

// 4관 : 계획표(UV 추가 작업) + 색상 코드표
const plan = DOCS.d4_plan;
const color = k => (DOCS.d4_color.items.find(i => i.k === k) || {}).v;
const uvParts = plan.uv[0].text.split('—').map(s => s.trim());
eq('r4h1', uvParts[0].split(':')[0] + color(uvParts[2]), q(4, 'r4h1').ans[0]);
const at = h => plan.rows.find(r => r[0].indexOf(h) === 0) || [];
eq('r4h2', color(at('00')[3]) + color(at('02')[3]), q(4, 'r4h2').ans[0]);

console.log(fail ? '\n❌ 어긋난 항목 ' + fail + '개 — 위 ❌ 줄을 확인하세요.\n'
  : '\n✅ 문제은행과 자료가 모두 맞아떨어집니다.\n');
process.exit(fail ? 1 : 0);
