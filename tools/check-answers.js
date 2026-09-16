/* ============================================================
   check-answers.js — 「정답을 실제로 입력할 수 있는가」 점검
   ------------------------------------------------------------
   check-bank.js 는 자료(DOCS)와 정답(ans)이 맞는지만 봅니다.
   이 도구는 그 정답을 참가자가 위젯에서 정말 만들어 낼 수 있는지,
   그리고 오답 처리될 여지가 없는지를 봅니다.

     node tools/check-answers.js

   1) multi  : 칸 길이 합 = 정답 길이인가
   2) multi  : 앞자리가 0 인 칸이 있는가 (5 를 05 로 적어야 하는 함정)
   3) lock   : digits = 정답 자릿수이고 숫자만인가
   4) grid   : 정답이 실제 칸 이름(행+열)인가
   5) order  : items 와 order 가 같은 집합인가 · 다른 순서와 헷갈리지 않는가
   6) short  : 정답이 비어 있지 않고, 띄어쓰기·대소문자만 다른 중복이 없는가
   7) 공통    : q·hint·ok 가 있고, 한 방 안에서 정답이 겹치지 않는가
   ============================================================ */
'use strict';
const path = require('path');

global.window = {};
global.document = { addEventListener: () => {} };
require(path.join(__dirname, '..', 'assets', 'js', 'data.js'));

const { CONFIG, BANK } = window.DATA;

let fail = 0, warn = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) fail++; };
const note = msg => { console.log('  ⚠️  ' + msg); warn++; };

/* game.js 의 norm() 과 같은 규칙 */
const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, '');
/* quizkit.js 가 만들어 내는 제출값 */
const answersOf = q => (q.type === 'order' ? [(q.order || []).join('')] : (q.ans || []));

/* quizkit.js 가 숫자 칸의 앞자리 0 을 채워 주는지 (regression guard) */
const PADS = /padSlot[\s\S]{0,400}padStart/.test(
  require('fs').readFileSync(path.join(__dirname, '..', 'assets', 'js', 'quizkit.js'), 'utf8'));

const all = [];
for (let r = 1; r <= CONFIG.ROOM_COUNT; r++) (BANK[r] || []).forEach(q => all.push({ r, q }));

/* ---------- 1~2) 여러 칸 입력 ---------- */
console.log('\n[1] 여러 칸 입력(multi) — 칸 길이와 정답 길이');
all.filter(x => x.q.type === 'multi').forEach(({ q }) => {
  const slots = q.slots || [];
  const sum = slots.reduce((a, s) => a + (s.len || 4), 0);
  const ans = (q.ans || [])[0] || '';
  ok(sum === ans.length,
    q.id + ' : 칸 ' + slots.map(s => s.len).join('+') + ' = ' + sum + '자 / 정답 "' + ans + '" ' + ans.length + '자');

  /* 각 칸에 들어갈 조각을 잘라 앞자리 0 함정을 찾는다 */
  let at = 0;
  slots.forEach(s => {
    const piece = ans.slice(at, at + (s.len || 4)); at += (s.len || 4);
    if (/^0\d/.test(piece)) {
      ok(PADS, q.id + ' 「' + s.label + '」 칸은 "' + piece + '" — "' +
        piece.replace(/^0+/, '') + '" 로 적어도 앞자리 0 을 채워 정답 처리' +
        (PADS ? '' : ' ← quizkit.js 의 padSlot 이 사라졌습니다'));
    }
  });
});

/* ---------- 3) 다이얼 ---------- */
console.log('\n[2] 다이얼(lock) — 자릿수');
all.filter(x => x.q.type === 'lock').forEach(({ q }) => {
  const ans = (q.ans || [])[0] || '';
  ok(/^\d+$/.test(ans) && ans.length === (q.digits || 4),
    q.id + ' : digits ' + q.digits + ' / 정답 "' + ans + '"');
});

/* ---------- 4) 배치도 ---------- */
console.log('\n[3] 배치도(grid) — 정답이 실제 칸인가');
all.filter(x => x.q.type === 'grid').forEach(({ q }) => {
  const cells = [];
  (q.gridRows || []).forEach(r => (q.gridCols || []).forEach(c => cells.push(r + c)));
  ok(cells.indexOf((q.ans || [])[0]) >= 0,
    q.id + ' : 정답 "' + (q.ans || [])[0] + '" 가 ' + cells.length + '칸 안에 있음');
});

/* ---------- 5) 순서 배열 ---------- */
console.log('\n[4] 순서 배열(order) — 항목과 정답');
all.filter(x => x.q.type === 'order').forEach(({ q }) => {
  const items = (q.items || q.order || []).slice().sort();
  const order = (q.order || []).slice().sort();
  ok(items.length === order.length && items.every((v, i) => v === order[i]),
    q.id + ' : 보여주는 항목과 정답 항목이 같음 [' + (q.items || []).join(', ') + ']');

  /* 이어 붙인 문자열이 다른 순서와 겹치면 엉뚱한 배열도 정답이 된다 */
  const target = (q.order || []).join('');
  const seen = new Set();
  const perm = (arr, cur) => {
    if (!arr.length) { seen.add(cur.join('')); return; }
    arr.forEach((v, i) => perm(arr.slice(0, i).concat(arr.slice(i + 1)), cur.concat(v)));
  };
  perm(q.order || [], []);
  const dup = [...seen].filter(s => s === target).length;
  ok(dup === 1 && seen.size === factorial((q.order || []).length),
    q.id + ' : 순서가 다르면 제출값도 달라짐 (' + seen.size + '가지)');
});
function factorial(n) { return n <= 1 ? 1 : n * factorial(n - 1); }

/* ---------- 6) 주관식 ---------- */
console.log('\n[5] 주관식(short) — 정답 목록');
all.filter(x => x.q.type === 'short' || !x.q.type).forEach(({ q }) => {
  const list = q.ans || [];
  ok(list.length > 0 && list.every(a => String(a).trim()), q.id + ' : 정답 ' + list.length + '개 [' + list.join(' / ') + ']');
  const normed = list.map(norm);
  const dups = normed.filter((v, i) => normed.indexOf(v) !== i);
  if (dups.length) note(q.id + ' : 띄어쓰기·대소문자만 다른 중복 정답이 있습니다 (' + [...new Set(dups)].join(', ') + ') — 지워도 됩니다');
});

/* ---------- 7) 공통 ---------- */
console.log('\n[6] 공통 — 문장·힌트·정답 겹침');
all.forEach(({ q }) => {
  if (!q.q || !String(q.q).trim()) ok(false, q.id + ' : 문제 문장이 비어 있음');
  if (!q.hint) note(q.id + ' : 힌트가 없습니다');
  if (!q.ok) note(q.id + ' : 정답 연출 문구(ok)가 없습니다');
});

for (let r = 1; r <= CONFIG.ROOM_COUNT; r++) {
  const bank = BANK[r] || [];
  const map = {};
  bank.forEach(q => answersOf(q).forEach(a => {
    const k = norm(a);
    (map[k] = map[k] || []).push(q.id);
  }));
  const clash = Object.entries(map).filter(([, ids]) => new Set(ids).size > 1);
  /* both:true 로 둔 쌍(같은 문제를 두 사이트에 두는 경우)은 겹쳐도 된다. 지금은 쓰는 곳이 없다 */
  const real = clash.filter(([, ids]) => !(ids.length === 2 && ids.every(i => /^r\dsr3$|^r\ds1l$/.test(i))
    && bank.find(q => q.id === ids[0]).both));
  ok(real.length === 0, r + '관 : 서로 다른 문제끼리 정답이 겹치지 않음' +
    (real.length ? ' — ' + real.map(([a, ids]) => '"' + a + '" ' + ids.join('·')).join(', ') : ''));
}

console.log(fail ? '\n❌ 고쳐야 할 항목 ' + fail + '개\n'
  : warn ? '\n✅ 막히는 곳은 없습니다. ⚠️ 표시 ' + warn + '개는 확인해 보세요.\n'
    : '\n✅ 모든 문제를 화면에서 정답대로 입력할 수 있습니다.\n');
process.exit(fail ? 1 : 0);
