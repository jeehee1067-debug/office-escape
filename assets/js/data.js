/* ============================================================
   data.js — 게임 설정 / 캐릭터 / 방 구성 / 문제은행
   ※ 운영자가 수정할 부분은 대부분 이 파일 안에 있습니다.
   ============================================================ */
(function (g) {
  'use strict';

  /* ---------------- 기본 설정 ---------------- */
  const CONFIG = {
    ADMIN_PASSWORD: '00',      // ★ 관리자 비밀번호 (원하는 값으로 변경하세요)
    ROOM_SECONDS: 300,         // 방 하나당 제한시간(초) = 5분
    ROOM_COUNT: 4,             // 방 개수 → 총 20분
    CLUES_PER_ROOM: 3,         // 방마다 풀어야 하는 문제 수
    BANK_PER_ROOM: 5,          // 방마다 준비된 문제 수(여기서 3개가 랜덤 출제)
    WRONG_PENALTY: 1500,       // 오답 감점
    TRAP_PENALTY: 500,         // 함정(낚시)에 걸렸을 때 감점
    TIME_BONUS_MAX: 3000,      // 방을 빨리 깰수록 받는 최대 보너스
    DB_ROOT: 'v2'              // Firebase 데이터 루트
  };

  /* ---------------- 플레이어 캐릭터 8종 ---------------- */
  const AVATARS = [
    { id: 0, name: '지훈', style: 'short',    hair: '#2e2118', top: '#4f7fd4', pants: '#2f3a52', eye: '#4d6b96' },
    { id: 1, name: '진아', style: 'bob',      hair: '#5c3a22', top: '#f6f6f2', pants: '#2b3350', skirt: true, eye: '#7d6a52' },
    { id: 2, name: '민수', style: 'short',    hair: '#1f1a14', top: '#2e8b4f', pants: '#3a4152', glasses: true, eye: '#4a5f7d' },
    { id: 3, name: '수빈', style: 'ponytail', hair: '#8a5a2b', top: '#f2a7c4', pants: '#46506a', skirt: true, eye: '#8a6a4a' },
    { id: 4, name: '도윤', style: 'spiky',    hair: '#22304f', top: '#e8b83b', pants: '#2f3a52', eye: '#4d6b96' },
    { id: 5, name: '하늘', style: 'long',     hair: '#3a2418', top: '#7b5ea7', pants: '#2b2f3a', skirt: true, eye: '#6b5f8c' },
    { id: 6, name: '태오', style: 'cap',      hair: '#241a12', cap: '#c0392b', top: '#e2e8ee', pants: '#3d6ea8', eye: '#4a5f7d' },
    { id: 7, name: '유나', style: 'bun',      hair: '#4a2f1e', top: '#3d6ea8', pants: '#7d8792', skirt: true, eye: '#7f6a58' }
  ];

  /* ---------------- 각 방의 파트장님(NPC) ---------------- */
  const BOSSES = {
    1: { name: '김주헌 파트장님', style: 'short', hair: '#1b1610', top: '#3d6ea8', pants: '#2b2f3a', tie: '#c0392b', badge: '#3d6ea8', eye: '#3f5a7d' },
    2: { name: '김진석 파트장님', style: 'short', hair: '#20242e', top: '#2e8b4f', pants: '#2f3a52', glasses: true, badge: '#2e8b4f', eye: '#4a5f7d' },
    3: { name: '윤지혜 파트장님', style: 'long',  hair: '#3a2418', top: '#e8e8e4', pants: '#4a5568', coat: true, badge: '#7b5ea7', eye: '#7d6a52' },
    4: { name: '손승준 PL님',     style: 'short', hair: '#141821', top: '#262b38', pants: '#20242e', tie: '#e8b83b', badge: '#e8b83b', eye: '#3f5a7d' }
  };

  /* ============================================================
     문제은행 — 방마다 5문제, 팀 시드로 3문제가 랜덤 출제됩니다.
     type: 'choice'(객관식) | 'short'(주관식)
     ============================================================ */
  const BANK = {
    1: [
      { id: 'r1q1', type: 'choice', score: 6000, q: '이석(자리 비움) 시 올바른 보안 조치는?',
        choices: ['모니터 전원만 끈다', '화면 잠금(Win + L)을 실행한다', '메모지에 비밀번호를 붙여둔다', '그냥 자리를 뜬다'], ans: 1,
        ok: '역시! 보안은 습관이지.' },
      { id: 'r1q2', type: 'choice', score: 6000, q: '분리수거함에서 노란색 통에 버려야 하는 것은?',
        choices: ['일반쓰레기', '플라스틱', '종이류', '음식물'], ans: 1,
        ok: '덕분에 분리수거 완벽!' },
      { id: 'r1q3', type: 'short',  score: 7000, q: 'EFA1 셀 책상 위에 놓인 모니터는 모두 몇 대일까?',
        hint: '화면에 보이는 모니터를 세어보세요 (숫자만)', ans: ['3', '3개', '세대', '3대'],
        ok: '눈썰미가 좋은데?' },
      { id: 'r1q4', type: 'choice', score: 6000, q: '가장 마지막에 퇴근하는 사람이 해야 할 일은?',
        choices: ['창문을 열어둔다', '실내 소등 및 보안 점검', '음악을 크게 틀어둔다', '아무것도 안 한다'], ans: 1,
        ok: '마무리까지 완벽하군!' },
      { id: 'r1q5', type: 'short',  score: 7500, q: '서류박스 아래 메모지에 적힌 세 자리 숫자는?',
        hint: '박스를 치우면 나오는 노란 메모지 (숫자 3자리)', ans: ['100'],
        ok: '메시지 확인 완료!' }
    ],
    2: [
      { id: 'r2q1', type: 'choice', score: 6500, q: '분석 장비 배선 작업 전 가장 먼저 해야 할 일은?',
        choices: ['전원 차단 및 작업 표지 부착', '일단 뽑아본다', '동료에게 미룬다', '장갑만 낀다'], ans: 0,
        ok: 'LOTO 원칙, 잘 알고 있군!' },
      { id: 'r2q2', type: 'choice', score: 6000, q: '비용 결재를 상신할 때 반드시 첨부해야 하는 것은?',
        choices: ['본인 사진', '영수증 및 증빙 내역', '일기장', '첨부 없음'], ans: 1,
        ok: '증빙 처리 확실하네!' },
      { id: 'r2q3', type: 'short',  score: 7000, q: '방금 이어 붙인 케이블은 모두 몇 쌍이었지?',
        hint: '케이블 미니게임에서 연결한 쌍의 수 (숫자만)', ans: ['3', '3쌍', '세쌍'],
        ok: '배선 복구 완료!' },
      { id: 'r2q4', type: 'choice', score: 6000, q: '회의 시작 전 가장 바람직한 준비 자세는?',
        choices: ['5분 늦게 들어간다', '아젠다를 미리 숙지한다', '노트북만 들고 간다', '조용히 존다'], ans: 1,
        ok: '회의 준비 완료!' },
      { id: 'r2q5', type: 'short',  score: 7500, q: '커피머신 컵 바닥에 찍혀 있던 숫자는?',
        hint: '커피를 내린 뒤 컵을 확인해 보세요 (숫자 2자리)', ans: ['42'],
        ok: '이런 것도 찾아내다니!' }
    ],
    3: [
      { id: 'r3q1', type: 'choice', score: 6500, q: 'VSEM 분석용 정밀 시편 취급 수칙으로 올바른 것은?',
        choices: ['맨손으로 잡는다', '전용 핀셋과 클린 장갑을 사용한다', '서류 더미 위에 둔다', '물로 헹군다'], ans: 1,
        ok: '시편 취급 수칙 통과!' },
      { id: 'r3q2', type: 'short',  score: 6500, q: '길이 단위 "나노미터"의 영문 약어는?',
        hint: '소문자 두 글자', ans: ['nm'],
        ok: '정밀 단위 확인 완료!' },
      { id: 'r3q3', type: 'choice', score: 6000, q: '분석 장비 사용을 마친 뒤 해야 할 조치는?',
        choices: ['전원을 강제로 내린다', '커버를 씌우고 사용 로그를 기록한다', '그대로 둔다', '알코올을 붓는다'], ans: 1,
        ok: '꼼꼼한 마무리가 생명이죠!' },
      { id: 'r3q4', type: 'short',  score: 7500, q: '모니터를 닦아내자 화면에 나타난 네 자리 코드는?',
        hint: '얼룩을 문질러 지우면 보입니다 (숫자 4자리)', ans: ['2470'],
        ok: '코드 확보!' },
      { id: 'r3q5', type: 'choice', score: 6000, q: '중요 분석 데이터의 올바른 백업 방식은?',
        choices: ['개인 USB에만 보관', '주기적으로 지정 서버에 정기 백업', '백업하지 않음', '메신저로 보내둔다'], ans: 1,
        ok: '데이터 보관 완료!' }
    ],
    4: [
      { id: 'r4q1', type: 'choice', score: 6500, q: '프로젝트 성공을 위해 가장 필요한 역량은?',
        choices: ['혼자 다 처리하기', '적극적인 질문과 소통', '눈치 야근', '보고 생략'], ans: 1,
        ok: '훌륭한 마음가짐입니다!' },
      { id: 'r4q2', type: 'choice', score: 6000, q: '타 부서와 이견이 생겼을 때 올바른 태도는?',
        choices: ['내 의견을 관철시킨다', '근거를 바탕으로 상호 조율한다', '연락을 끊는다', '상사에게 이른다'], ans: 1,
        ok: '협업의 기본이 되어 있군!' },
      { id: 'r4q3', type: 'choice', score: 6000, q: '마감이 임박했을 때 가장 바람직한 행동은?',
        choices: ['일정과 진척도를 투명하게 공유한다', '혼자 조용히 야근한다', '마감일을 잊은 척한다', '포기한다'], ans: 0,
        ok: '진행 상황 공유, 감사합니다.' },
      { id: 'r4q4', type: 'short',  score: 7500, q: '금고 옆 쪽지에 적힌 "탈출 암호"는? (영문 4글자)',
        hint: '우리 팀 이름이기도 합니다', ans: ['s1fa'],
        ok: '최종 암호 확인!' },
      { id: 'r4q5', type: 'short',  score: 7000, q: '지금까지 통과한 방은 모두 몇 개일까? (이 방 포함)',
        hint: '숫자만 입력', ans: ['4', '4개', '네개'],
        ok: '드디어 마지막이군요!' }
    ]
  };

  /* ============================================================
     방 구성 — 배경 / 파트장 위치 / 단서 3곳 / 기믹 / 함정
     좌표는 240x160 픽셀 기준
     ============================================================ */
  const ROOMS = {
    1: {
      scene: 'room1',
      title: '1관 · EFA1',
      banner: 'EFA1 파트',
      full: '1관 · 분석기술팀 EFA1 파트',
      boss: 1, bossAt: [150, 148],
      playerAt: [58, 152],
      doorAt: [198, 32, 30, 44],
      welcome: '분석기술팀 EFA1 파트에 들어왔다.\n책상 위 물건을 치우고 단서 3개를 찾아내자!',
      clues: [
        { slot: 'A', label: '서류박스 아래', gate: { type: 'drag', prop: 'fileBox', at: [116, 66], size: 22,
            before: '책상 위 서류박스가 뭔가를 덮고 있다. 끌어서 치워보자! (드래그)',
            after: '박스를 치우자 노란 메모지가 나타났다!' },
          hotspot: [118, 70, 22, 18], prop: 'memo' },
        { slot: 'B', label: '모니터 전원', gate: { type: 'sequence', targets: ['mon-l', 'mon-c', 'mon-r'],
            order: [1, 0, 2],
            before: '모니터 3대가 꺼져 있다. 화이트보드에 적힌 순서대로 켜야 할 것 같은데...',
            hint: '화이트보드 메모: "가운데 → 왼쪽 → 오른쪽"',
            after: '모니터 3대가 모두 켜졌다! 화면에 문제가 떠올랐다.' },
          hotspot: [72, 56, 40, 31] },
        { slot: 'C', label: '파트장님과 대화', gate: { type: 'talk',
            before: '김주헌 파트장님이 이쪽을 보고 계신다. 말을 걸어보자.' },
          hotspot: null }
      ],
      traps: [
        { prop: 'bag', at: [46, 126], size: 22, drag: true, msg: '가방을 열어봤지만 여분 마스크와 사원증 줄뿐이었다... 먼지만 폴폴!', cost: true },
        { prop: 'tumbler', at: [56, 73], size: 14, msg: '파트장님 텀블러다. 아직 따뜻하다. 손대지 말자.' },
        { prop: 'mug', at: [158, 74], size: 13, msg: '누군가 마시다 만 아메리카노... 이건 단서가 아니야.' },
        { prop: 'chair', at: [88, 102], size: 24, msg: '푹신한 의자다. 앉고 싶지만 지금은 탈출이 먼저!' }
      ],
      hints: [{ at: [60, 14, 90, 46], msg: '화이트보드에 순서가 적혀 있다 →  가운데 · 왼쪽 · 오른쪽' }]
    },

    2: {
      scene: 'room2',
      title: '2관 · EFA2',
      banner: 'EFA2 파트',
      full: '2관 · 분석기술팀 EFA2 파트',
      boss: 2, bossAt: [122, 150],
      playerAt: [50, 152],
      doorAt: [200, 32, 30, 44],
      welcome: '장비 배선이 엉망이다.\n끊어진 케이블을 잇고, 서랍과 커피머신을 살펴보자!',
      clues: [
        { slot: 'A', label: '끊어진 케이블', gate: { type: 'wire', pairs: 3,
            before: '케이블 다발이 끊어져 있다. 같은 색끼리 이어주자!',
            after: '배선 복구 완료! 장비 화면에 문제가 표시됐다.' },
          hotspot: [124, 94, 28, 26] },
        { slot: 'B', label: '진짜 서랍', gate: { type: 'pickOne', options: 3, correct: 2,
            before: '서랍이 세 칸. 어느 칸에 단서가 있을까?',
            wrong: '텅 비었다! 스테이플러만 굴러다닌다.',
            after: '두 번째 서랍에서 낡은 노트를 찾았다!' },
          hotspot: [100, 98, 34, 26] },
        { slot: 'C', label: '커피머신', gate: { type: 'twoStep',
            step1: { prop: 'cup', at: [60, 75], size: 14, msg: '종이컵을 집었다. 커피머신에 놓아보자!' },
            step2Msg: '컵을 놓고 버튼을 눌렀다. 커피가 내려온다... 컵 바닥에 뭔가 적혀 있다!',
            before: '커피머신이 대기 중이다. 먼저 컵이 필요해 보인다.' },
          hotspot: [174, 92, 22, 26] }
      ],
      decor: [{ prop: 'cable', at: [124, 94], size: 26 }],
      traps: [
        { prop: 'toolbox', at: [84, 68], size: 22, drag: true, msg: '공구함을 열었지만 육각렌치만 가득... 단서는 없다.' },
        { prop: 'papers', at: [24, 70], size: 20, msg: '작년 설비 점검표다. 지금은 쓸모없어 보인다.' },
        { prop: 'plantSmall', at: [188, 130], size: 16, msg: '조화(造花)다. "물 주지 마세요" 스티커가 붙어 있다.' }
      ],
      hints: [{ at: [84, 16, 58, 40], msg: '화이트보드 낙서: "빨강-빨강 / 파랑-파랑 / 노랑-노랑. 색을 맞춰라."' }]
    },

    3: {
      scene: 'room3',
      title: '3관 · PFA/VSEM',
      banner: 'PFA / VSEM',
      full: '3관 · 분석기술팀 PFA/VSEM 파트',
      boss: 3, bossAt: [112, 150],
      playerAt: [48, 152],
      doorAt: [150, 32, 28, 44],
      welcome: '정밀 분석실이다.\n모니터를 닦고, 배율을 맞추고, 시편을 정리하자!',
      clues: [
        { slot: 'A', label: '얼룩진 모니터', gate: { type: 'wipe', code: '2470',
            before: '모니터가 얼룩으로 뒤덮여 있다. 문질러서 닦아내자!',
            after: '깨끗해진 화면에 코드 2470 이 떠올랐다!' },
          hotspot: [20, 64, 34, 26] },
        { slot: 'B', label: 'VSEM 배율', gate: { type: 'dial', target: 50, tol: 2,
            before: 'VSEM 배율 다이얼이 흐트러져 있다. 규정 배율로 맞추자.',
            hint: '화이트보드 기록: "표준 배율 = 50 kX"',
            after: '배율이 정확히 맞았다! 장비가 초록불로 바뀌었다.' },
          hotspot: [190, 68, 38, 62] },
        { slot: 'C', label: '시편 정리', gate: { type: 'collect', props: ['sample', 'sample', 'sample'],
            at: [[86, 116], [104, 124], [122, 114]], target: [58, 128, 26, 14],
            before: '시편 3개가 아무 데나 놓여 있다. 트레이로 옮겨 담자! (드래그)',
            after: '시편 정리 완료! 파트장님이 노트를 건네주셨다.' },
          hotspot: [58, 126, 28, 18] }
      ],
      traps: [
        { prop: 'towel', at: [138, 126], size: 20, drag: true, msg: '실험용 와이퍼다. 이걸로 닦으면 될 것 같았지만... 아니었다.' },
        { prop: 'book', at: [74, 68], size: 20, msg: '2019년 장비 매뉴얼. 페이지가 눌어붙어 안 열린다.' },
        { prop: 'mug', at: [102, 76], size: 13, msg: '분석실에서 음료 반입 금지! 얼른 치우자.', cost: true }
      ],
      hints: [{ at: [62, 16, 52, 34], msg: '화이트보드: "표준 측정 배율 = 50 kX / 백업은 정기적으로"' }]
    },

    4: {
      scene: 'room4',
      title: '4관 · 캔틴룸',
      banner: '캔틴룸',
      full: '4관 · 캔틴룸 (최종관)',
      boss: 4, bossAt: [98, 150],
      playerAt: [40, 152],
      doorAt: [146, 32, 28, 44],
      welcome: '마지막 관, 캔틴룸이다!\n컵을 치우고 금고를 열어 최종 탈출 암호를 찾아내자!',
      clues: [
        { slot: 'A', label: '컵 더미', gate: { type: 'clearAll', props: ['cup', 'cup', 'cup'],
            at: [[18, 82], [30, 80], [42, 84]],
            before: '테이블에 종이컵이 잔뜩 쌓여 있다. 하나씩 치워보자! (드래그)',
            after: '컵을 모두 치우자 금고 비밀번호가 적힌 쪽지가 나왔다!' },
          hotspot: [20, 84, 30, 18], prop: 'memo' },
        { slot: 'B', label: '비밀 금고', gate: { type: 'keypad',
            before: '벽 아래 작은 금고가 있다. 네 자리 비밀번호가 필요하다.',
            needFirst: 'A',
            needFirstMsg: '비밀번호를 모른다. 먼저 테이블 위 컵 더미부터 치워보자!',
            after: '철컥! 금고가 열렸다!' },
          hotspot: [182, 120, 30, 28] },
        { slot: 'C', label: '자판기', gate: { type: 'sequence', targets: ['v1', 'v2', 'v3'], order: [2, 0, 1],
            before: '자판기 버튼 3개. 순서가 맞아야 뭔가 나올 것 같다.',
            hint: '게시판 메모: "초록 → 파랑 → 노랑 순서로 눌러야 함"',
            after: '덜컹! 음료 대신 봉투가 떨어졌다!' },
          hotspot: [206, 72, 26, 42] }
      ],
      decor: [{ prop: 'safe', at: [182, 120], size: 28 }],
      traps: [
        { prop: 'lunchbox', at: [76, 90], size: 22, drag: true, msg: '누군가의 도시락이다. 열어보니 김치 냄새가... 조용히 닫자.', cost: true },
        { prop: 'waterJug', at: [108, 123], size: 18, drag: true, msg: '생수통은 생각보다 무겁다. 낑낑... 뒤에는 아무것도 없다.' },
        { prop: 'duster', at: [2, 125], size: 22, msg: '먼지떨이다. 여기저기 털어봤지만 재채기만 나온다.' }
      ],
      hints: [{ at: [62, 16, 46, 32], msg: '게시판 메모: "자판기 고장 → 초록 · 파랑 · 노랑 순서로 눌러주세요"' }]
    }
  };

  g.DATA = { CONFIG, AVATARS, BOSSES, BANK, ROOMS };
})(window);
