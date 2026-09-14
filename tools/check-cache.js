/* ============================================================
   check-cache.js — 캐시 버전 문자열이 밀렸는지 점검
   ------------------------------------------------------------
     node tools/check-cache.js

   index.html 은 스크립트를 `boot.js?v=20260914a` 처럼 불러옵니다.
   이 `?v=` 값이 그대로면 브라우저는 **예전에 받아둔 파일을 계속 씁니다.**
   그래서 js·css 를 고치고 배포해도 참가자 화면에서는 안 바뀝니다.

   이 스크립트는 `?v=` 값을 마지막으로 바꾼 커밋 이후에
   js·css 가 바뀐 게 있으면 알려줍니다. 배포 전에 한 번 돌리세요.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const vers = [...new Set((html.match(/\?v=([A-Za-z0-9._-]+)/g) || []).map(s => s.slice(3)))];
if (!vers.length) { console.log('\n⚠️  index.html 에 ?v= 표시가 없습니다. 캐시가 갱신되지 않습니다.\n'); process.exit(1); }
if (vers.length > 1) {
  console.log('\n⚠️  ?v= 값이 여러 개입니다 — 한 값으로 통일하세요: ' + vers.join(', ') + '\n');
  process.exit(1);
}
const v = vers[0];
console.log('\n현재 캐시 버전  ?v=' + v);

const sh = c => execSync(c, { cwd: root, encoding: 'utf8' }).trim();
let since;
try { since = sh('git log -1 --format=%H -S"v=' + v + '" -- index.html'); } catch (e) { since = ''; }
if (!since) { console.log('  (이 값을 넣은 커밋을 찾지 못했습니다 — 새로 넣은 값 같습니다)\n'); process.exit(0); }

const changed = sh('git diff --name-only ' + since + '..HEAD -- assets/js assets/css')
  .split('\n').filter(Boolean);

if (!changed.length) {
  console.log('  ✅ 이 값을 넣은 뒤로 js·css 가 바뀌지 않았습니다. 그대로 배포해도 됩니다.\n');
  process.exit(0);
}
console.log('\n❌ 이 값을 넣은 뒤로 아래 파일이 바뀌었습니다:');
changed.forEach(f => console.log('     · ' + f));
console.log('\n   참가자 브라우저는 예전 파일을 계속 씁니다.');
console.log('   index.html 의 ?v=' + v + ' 를 오늘 날짜로 바꾸고 다시 배포하세요:');
console.log("     sed -i 's/v=" + v + "/v=" + new Date().toISOString().slice(0, 10).replace(/-/g, '') + "a/g' index.html\n");
process.exit(1);
