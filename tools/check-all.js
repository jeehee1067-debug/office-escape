/* ============================================================
   check-all.js — 배포 전 한 번에 점검
   ------------------------------------------------------------
     node tools/check-all.js

   · 브랜치가 main 보다 뒤처졌는지  (사고의 대부분이 여기서 시작합니다)
   · 모든 js 파일 문법
   · 문제은행 ↔ 자료 정답 대조
   · 방 안 클릭 영역
   · 팀 구성 전수 점검
   · 캐시 버전(?v=) 을 올려야 하는지
   · 서버 규칙 파일이 유효한 JSON 인지

   하나라도 어긋나면 종료 코드 1 로 끝납니다.
   (실제 플레이 점검은 scratchpad/e2e.js — 브라우저가 필요합니다)
   ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
let failed = 0;
const line = () => console.log('─'.repeat(58));

function step(name, fn) {
  process.stdout.write('▸ ' + name + '\n');
  try {
    const out = fn();
    if (out) console.log(String(out).split('\n').map(l => '    ' + l).join('\n'));
  } catch (e) {
    failed++;
    const msg = (e && e.stdoutText) || (e && e.message) || String(e);
    console.log(String(msg).split('\n').map(l => '    ' + l).join('\n'));
    console.log('    ❌ ' + name + ' 실패');
  }
  console.log('');
}

function run(cmd) {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: root, encoding: 'utf8' });
  const text = ((r.stdout || '') + (r.stderr || '')).trim();
  if (r.status !== 0) { const e = new Error(text); e.stdoutText = text; throw e; }
  return text;
}

line();
console.log(' S1FA 방탈출 — 배포 전 점검');
line();
console.log('');

/* 1. 브랜치가 main 보다 뒤처졌나 — 여기서 걸리면 먼저 합치고 다시 돌리세요 */
step('브랜치가 main 과 맞춰져 있는가', () => {
  let behind;
  try {
    execSync('git fetch origin main --quiet', { cwd: root, stdio: 'ignore' });
    behind = execSync('git rev-list --count HEAD..origin/main', { cwd: root, encoding: 'utf8' }).trim();
  } catch (e) { return '⚠️  원격을 확인할 수 없습니다 (오프라인일 수 있음) — 건너뜁니다'; }
  if (Number(behind) > 0) {
    const e = new Error('main 보다 ' + behind + '개 커밋 뒤처져 있습니다.\n' +
      '먼저 합치세요:  git fetch origin main && git merge origin/main\n' +
      '뒤처진 채로 고치면 글자는 안 겹치는데 뜻이 어긋나는 사고가 납니다.');
    e.stdoutText = e.message; throw e;
  }
  return '✅ main 의 모든 커밋을 담고 있습니다';
});

/* 2. 문법 */
step('js 문법', () => {
  const dir = path.join(root, 'assets', 'js');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  files.forEach(f => run(['node', '--check', path.join(dir, f)]));
  return '✅ ' + files.length + '개 파일 모두 통과';
});

/* 3~6. 개별 점검 도구 */
step('문제은행 ↔ 자료 정답 대조', () => run(['node', path.join(__dirname, 'check-bank.js')]).split('\n').slice(-1)[0]);
step('이름 글자 수 (화면↔서버)', () => run(['node', path.join(__dirname, 'check-name.js')]).split('\n').filter(Boolean).slice(-1)[0]);
step('정답 입력 가능 여부', () => run(['node', path.join(__dirname, 'check-answers.js')]).split('\n').filter(Boolean).slice(-1)[0]);
step('방 안 클릭 영역', () => run(['node', path.join(__dirname, 'check-spots.js')]).split('\n').filter(Boolean).slice(-1)[0]);
step('팀 구성 전수 점검', () => { run(['node', path.join(__dirname, 'check-teams.js')]); return '✅ 1~48명 모든 조합 통과'; });
step('캐시 버전(?v=)', () => run(['node', path.join(__dirname, 'check-cache.js')]).split('\n').filter(Boolean).slice(-1)[0]);

/* 7. 서버 규칙 파일 */
step('서버 규칙 파일', () => {
  const p = path.join(root, 'database.rules.json');
  JSON.parse(fs.readFileSync(p, 'utf8'));
  return '✅ 유효한 JSON — 콘솔에 붙여넣을 내용은 node tools/print-rules.js';
});

line();
if (failed) {
  console.log(' ❌ ' + failed + '개 항목이 어긋났습니다. 위 내용을 확인하세요.');
  line();
  process.exit(1);
}
console.log(' ✅ 모두 통과. 실제 플레이 점검도 하려면:');
console.log('    python3 -m http.server 8125 &  →  node scratchpad/e2e.js');
line();
