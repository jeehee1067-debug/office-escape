# S1FA 방탈출 — 작업 규칙

사내 행사용 웹 게임입니다. 빌드 과정이 없는 바닐라 JS + GitHub Pages + Firebase RTDB.

## ⛔ 작업을 시작하기 전에 반드시 (가장 중요)

이 저장소에서 실제로 사고가 난 원인은 전부 **여러 브랜치가 같은 파일을 따로 고친 것**이었습니다.
새 작업을 시작하기 전에 **항상** 먼저:

```bash
git fetch origin main
git merge origin/main          # 앞에 것(main) 위에 내 작업을 올린다
```

브랜치가 main 보다 뒤처진 채로 작업하지 마세요. 뒤처진 상태에서 고치면
나중에 합칠 때 **글자는 안 겹치는데 뜻이 어긋나는** 사고가 납니다.

### 실제로 났던 사고 — 글자는 안 겹쳤는데 뜻이 어긋난 경우

| 무슨 일 | 결과 |
|---|---|
| A 브랜치가 `points = 배점 + 속도점수` 로 바꿈 | |
| B 브랜치가 서버 규칙에 `points === 배점` 을 넣음 | |
| 두 브랜치가 각각 main 에 들어감. **git 충돌은 안 남** | 정답 기록이 전부 거부 → 점수·단서 표시·다음 방 버튼·기믹이 한꺼번에 멈춤 |

**main 을 합친 뒤에는 충돌 해결만 하지 말고, main 쪽에서 새로 들어온 코드가
내 변경과 뜻이 맞는지 직접 읽어서 확인하세요.** 특히 `database.rules.json` ↔ `game.js`/`net.js`.

## 배포 전에 돌릴 것

```bash
node tools/check-all.js
```

한 번에 다 돌립니다. 개별로는:

| 명령 | 무엇을 보나 |
|---|---|
| `node tools/check-bank.js` | 문제 정답을 자료에서 다시 계산해 대조 |
| `node tools/check-answers.js` | 그 정답을 화면에서 입력할 수 있는지 (앞자리 0 등) |
| `node tools/check-name.js` | 이름 글자 수가 접속 화면과 서버 규칙에서 같은지 |
| `node tools/check-spots.js` | 방 안 클릭 영역이 화면 밖으로 나가거나 겹치는지 |
| `node tools/check-teams.js` | 1~48명 모든 근무지 조합에서 팀이 짜이는지 |
| `node tools/check-cache.js` | `index.html` 의 `?v=` 를 올려야 하는지 |
| `node tools/print-rules.js` | Firebase 콘솔에 붙여넣을 규칙 출력 |

## 자주 발목 잡히는 것 세 가지

1. **캐시** — js·css 를 고쳤으면 `index.html` 의 `?v=` 를 **반드시** 올리세요.
   안 올리면 참가자 브라우저가 예전 파일을 계속 씁니다. `check-cache.js` 가 잡아 줍니다.

2. **서버 규칙** — 정답 기록의 `points` 는 서버 배점표(`bank/scores`)와 **정확히** 같아야
   통과합니다. 속도 점수는 `points` 에 더하지 말고 `speed` 로 따로 적으세요.
   배점을 바꿨으면 관리자로 다시 로그인해 배점표를 다시 올려야 합니다
   (관리자 패널 → 🧪 행사 준비 점검 에서 확인).

3. **오프라인 테스트의 한계** — 로컬 테스트는 `assets/js/fallback-db.js` 로 도는데
   **거기엔 서버 규칙이 없습니다.** 그래서 규칙 위반은 로컬에서 안 걸립니다.
   `scratchpad/e2e.js` 의 `[F] 서버 규칙 대조` 가 그 구멍을 메우고 있으니,
   기록하는 값의 모양을 바꾸면 그 검사도 함께 고치세요.

## 코드 구조

`window` 에 붙는 IIFE 모듈들. 빌드 없음, `index.html` 에서 순서대로 불러옵니다.

| 파일 | 맡은 것 |
|---|---|
| `data.js` | CONFIG · 크레도 · 자료(DOCS) · 문제은행(BANK) · 방 구성(ROOMS) — **운영자가 고칠 곳 대부분** |
| `game.js` | 진행·점수·HUD·순위표·방 렌더 |
| `net.js` | Firebase 입출력 (`PX` 아님 주의: 픽셀 모듈은 `window.PX`) |
| `boot.js` | 로그인·세션 복구·근무지 잠금 |
| `admin.js` | 관리자 패널·팀 배정·행사 준비 점검 |
| `quizkit.js` `puzzles.js` | 문제 위젯 · 기믹 |

방 안 클릭 영역은 `ROOMS[n]` 의 `at: [왼쪽%, 위%, 너비%, 높이%]` — 배경 그림 기준 백분율입니다.
