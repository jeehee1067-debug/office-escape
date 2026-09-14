/* ============================================================
   print-rules.js — Firebase 규칙 탭에 붙여넣을 내용을 그대로 출력
   ------------------------------------------------------------
     node tools/print-rules.js            화면에 출력 (복사해서 붙여넣기)
     node tools/print-rules.js > rules.txt  파일로 저장

   database.rules.json 은 순수 JSON 이라 파일을 그대로 붙여넣어도 됩니다.
   이 도구는 같은 내용을 보기 좋게 출력하고, 들어 있는 경로를 확인해 줍니다.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'database.rules.json');
const src = JSON.parse(fs.readFileSync(file, 'utf8'));

if (!src.rules) {
  console.error('database.rules.json 에 "rules" 가 없습니다.');
  process.exit(1);
}

const out = JSON.stringify({ rules: src.rules }, null, 2);

if (process.stdout.isTTY) {
  console.error('─── 아래 내용을 Firebase 콘솔 → Realtime Database → 규칙 탭에 붙여넣고 [게시] ───\n');
}
console.log(out);
if (process.stdout.isTTY) {
  const paths = Object.keys(src.rules.v2 || {});
  console.error('\n─── 규칙에 들어 있는 경로: ' + paths.join(', ') + ' ───');
  console.error('※ chat 이 없으면 채팅이 막힙니다. 게시 후 참가자는 새로고침해야 합니다.');
}
