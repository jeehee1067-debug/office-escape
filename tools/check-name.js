/* ============================================================
   check-name.js — 이름 글자 수가 화면과 서버에서 같은지 본다
   ------------------------------------------------------------
   접속 화면에서 받아 주는 길이가 서버 규칙보다 길면,
   그 길이의 이름을 적은 참가자는 입장은 되는데 기록이 조용히 거부된다.
   행사 당일에야 드러나는 사고라 여기서 미리 막는다.

     node tools/check-name.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) fail++; };

const html = read('index.html');
const boot = read('assets/js/boot.js');
const rules = read('database.rules.json');

const maxAttr = (html.match(/id="name-input"[^>]*maxlength="(\d+)"/) || [])[1];
const guard = (boot.match(/name\.length > (\d+)/) || [])[1];
const server = [...rules.matchAll(/name'?"?\)?[^}]*?length <= (\d+)/g)].map(m => +m[1]);

console.log('\n[이름 글자 수 — 화면 ↔ 서버]');
ok(!!maxAttr, '접속 칸 maxlength = ' + maxAttr);
ok(!!guard, 'boot.js 검사 = ' + guard + '자');
ok(server.length > 0, 'database.rules.json 검사 = ' + server.join(', ') + '자 (' + server.length + '곳)');

const srvMin = Math.min.apply(null, server.length ? server : [0]);
ok(+maxAttr === +guard, '접속 칸과 boot.js 가 같은 값');
ok(+guard <= srvMin, 'boot.js(' + guard + ') ≤ 서버 규칙(' + srvMin + ') — 서버가 거부할 길이를 받지 않는다');
ok(new Set(server).size === 1, '서버 규칙 안에서도 값이 하나로 통일 (' + [...new Set(server)].join(', ') + ')');

/* 실제로 쓸 이름이 들어가는지 */
console.log('\n[「파트_이름99」 가 들어가는가]');
['EFA1_김도현98', 'VSEM_남궁민수98', 'EFA1_황보지희98', 'PFA_김재현98'].forEach(n => {
  ok(n.length <= srvMin, n + ' — ' + n.length + '자');
});

console.log(fail ? '\n❌ 어긋난 항목 ' + fail + '개\n' : '\n✅ 화면과 서버가 같은 길이를 씁니다.\n');
process.exit(fail ? 1 : 0);
