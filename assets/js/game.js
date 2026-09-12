/* ============================================================
   game.js — 게임 본체 (씬 구성 · 기믹 · 타이머 · 채점)
   ============================================================ */
(function (g) {
  'use strict';
  const { $, $$, el, esc, modal, toast, say, mmss, SFX } = g.UI;
  const { CONFIG, AVATARS, BOSSES, BANK, ROOMS, credoAnswers } = g.DATA;

  /* 시퀀스 기믹 좌표 (씬 픽셀 기준) */
  const SEQ_SPOTS = {
    1: { 'mon-l': [28, 62, 32, 25], 'mon-c': [72, 56, 40, 31], 'mon-r': [124, 62, 32, 25] },
    4: { 'v1': [210, 78, 24, 11], 'v2': [210, 90, 24, 11], 'v3': [210, 101, 24, 11] }
  };

  const S = {
    me: null, global: null, run: null, players: {}, teams: null,
    room: 0, phase: 'boot', quizzes: {}, roomSites: {}, seed: 1,
    gate: {}, clueApi: {}, bossEl: null, waitModal: null, myTeam: null, timer: null, ended: false, lastRoomRendered: null
  };

  /** 방 화면의 가로세로 비율을 CSS 변수로 남긴다.
      좁은 화면에서 채팅이 열리면 이 값으로 화면을 비율 그대로 줄인다. */
  function setStageRatio(r) {
    const w = $('#stage-wrap');
    if (w && r > 0) w.style.setProperty('--stage-ar', String(r));
  }

  /* ---------- 좌표 (배경 그림 기준 백분율) ---------- */
  const pctX = v => (v / PX.W * 100) + '%';
  const pctY = v => (v / PX.H * 100) + '%';

  /** rect = [왼쪽%, 위%, 너비%, 높이%] */
  function placePct(node, r) {
    node.style.left = r[0] + '%'; node.style.top = r[1] + '%';
    node.style.width = r[2] + '%'; node.style.height = r[3] + '%';
  }

  /* ============================================================
     문제 배정 (팀 시드 기반, 재현 가능)
     ------------------------------------------------------------
     방마다 3문제가 출제되며 구성은 항상 아래와 같다.
       · 근무지 전용 1문제 : 그 관에 배정된 근무지(SR3/S1L) 문제 중 하나
       · 고난도 1문제      : tier:'hard' — 자료 두세 장을 조합해야 풀린다
       · 일반 1문제        : 화면·액자를 보면 바로 풀린다
     관마다 배정 근무지가 번갈아 정해지고 팀에 따라 순서가 뒤집히므로,
     한 팀은 4개 관에서 SR3 전용 2문제 + S1L 전용 2문제를 반드시 만난다.
     → 팀에 SR3·S1L 인원이 모두 있어야 탈출할 수 있다.
     ============================================================ */
  function lcg(seed) { let s = (seed >>> 0) || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

  /** 이 관에서 어느 근무지 전용 문제가 나올지 (팀 시드에 따라 배치가 뒤집힌다) */
  function siteForRoom(room, seed) {
    const flip = (seed % 2) === 0;
    const odd = (room % 2) === 1;
    return (odd !== flip) ? 'SR3' : 'S1L';
  }

  function assignQuizzes(seed) {
    S.seed = seed;
    const out = {}, sites = {};
    for (let r = 1; r <= CONFIG.ROOM_COUNT; r++) {
      const rand = lcg(seed * 7919 + r * 104729);
      const take = arr => arr.splice(Math.floor(rand() * arr.length), 1)[0];
      const bank = (BANK[r] || []).slice();
      const site = siteForRoom(r, seed);
      const pools = {
        site: bank.filter(q => q.loc === site),
        hard: bank.filter(q => !q.loc && q.tier === 'hard'),
        easy: bank.filter(q => !q.loc && q.tier !== 'hard')
      };
      const pick = [];
      ['site', 'hard', 'easy'].forEach(k => { if (pools[k].length) pick.push(take(pools[k])); });
      // 문제은행을 줄였을 때를 대비한 보충
      const rest = bank.filter(q => pick.indexOf(q) < 0);
      while (pick.length < CONFIG.CLUES_PER_ROOM && rest.length) pick.push(take(rest));

      // 전용·고난도 문제가 늘 같은 자리에 오지 않도록 섞는다
      for (let i = pick.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = pick[i]; pick[i] = pick[j]; pick[j] = t;
      }
      out[r] = pick.slice(0, CONFIG.CLUES_PER_ROOM);
      sites[r] = site;
    }
    S.quizzes = out;
    S.roomSites = sites;
  }

  /** 주관식 정답 목록 (크레도 문제는 data.js 의 CREDO 에서 자동 계산) */
  function answersOf(q) {
    if (q.type === 'order') return [(q.order || []).join('')];
    if (q.credo) {
      const a = credoAnswers(q.credo);
      if (!a.length) console.warn('[S1FA] 크레도 정답을 만들 수 없습니다:', q.id, '— data.js 의 CREDO.lines 를 확인하세요.');
      return a;
    }
    return q.ans || [];
  }

  /** 시작할 때 문제은행 구성을 점검해 콘솔에 경고를 남긴다 */
  function checkBank() {
    for (let r = 1; r <= CONFIG.ROOM_COUNT; r++) {
      const bank = BANK[r] || [];
      const sr3 = bank.filter(q => q.loc === 'SR3').length;
      const s1l = bank.filter(q => q.loc === 'S1L').length;
      const hard = bank.filter(q => !q.loc && q.tier === 'hard').length;
      const easy = bank.filter(q => !q.loc && q.tier !== 'hard').length;
      if (!sr3 || !s1l) console.warn('[S1FA] ' + r + '관 문제은행에 SR3/S1L 전용 문제가 부족합니다. (SR3 ' + sr3 + ' / S1L ' + s1l + ')');
      if (!hard) console.warn('[S1FA] ' + r + '관에 고난도(tier:hard) 문제가 없습니다.');
      if (!easy) console.warn('[S1FA] ' + r + '관에 일반 문제가 없습니다.');
      bank.forEach(q => {
        if (q.credo && !credoAnswers(q.credo).length) console.warn('[S1FA] 크레도 문제 정답 없음:', q.id);
        (q.docs || []).forEach(d => { if (!(g.DATA.DOCS || {})[d]) console.warn('[S1FA] ' + q.id + ' 가 없는 자료를 가리킵니다:', d); });
      });
    }
  }

  function teamCode() { return 1000 + ((S.seed * 7919) % 9000); }

  /* ---------- 내 진행 상태 조회 ---------- */
  function roomRec(r) { return (S.run && S.run.rooms && S.run.rooms[r]) || {}; }
  function solvedSlots(r) { return roomRec(r).solves || {}; }
  function isSolved(r, slot) { return !!solvedSlots(r)[slot]; }
  function solvedCount(r) { return Object.keys(solvedSlots(r)).length; }
  function roomDone(r) { return !!roomRec(r).done; }
  function allSolved(r) { return solvedCount(r) >= CONFIG.CLUES_PER_ROOM; }

  /* ---------- 타이머 ---------- */
  function roomElapsed() {
    const gs = S.global;
    if (!gs || !gs.startAt) return 0;
    let e = NET.now() - gs.startAt - (gs.pauseTotal || 0);
    if (gs.pausedAt) e -= (NET.now() - gs.pausedAt);
    return Math.max(0, e / 1000);
  }
  function roomRemain() { return Math.max(0, CONFIG.ROOM_SECONDS - roomElapsed()); }
  function totalRemain() {
    let used = 0;
    for (let r = 1; r <= CONFIG.ROOM_COUNT; r++) {
      const d = roomRec(r).done;
      if (d) used += Math.min(CONFIG.ROOM_SECONDS, d.sec || 0);
      else if (r === S.room && S.phase === 'playing') used += roomElapsed();
    }
    return Math.max(0, CONFIG.ROOM_SECONDS * CONFIG.ROOM_COUNT - used);
  }

  function startTicker() {
    clearInterval(S.timer);
    S.timer = setInterval(tick, 250);
    tick();
  }
  function tick() {
    const rt = $('#hud-room-time'), tt = $('#hud-total-time');
    if (!rt) return;
    const gs = S.global;
    const live = !!(gs && gs.phase === 'playing' && gs.startAt);
    if (!live) {
      rt.textContent = mmss(CONFIG.ROOM_SECONDS);
      rt.classList.remove('is-warn');
    } else {
      const rem = roomRemain();
      rt.textContent = mmss(rem);
      rt.classList.toggle('is-warn', rem <= 30);
      if (S.phase === 'playing') {
        if (rem <= 30 && rem > 29.5) SFX.warn();
        if (rem <= 0 && !S.ended) finishRoom('timeout');
      }
    }
    updateWaitPanel(live);
    tt.textContent = mmss(totalRemain());
    // 일시정지 오버레이
    const paused = !!(S.global && S.global.pausedAt);
    const ov = $('#stage-overlay');
    if (paused && S.phase === 'playing') {
      ov.classList.remove('hidden');
      $('#stage-overlay-text').textContent = '⏸  일시정지\n관리자가 게임을 멈췄습니다';
    } else if (!paused && ov.classList.contains('hidden') === false && !ov.dataset.keep) {
      ov.classList.add('hidden');
    }
  }

  /** 현재 진행 중인 방의 인원 현황 */
  function roomProgressCounts() {
    const gs = S.global;
    if (!gs || gs.phase !== 'playing') return { playing: 0, done: 0 };
    const room = gs.room || 1, runs = S.allRuns || {};
    let playing = 0, done = 0;
    Object.values(S.players || {}).forEach(pl => {
      if (!pl || !pl.uid || pl.isAdmin) return;
      const rec = ((runs[pl.uid] || {}).rooms || {})[room] || {};
      if (rec.done) done++; else playing++;
    });
    return { playing, done };
  }

  /** 대기 화면에 "진행 중인 방의 남은 시간" 을 갱신 */
  function updateWaitPanel(live) {
    const box = document.getElementById('im-live');
    if (!box) return;
    const gs = S.global;
    if (!live) {
      box.innerHTML = '<div class="wait-line">관리자가 다음 방을 열어줄 때까지 기다려주세요.</div>';
      return;
    }
    const rem = roomRemain();
    const c = roomProgressCounts();
    const warn = rem <= 30 ? ' is-warn' : '';
    box.innerHTML =
      '<div class="wait-timer' + warn + '"><span>' + (gs.room || 1) + '관 남은 시간</span><b>' + mmss(rem) + '</b></div>' +
      '<div class="wait-line">🏃 아직 진행 중 <b>' + c.playing + '명</b>' +
      '　✅ 방 통과 <b>' + c.done + '명</b></div>' +
      (rem <= 0 ? '<div class="wait-line">⏰ 시간이 끝났습니다. 곧 다음 방이 열립니다!</div>' : '');
  }

  /* ---------- HUD ---------- */
  function updateHUD() {
    const admin = !!S.me.isAdmin;
    const sc = NET.scoreOf(S.run);
    $('#hud-score').textContent = sc.score.toLocaleString() + ' P';
    $('#hud-player').textContent = (admin ? '👑 ' : '') + S.me.name +
      (S.me.loc ? ' · ' + S.me.loc : '') + (S.myTeam != null ? ' · ' + S.myTeam + '팀' : '');
    const dots = [];
    for (let i = 0; i < CONFIG.CLUES_PER_ROOM; i++) dots.push(i < solvedCount(S.room) ? '●' : '○');
    $('#hud-clues').textContent = S.room ? dots.join('') : '- - -';
    // 좁은 화면에서는 짧은 방 이름이 보이도록 두 벌을 함께 채운다 (CSS 가 골라 보여준다)
    const RM = S.room ? ROOMS[S.room] : null;
    $('#hud-room .rm-full').textContent  = RM ? (RM.full || RM.title || '') : '대기실';
    $('#hud-room .rm-short').textContent = RM ? (RM.title || RM.full || '') : '대기실';
    $('#btn-admin').classList.toggle('hidden', !admin);
    // 관리자는 점수를 얻지 않으므로 개인 점수·단서 표시를 숨긴다
    $('#hud-score').classList.toggle('hidden', admin);
    $('#hud-clues').classList.toggle('hidden', admin);
  }

  /* ---------- 씬 렌더 ---------- */
  function clearLayers() {
    ['#prop-layer', '#actor-layer', '#fx-layer'].forEach(sel => {
      const l = $(sel);
      $$('.actor', l).forEach(a => clearInterval(a._anim));
      $$('.npc', l).forEach(a => clearInterval(a._anim));
      $$('.ov', l).forEach(p => p._cleanup && p._cleanup());
      l.innerHTML = '';
    });
  }
  /** 사진 배경을 끄고 기본 도트 배경으로 되돌린다 (대기실 · 결과 화면용) */
  function usePixelScene(name) {
    const layer = $('#bg-image'); if (layer) layer.classList.add('hidden');
    const cv = $('#bg-canvas'); if (cv) cv.classList.remove('hidden');
    const st = $('#stage'); if (st) { st.style.aspectRatio = '3 / 2'; setStageRatio(1.5); }
    PX.renderScene(cv, name);
  }
  function showTitle(txt) {
    const t = $('#scene-title');
    t.textContent = txt || '';
    t.classList.remove('fade');
    if (txt) setTimeout(() => t.classList.add('fade'), 2200);
  }
  function renderScene(name) {
    PX.renderScene($('#bg-canvas'), name);
    S.lastRoomRendered = name;
  }

  /** dispH 를 주면 그 높이(씬 단위)로 맞춰 그린다 */
  function addActor(avatarOpts, x, yFeet, tag, cls, scale, dispH) {
    const a = g.UI.actorEl(avatarOpts, tag, cls, scale || 3);
    const c = a.querySelectorAll('canvas');
    let uw = (c[0] && +c[0].dataset.uw) || PX.CH_W;
    let uh = (c[0] && +c[0].dataset.uh) || PX.CH_H;
    if (dispH) { uw = uw * (dispH / uh); uh = dispH; }
    a.style.left = pctX(x - uw / 2);
    a.style.top = pctY(yFeet - uh);
    a.style.width = pctX(uw);
    c.forEach(cc => { cc.style.width = '100%'; cc.style.height = 'auto'; });
    $('#actor-layer').appendChild(a);
    return a;
  }
  /** 배경 그림 위에 얹는 오버레이 소품 (포스트잇 · 서류 · 포스터) */
  function addOverlay(kind, rect, label) {
    const d = el('div', 'ov ov-' + kind);
    placePct(d, rect);
    if (label) d.appendChild(el('span', 'ov-label', esc(label)));
    $('#prop-layer').appendChild(d);
    return d;
  }
  function addHotspot(rect, onClick, title, cls) {
    const h = el('div', 'hotspot ' + (cls || ''));
    placePct(h, rect);
    if (title) { h.title = title; h.dataset.label = title; }
    h.addEventListener('click', e => { e.stopPropagation(); onClick(h); });
    $('#prop-layer').appendChild(h);
    return h;
  }
  /** 방 담당자(NPC)를 세운다. at = [왼쪽%, 아래여백%, 키%] */
  function addBoss(R) {
    const boss = BOSSES[R.boss]; if (!boss) return null;
    const at = R.bossAt || [70, 4, 32];
    const wrap = el('div', 'npc');
    wrap.style.left = at[0] + '%';
    wrap.style.bottom = at[1] + '%';
    wrap.style.height = at[2] + '%';

    const c0 = PX.characterCanvas(boss, 4, 0);
    const c1 = PX.characterCanvas(boss, 4, 1);
    [c0, c1].forEach(c => { c.className = 'npc-img'; });
    c1.style.display = 'none';
    wrap.appendChild(c0); wrap.appendChild(c1);
    let f = 0;
    wrap._anim = setInterval(() => {
      f ^= 1; c0.style.display = f ? 'none' : 'block'; c1.style.display = f ? 'block' : 'none';
    }, 560);

    wrap.appendChild(el('div', 'npc-tag', esc(boss.name)));
    wrap.addEventListener('click', () => { SFX.select(); bossHint(R, wrap); });
    $('#actor-layer').appendChild(wrap);
    return wrap;
  }

  /** PNG 스프라이트가 나중에 도착하면 NPC 를 다시 그린다 */
  document.addEventListener('s1fa:sprite', () => {
    if (S.phase !== 'playing' || !S.bossEl) return;
    const R = ROOMS[S.room]; if (!R) return;
    const boss = BOSSES[R.boss];
    if (!boss || !boss.sprite || !PX.hasCharImage(boss.sprite)) return;
    clearInterval(S.bossEl._anim);
    S.bossEl.remove();
    S.bossEl = addBoss(R);
    refreshExit();
  });

  /** NPC 를 누르면 남은 단서를 알려준다 */
  function bossHint(R, wrap) {
    const boss = BOSSES[R.boss];
    const left = R.clues.filter(c => !isSolved(S.room, c.slot));
    let msg;
    if (!left.length) {
      msg = '단서를 다 찾았군요! 이제 나가는 문으로 가세요. 🚪';
      g.UI.bubble(wrap, '!');
    } else {
      const names = left.map(c => '「' + c.label + '」').join(', ');
      msg = '아직 ' + left.length + '군데가 남았어요.\n' + names + ' 쪽을 살펴보세요!';
      g.UI.bubble(wrap, '?');
    }
    say(msg, boss.name);
  }

  /** 해결한 단서 자리에 체크 표시 */
  function addCheck(rect, label) {
    const m = el('div', 'check');
    m.style.left = (rect[0] + rect[2] / 2) + '%';
    m.style.top = (rect[1] + rect[3] / 2) + '%';
    m.innerHTML = '<i>✓</i>' + (label ? '<b>' + esc(label) + '</b>' : '');
    $('#fx-layer').appendChild(m);
    return m;
  }

  /* ============================================================
     대기실 / 인터미션 씬
     ============================================================ */
  function renderLobby(msg) {
    S.phase = 'lobby'; S.room = 0; S.ended = false;
    g.UI.closeAll();            // 이전 정산 창 등 정리 (관리자 패널은 유지됨)
    S.waitModal = null;
    clearLayers(); usePixelScene('lobby'); showTitle('대기실');
    updateHUD();
    g.UI.bgmDown();        // 대기실 → 배경음악 서서히 줄이기
    if (g.CHAT) g.CHAT.refresh();   // 대기실에서는 팀 + 전체 채팅
    say(msg || '대기실이다. 관리자가 게임을 시작할 때까지 기다리자!\n다른 참가자들도 속속 도착하고 있다.');
    drawLobbyCrowd();
  }
  function drawLobbyCrowd() {
    if (S.phase !== 'lobby' && S.phase !== 'intermission') return;
    const layer = $('#actor-layer'), fx = $('#fx-layer');
    $$('.actor', layer).forEach(a => clearInterval(a._anim));
    layer.innerHTML = '';
    $$('.crowd-name', fx).forEach(n => n.remove());
    $$('.crowd-badge', fx).forEach(n => n.remove());

    /* 접속한 사람 전원 (관리자 제외). 들어온 순서로 정렬해 자리가 흔들리지 않게 */
    const all = Object.values(S.players || {}).filter(p => p && p.uid && !p.isAdmin);
    const online = all.filter(p => p.online)
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0) || String(a.uid).localeCompare(String(b.uid)));
    if (!online.length) return;

    /* 인원이 많아질수록 촘촘하게 — 몇 명이든 모두 그린다 */
    const n = online.length;
    const perRow = n <= 6 ? 4 : n <= 14 ? 6 : n <= 28 ? 8 : n <= 48 ? 10 : 12;
    const rows = Math.ceil(n / perRow);
    const dispH = n <= 6 ? 44 : n <= 14 ? 36 : n <= 28 ? 28 : n <= 48 ? 24 : 20;
    const stepX = (PX.W - 20) / perRow;
    const botY = 150;                       // 맨 아랫줄 발 위치 (이름표 잘림 방지)
    const topY = Math.max(86, botY - 15 * (rows - 1));
    const stepY = rows > 1 ? (botY - topY) / (rows - 1) : 0;

    online.forEach((p, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const inRow = Math.min(perRow, n - row * perRow);
      const x = (PX.W - stepX * inRow) / 2 + stepX * (col + 0.5);
      const y = topY + stepY * row;
      const me = p.uid === NET.uid;

      const a = addActor(AVATARS[p.avatar] || AVATARS[0], x, y, null, me ? 'me' : '', 3, dispH);
      a.style.zIndex = String(20 + row * 2 + (me ? 60 : 0));

      /* 이름표는 캐릭터보다 위 레이어에 따로 그린다 — 겹쳐도 이름은 다 보이게 */
      const tag = el('div', 'crowd-name' + (me ? ' is-me' : ''), esc(p.name) + (me ? ' (나)' : ''));
      tag.style.left = ((x / PX.W) * 100) + '%';
      // 같은 줄에서 이웃끼리 겹치지 않도록 한 칸씩 높이를 어긋나게
      const lift = dispH + 2 + (col % 2 ? 6 : 0);
      tag.style.top = (((y - lift) / PX.H) * 100) + '%';
      tag.style.zIndex = String(200 + row * 2 + (col % 2) + (me ? 60 : 0));
      fx.appendChild(tag);
    });

    /* 접속 현황 */
    const offline = all.length - online.length;
    const badge = el('div', 'crowd-badge',
      '👥 대기실 ' + online.length + '명' + (offline > 0 ? ' (접속 끊김 ' + offline + '명)' : ''));
    fx.appendChild(badge);
  }

  /* ============================================================
     방 배경 (사진 이미지 · 없으면 기본 도트 배경)
     ============================================================ */
  const BG_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
  const bgCache = {};

  function findRoomImage(name) {
    if (bgCache[name] !== undefined) return Promise.resolve(bgCache[name]);
    const dir = CONFIG.ROOM_BG_DIR;
    return new Promise(resolve => {
      let i = 0;
      const tryNext = () => {
        if (i >= BG_EXT.length) { bgCache[name] = null; return resolve(null); }
        const url = dir + name + BG_EXT[i++];
        const im = new Image();
        im.onload = () => { bgCache[name] = im; resolve(im); };
        im.onerror = tryNext;
        im.src = url;
      };
      tryNext();
    });
  }

  function setRoomBackground(R) {
    const stage = $('#stage'), cv = $('#bg-canvas'), layer = $('#bg-image');
    const useFallback = () => {
      layer.classList.add('hidden');
      cv.classList.remove('hidden');
      stage.style.aspectRatio = '3 / 2'; setStageRatio(1.5);
      PX.renderScene(cv, R && R.fallback ? R.fallback : 'lobby');
    };
    if (!R || !R.bg) { useFallback(); return; }

    const cached = bgCache[R.bg];
    if (cached) { applyImage(cached); return; }        // 이미 받아둔 그림은 곧바로
    if (cached === null) { useFallback(); return; }    // 그림이 없는 것이 확인된 경우

    // 아직 모르는 상태 — 도트 배경을 깜빡 보여주지 않고 빈 화면으로 기다린다
    cv.classList.add('hidden');
    layer.classList.remove('hidden');
    layer.style.backgroundImage = '';
    findRoomImage(R.bg).then(im => {
      if (S.room !== R.__n) return;
      if (im) applyImage(im); else useFallback();
    });

    function applyImage(im) {
      layer.style.backgroundImage = 'url("' + im.src + '")';
      layer.classList.remove('hidden');
      cv.classList.add('hidden');
      stage.style.aspectRatio = im.naturalWidth + ' / ' + im.naturalHeight;
      setStageRatio(im.naturalWidth / im.naturalHeight);
    }
  }

  /* ============================================================
     방 입장
     ============================================================ */
  function enterRoom(n) {
    const R = ROOMS[n]; if (!R) return;
    R.__n = n;
    S.room = n; S.phase = 'playing'; S.ended = false;
    S.gate = {};
    S.clueApi = {}; S.bossEl = null;
    g.UI.closeAll();
    S.waitModal = null;
    clearLayers();
    setRoomBackground(R);
    showTitle(R.banner);
    updateHUD();
    say(R.welcome, R.full);
    SFX.door();
    g.UI.bgmUp();
    if (g.CHAT) g.CHAT.refresh();   // 방 안에서는 팀 채팅만          // 방 시작 → 배경음악 다시 올리기

    /* 방 담당자 */
    S.bossEl = addBoss(R);

    /* 살펴보기 지점 */
    (R.hints || []).forEach(h => addHotspot(h.at, () => {
      SFX.select();
      say(h.msg, '👀 살펴보기');
      if (h.docs && h.docs.length) setTimeout(() => g.DOCVIEW.open(h.docs), 260);
    }, h.label || '살펴보기', 'look'));

    /* 함정(낚시) */
    (R.traps || []).forEach(t => {
      addHotspot(t.at, () => {
        SFX.trap();
        say(t.msg, '🎣 …');
        if (t.cost) {
          NET.addTrap(S.room);
          g.QKIT.shake($('#stage'));
          toast('함정! -' + CONFIG.TRAP_PENALTY + '점', 'bad');
        }
      }, t.label || '???', 'look');
    });

    /* 단서 3개 */
    R.clues.forEach((c, idx) => buildClue(R, c, idx));

    /* 나가는 문 */
    buildExit(R);
    startTicker();
    if (roomRemain() <= 0) finishRoom('timeout');
  }

  /* ---------- 나가는 문 (사진 배경 위 고정 버튼) ---------- */
  function buildExit() {
    const btn = el('button', 'exit-btn', '🔒 다음 방');
    btn.id = 'exit-btn';
    btn.addEventListener('click', () => {
      if (!allSolved(S.room)) {
        SFX.no();
        say('아직 잠겨 있다. 이 방의 단서 ' + CONFIG.CLUES_PER_ROOM + '개를 모두 풀어야 열린다!\n(현재 ' + solvedCount(S.room) + '/' + CONFIG.CLUES_PER_ROOM + ')');
        return;
      }
      finishRoom('cleared');
    });
    $('#fx-layer').appendChild(btn);
    refreshExit();
  }
  function refreshExit() {
    const btn = $('#exit-btn'); if (!btn) return;
    const open = allSolved(S.room);
    if (S.bossEl) S.bossEl.classList.toggle('is-done', open);
    btn.classList.toggle('is-open', open);
    btn.textContent = open
      ? (S.room === CONFIG.ROOM_COUNT ? '🎉 최종 탈출!' : '🚪 ' + (S.room + 1) + '관으로')
      : '🔒 다음 방 (' + solvedCount(S.room) + '/' + CONFIG.CLUES_PER_ROOM + ')';
    placeExit();
  }

  /**
   * '다음 방' 버튼을 보스·채팅창과 겹치지 않는 자리에 놓는다.
   * 보스는 사용자가 넣는 PNG 라 크기를 미리 알 수 없으므로 실제 화면 좌표로 판단한다.
   */
  function placeExit() {
    const btn = $('#exit-btn'); if (!btn) return;
    const blockers = [S.bossEl, $('#chat-panel')].filter(
      e => e && !e.classList.contains('hidden') && e.getBoundingClientRect().width > 0);
    const spots = ['', 'at-left', 'lifted', 'at-left lifted'];
    const hits = () => {
      const a = btn.getBoundingClientRect();
      return blockers.some(e => {
        const c = e.getBoundingClientRect();
        return a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
      });
    };
    for (const s of spots) {
      btn.className = 'exit-btn' + (btn.classList.contains('is-open') ? ' is-open' : '') +
                      (s ? ' ' + s : '');
      if (!hits()) return;
    }
  }

  /* ============================================================
     단서 · 기믹
     ------------------------------------------------------------
     · 기믹을 통과하면 기믹용 요소를 모두 제거해 클릭을 가로채지 않게 한다
     · 문제를 안 풀고 닫아도 단서 자리를 다시 눌러 재도전할 수 있다
     · 이미 맞힌 단서는 어떤 경로로도 다시 풀 수 없다
     ============================================================ */
  function buildClue(R, clue, idx) {
    const slot = clue.slot;
    const gate = clue.gate;
    const boss = BOSSES[R.boss] ? BOSSES[R.boss].name : '';
    let opened = isSolved(S.room, slot);   // 기믹 통과 여부
    let gateEls = [];                      // 기믹이 만든 요소 (통과 후 제거)
    let checkEl = null;                    // 해결 후 표시되는 체크

    const quizOf = () => S.quizzes[S.room] && S.quizzes[S.room][idx];

    /* --- 단서 자리 : 항상 존재하며 재도전을 담당 --- */
    const hot = addHotspot(clue.at, () => onClueClick(), clue.label, 'clue');

    function onClueClick() {
      if (isSolved(S.room, slot)) { SFX.select(); say('✅ 이미 해결한 단서다. 다른 곳을 찾아보자!'); return; }
      if (!opened) { runGate(); return; }
      openQuiz();
    }

    function openQuiz() {
      if (isSolved(S.room, slot)) { SFX.select(); say('✅ 이미 해결한 단서다.'); return; }
      const q = quizOf(); if (!q) return;
      askQuiz(q, slot, idx, boss);
    }

    /** 기믹 통과 */
    function markOpen(msg) {
      if (opened) return;
      opened = true;
      clearGateEls();
      hot.classList.add('is-open');
      SFX.great();
      if (msg) say(msg, '🔎 단서 발견');
      setTimeout(openQuiz, 550);
    }
    function clearGateEls() { gateEls.forEach(n => n.remove()); gateEls = []; }

    /** 해결한 단서로 표시 (체크 표시를 남긴다) */
    function markSolved() {
      clearGateEls();
      hot.classList.add('solved');
      if (!checkEl) checkEl = addCheck(clue.at, clue.label);
    }

    /* 외부(문제 정답 시 등)에서 상태를 갱신할 수 있게 등록 */
    S.clueApi[slot] = {
      refresh() {
        if (isSolved(S.room, slot)) { opened = true; markSolved(); }
      }
    };

    if (isSolved(S.room, slot)) { markSolved(); return; }

    /* ---------------- 기믹 실행 ---------------- */
    function runGate() {
      switch (gate.type) {
        case 'direct':
          say(gate.before);
          setTimeout(() => markOpen(gate.after), 400);
          break;

        case 'talk':
          say(gate.before, boss);
          setTimeout(() => markOpen(gate.after), 500);
          break;

        case 'power': {
          say(gate.press || gate.before);
          const glow = addOverlay('power', clue.at);
          gateEls.push(glow);
          setTimeout(() => markOpen(gate.after), 900);
          break;
        }

        case 'shake': {
          S.gate['shake' + slot] = (S.gate['shake' + slot] || 0) + 1;
          const n = S.gate['shake' + slot], need = gate.times || 5;
          SFX.move();
          if (n >= need) markOpen(gate.after);
          else say((gate.step || '흔들었다...') + ' (' + n + '/' + need + ')');
          break;
        }

        case 'wipe':
          say(gate.before);
          PUZZLE.wipe(gate.codeFromTeam ? String(teamCode()) : (gate.code || '0000'),
            () => markOpen(gate.after + (gate.codeFromTeam ? '\n적혀 있던 숫자: ' + teamCode() : '')));
          break;

        case 'keypad': {
          if (gate.needFirst && !isSolved(S.room, gate.needFirst) && !S.gate['code' + gate.needFirst]) {
            SFX.no(); say(gate.needFirstMsg); return;
          }
          say(gate.before);
          PUZZLE.keypad(teamCode(), () => markOpen(gate.after));
          break;
        }

        default:
          say(gate.before);
      }
    }

    /* ---------------- 기믹용 요소 배치 ---------------- */
    if (gate.type === 'drag') {
      const ov = addOverlay(gate.prop, gate.at, gate.label);
      gateEls.push(ov);
      let told = false;
      PUZZLE.makeDraggable(ov, $('#stage'), {
        onDragStart: () => { if (!told) { told = true; say(gate.before); } },
        onMoved: () => { ov.classList.add('gone'); markOpen(gate.after); },
        onTap: () => { SFX.select(); say(gate.before); }
      });
    }

    if (gate.type === 'sequence') {
      let step = 0;
      (gate.spots || []).forEach((rect, i) => {
        const sp = addHotspot(rect, (node) => {
          if (opened) return;
          if (gate.order[step] === i) {
            step++; SFX.ok();
            node.classList.add('is-lit');
            if (step >= gate.order.length) markOpen(gate.after);
            else say('켜졌다! (' + step + '/' + gate.order.length + ') 다음 순서를 눌러보자.');
          } else {
            step = 0; SFX.no();
            gateEls.forEach(n => n.classList.remove('is-lit'));
            say('삐— 순서가 틀렸다! 처음부터 다시.\n' + (gate.hint || ''));
          }
        }, gate.spotLabel || '눌러보기', 'clue gate-sub');
        gateEls.push(sp);
      });
    }

    if (gate.type === 'pickOne') {
      const base = clue.at, n = gate.options || 3, vertical = gate.layout === 'v';
      for (let i = 0; i < n; i++) {
        const rect = vertical
          ? [base[0], base[1] + (base[3] / n) * i, base[2], base[3] / n - 0.6]
          : [base[0] + (base[2] / n) * i, base[1], base[2] / n - 0.6, base[3]];
        const sp = addHotspot(rect, () => {
          if (opened) return;
          if (i === (gate.correct || 1) - 1) markOpen(gate.after);
          else { SFX.trap(); say(gate.wrong, '🎣 …'); }
        }, (i + 1) + '번째 칸', 'clue gate-sub');
        gateEls.push(sp);
      }
    }
  }

  /** 서버 기록이 늦게 도착했을 때 단서 상태를 다시 맞춘다 */
  function refreshClueStates() {
    if (S.phase !== 'playing' || !S.clueApi) return;
    Object.keys(S.clueApi).forEach(k => S.clueApi[k].refresh());
    refreshExit();
  }

  /* ============================================================
     퀴즈
     ============================================================ */
  function askQuiz(q, slot, idx, boss) {
    if (!q) return;
    const wrap = el('div');
    const tier = q.tier === 'hard'
      ? '<span class="quiz-tier">\u2605 고난도</span>' : '';
    const meta = '<div class="quiz-meta"><span>단서 <b>' + (idx + 1) + '/' + CONFIG.CLUES_PER_ROOM + '</b></span>' +
      '<span>배점 <b>' + q.score.toLocaleString() + '점</b></span>' +
      '<span>오답 <b>-' + CONFIG.WRONG_PENALTY.toLocaleString() + '</b></span>' + tier + '</div>';
    const siteTag = q.loc
      ? '<div class="quiz-site">🏢 <b>' + esc(q.loc) + '</b> 근무자만 아는 문제입니다 — 팀의 ' + esc(q.loc) + ' 멤버에게 물어보세요!</div>'
      : '';
    const docBtns = (q.docs && q.docs.length)
      ? '<div class="quiz-docs">' + g.DOCVIEW.buttonsHTML(q.docs) + '</div>' : '';

    wrap.innerHTML = meta + siteTag +
      '<div class="quiz-q">' + esc(q.q).replace(/\n/g, '<br>') + '</div>' +
      (q.hint ? '<div class="quiz-hint">💡 ' + esc(q.hint) + '</div>' : '') +
      docBtns + '<div id="qhost"></div>';

    const m = modal({
      title: '📋 단서 ' + slot + ' · ' + (ROOMS[S.room] ? ROOMS[S.room].title : ''),
      html: wrap, closable: true,
      onMount: (body, back) => {
        if (q.docs && q.docs.length) g.DOCVIEW.bind(body, q.docs);

        const submit = (val, node) => {
          if (isSolved(S.room, slot)) { m.close(); toast('이미 해결한 단서입니다.', 'info'); return; }
          const ok = q.type === 'choice'
            ? (+val === q.ans)
            : answersOf(q).some(a => norm(a) === norm(val));
          if (ok) {
            if (node) node.classList.add('ok');
            SFX.great();
            g.QKIT.celebrate(back.querySelector('.modal'));
            onCorrect(q, slot, boss);
            setTimeout(() => m.close(), 900);
          } else {
            if (node) { node.classList.add('no'); setTimeout(() => node.classList.remove('no'), 600); }
            SFX.no();
            g.QKIT.shake(back.querySelector('.modal'));
            NET.addWrong(S.room, slot);
            toast('❌ 오답! -' + CONFIG.WRONG_PENALTY.toLocaleString() + '점', 'bad');
          }
        };
        g.QKIT.mount(q, body.querySelector('#qhost'), submit);
      }
    });
  }
  function norm(s) { return String(s).trim().toLowerCase().replace(/\s+/g, ''); }

  async function onCorrect(q, slot, boss) {
    const rem = roomRemain();
    const fresh = await NET.recordSolve(S.room, slot, {
      qid: q.id, points: q.score, room: S.room, left: Math.round(rem)
    });
    const who = boss || (BOSSES[ROOMS[S.room].boss] || {}).name || '';
    if (fresh) {
      toast('✅ 정답! +' + q.score.toLocaleString() + '점', 'good');
      say((q.ok || '정답!') + '\n(+' + q.score.toLocaleString() + '점)', who);
    } else {
      // 이미 서버에 기록된 단서 — 점수는 다시 오르지 않는다
      toast('이미 해결한 단서입니다. 점수는 추가되지 않습니다.', 'info', 3000);
      say('이미 해결한 단서다. 다른 곳을 찾아보자!', who);
    }
    if (S.clueApi && S.clueApi[slot]) S.clueApi[slot].refresh();
  }

  /* ============================================================
     방 종료 · 인터미션
     ============================================================ */
  async function finishRoom(reason) {
    if (S.ended) return;
    S.ended = true;
    g.UI.closeAll();
    const sec = Math.min(CONFIG.ROOM_SECONDS, Math.round(roomElapsed()));
    const cleared = reason === 'cleared';
    const bonus = cleared ? Math.round(CONFIG.TIME_BONUS_MAX * Math.max(0, (CONFIG.ROOM_SECONDS - sec)) / CONFIG.ROOM_SECONDS) : 0;
    await NET.recordRoomDone(S.room, { sec, bonus, reason, solved: solvedCount(S.room) });
    if (cleared) SFX.great(); else SFX.no();
    S.phase = 'intermission';
    showIntermission(reason);
  }

  function showIntermission(reason) {
    // 같은 창이 두 번 열려 관리자 패널을 덮는 것을 막는다
    if (S.waitModal && document.body.contains(S.waitModal.back)) return;
    const last = S.room >= CONFIG.ROOM_COUNT;

    /* 관리자는 통제 패널에서 모든 현황을 보므로 점수 창을 띄우지 않는다 */
    if (S.me.isAdmin) {
      clearLayers(); usePixelScene('lobby'); showTitle(last ? '최종 대기실' : '대기실');
      g.UI.bgmDown();
      drawLobbyCrowd();
      say(last ? '모든 관이 끝났습니다. 관리자 패널에서 결과를 발표하세요.'
               : S.room + '관이 끝났습니다. 관리자 패널에서 다음 방을 열어주세요.');
      toast(S.room + '관 완료 — 관리자 패널에서 진행하세요.', 'info', 2500);
      return;
    }

    const sc = NET.scoreOf(S.run);
    const rs = sc.rooms[S.room] || 0;
    const head = reason === 'timeout'
      ? '⏰ 시간 초과! ' + S.room + '관에서 탈출하지 못했다...'
      : '🚪 ' + S.room + '관 탈출 성공!';
    const html =
      '<p style="font-size:14px;margin-bottom:10px">' + esc(head) + '</p>' +
      '<div class="result-sum">' +
      '<div class="result-cell"><span>이 방 점수</span><b>' + rs.toLocaleString() + '</b></div>' +
      '<div class="result-cell"><span>누적 점수</span><b>' + sc.score.toLocaleString() + '</b></div>' +
      '<div class="result-cell"><span>푼 단서</span><b>' + solvedCount(S.room) + ' / ' + CONFIG.CLUES_PER_ROOM + '</b></div>' +
      '<div class="result-cell"><span>사용 시간</span><b>' + mmss(Math.round(roomElapsed())) + '</b></div>' +
      '</div>' +
      '<div id="im-live" class="wait-live"></div>' +
      '<div id="im-board"></div>' +
      '<p style="text-align:center;margin-top:10px;font-size:12px;color:#3f4453">' +
      (last ? '모든 방을 마쳤습니다. 관리자의 결과 발표를 기다려주세요!' : '다른 참가자들이 끝나면 다음 방이 열립니다.') + '</p>';

    clearLayers(); usePixelScene('lobby'); showTitle(last ? '최종 대기실' : '대기실');
    g.UI.bgmDown();        // 방을 마치고 대기실 → 배경음악 줄이기
    drawLobbyCrowd();
    say(last ? '모든 관을 통과했다! 결과 발표를 기다리자.' : S.room + '관을 마쳤다. 다음 방이 열릴 때까지 잠시 대기하자.');

    S.waitModal = modal({
      title: last ? '🎉 전 구간 완료' : '⏳ ' + S.room + '관 완료 — 대기 중',
      html, closable: !!S.me.isAdmin, wide: true, low: true,
      onClose: () => { S.waitModal = null; },
      onMount: (body) => { renderBoardInto(body.querySelector('#im-board')); updateWaitPanel(!!(S.global && S.global.phase === 'playing' && S.global.startAt)); },
      buttons: (S.me.isAdmin
        ? [{ label: '👑 관리자 패널 열기', cls: 'pk-btn-gold', close: false, onClick: () => g.ADMIN.open() }]
        : []
      ).concat([{ label: '💬 채팅 열기', cls: 'pk-btn-main', close: false, onClick: () => g.CHAT && g.CHAT.setOpen(true) }])
    });
  }

  /* ---------- 순위표 ---------- */
  function computeBoard() {
    const runs = S.allRuns || {};
    const rows = [];
    Object.keys(S.players || {}).forEach(u => {
      const p = S.players[u];
      if (!p || !p.uid || p.isAdmin) return;
      const sc = NET.scoreOf(runs[u]);
      rows.push({ uid: u, name: p.name, loc: p.loc, score: sc.score, time: sc.time, solved: sc.solved, online: !!p.online });
    });
    rows.sort((a, b) => b.score - a.score || a.time - b.time);
    return rows;
  }
  function renderBoardInto(node) {
    if (!node) return;
    node.innerHTML = '<h4 style="font-size:12px;color:#274a75;margin:8px 0 4px">🏆 실시간 순위</h4>' +
      g.UI.leaderboardHTML(computeBoard(), NET.uid);
  }
  function openBoard() {
    const m = modal({ title: '🏆 실시간 순위표', html: '<div id="bd"></div>', wide: true, closable: true });
    renderBoardInto(m.body.querySelector('#bd'));
    m.body._timer = setInterval(() => {
      if (!document.body.contains(m.body)) return clearInterval(m.body._timer);
      renderBoardInto(m.body.querySelector('#bd'));
    }, 3000);
  }

  /* ============================================================
     최종 결과
     ============================================================ */
  function showResults() {
    S.phase = 'results';
    clearInterval(S.timer);
    g.UI.closeAll();
    clearLayers(); usePixelScene('hall'); showTitle('결과 발표');
    g.UI.bgmDown(2500);
    const rows = computeBoard();
    const me = rows.findIndex(r => r.uid === NET.uid);
    const sc = NET.scoreOf(S.run);
    say('모든 방의 탈출이 끝났다!\n최종 순위를 확인하자.');
    SFX.great();

    // 무대 위 시상대 캐릭터
    const podPos = [[120, 132], [82, 138], [158, 138]];
    rows.slice(0, 3).forEach((r, i) => {
      const p = S.players[r.uid] || {};
      addActor(AVATARS[p.avatar] || AVATARS[0], podPos[i][0], podPos[i][1], ['🥇', '🥈', '🥉'][i] + ' ' + r.name, i === 0 ? 'me' : '', 3);
    });

    let podium = '<div class="podium">';
    [1, 0, 2].forEach(i => {
      const r = rows[i]; if (!r) return;
      const hgt = [64, 46, 36][i === 0 ? 0 : (i === 1 ? 1 : 2)];
      const col = ['#e8b83b', '#b9c0cc', '#c9925b'][i];
      podium += '<div class="podium-col"><div class="podium-name">' + esc(r.name) + '</div>' +
        '<div class="podium-score">' + r.score.toLocaleString() + 'P</div>' +
        '<div class="podium-bar" style="height:' + hgt + 'px;background:' + col + '">' + (i + 1) + '</div></div>';
    });
    podium += '</div>';

    const mine = '<div class="result-sum">' +
      '<div class="result-cell"><span>내 순위</span><b>' + (me < 0 ? '-' : (me + 1) + '위') + '</b></div>' +
      '<div class="result-cell"><span>총 점수</span><b>' + sc.score.toLocaleString() + '</b></div>' +
      '<div class="result-cell"><span>총 소요 시간</span><b>' + mmss(sc.time) + '</b></div>' +
      '<div class="result-cell"><span>맞춘 단서</span><b>' + sc.solved + '개</b></div></div>';

    let per = '<table class="pk-table"><thead><tr><th>방</th><th>점수</th><th>시간</th><th>단서</th></tr></thead><tbody>';
    for (let r = 1; r <= CONFIG.ROOM_COUNT; r++) {
      const rec = roomRec(r), d = rec.done || {};
      per += '<tr><td>' + r + '관</td><td>' + (sc.rooms[r] || 0).toLocaleString() + '</td><td>' +
        (d.sec != null ? mmss(d.sec) : '-') + '</td><td>' + Object.keys(rec.solves || {}).length + '/' + CONFIG.CLUES_PER_ROOM + '</td></tr>';
    }
    per += '</tbody></table>';

    modal({
      title: '🏁 최종 결과', wide: true, closable: true,
      html: podium + mine + '<h4 style="font-size:12px;color:#274a75;margin:10px 0 2px">📖 내 방별 기록</h4>' + per +
        '<h4 style="font-size:12px;color:#274a75;margin:10px 0 2px">🏆 전체 순위</h4>' + g.UI.leaderboardHTML(rows, NET.uid),
      buttons: (S.me.isAdmin
        ? [{ label: '👑 관리자 패널', cls: 'pk-btn-gold', close: false, onClick: () => g.ADMIN.open() }]
        : []
      ).concat([{ label: '💬 채팅 열기', cls: 'pk-btn-main', close: false, onClick: () => g.CHAT && g.CHAT.setOpen(true) }])
    });
  }

  /* ============================================================
     서버 상태 반영
     ============================================================ */
  function applyGlobal(gs) {
    S.global = gs;
    if (!gs) { renderLobby(); return; }

    // 전체 초기화 감지
    const tk = localStorage.getItem('s1fa.resetToken');
    if (gs.resetToken && String(gs.resetToken) !== tk) {
      localStorage.setItem('s1fa.resetToken', String(gs.resetToken));
      if (tk !== null) {           // 최초 접속이 아니면 = 관리자가 초기화한 것
        S.run = null;
        if (!S.me.isAdmin) {
          g.UI.closeAll();
          toast('관리자가 게임을 초기화했습니다.', 'info', 3000);
          setTimeout(() => g.BOOT.backToLogin(), 900);
          return;
        }
      }
    }

    if (gs.phase === 'results') { if (S.phase !== 'results') showResults(); return; }
    if (gs.phase === 'lobby') {
      if (S.phase !== 'lobby') { clearInterval(S.timer); renderLobby('관리자가 전원을 대기실로 불러 모았다.\n다음 안내를 기다리자!'); startTicker(); }
      return;
    }
    if (gs.phase === 'playing') {
      const target = gs.room || 1;
      if (roomDone(target)) {                       // 이미 이 방을 마친 사람
        if (S.phase !== 'intermission' || S.room !== target) { S.room = target; S.phase = 'intermission'; S.ended = true; showIntermission(roomRec(target).done.reason || 'cleared'); }
        return;
      }
      if (S.room !== target || S.phase !== 'playing') enterRoom(target);
    }
  }

  /* ============================================================
     시작
     ============================================================ */
  function boot(me) {
    S.me = me;
    $('#login-screen').classList.add('hidden');
    $('#game-screen').classList.remove('hidden');
    updateHUD();

    NET.onMyRun(run => {
      const before = S.run ? JSON.stringify(S.run.rooms || {}) : '';
      S.run = run;
      updateHUD();
      refreshClueStates();      // 서버 기록이 늦게 와도 푼 단서를 잠근다
      const after = run ? JSON.stringify(run.rooms || {}) : '';
      if (S.phase === 'playing' && allSolved(S.room) && before !== after) {
        say('단서를 모두 찾았다! 이제 나가는 문으로 가자 🚪');
      }
    });
    NET.onRuns(all => { S.allRuns = all; });
    NET.onPlayers(ps => {
      S.players = ps;
      if (S.phase === 'lobby' || S.phase === 'intermission') drawLobbyCrowd();
    });
    /* 팀이 없을 때 쓸 기본 출제 — 반드시 팀 구독보다 먼저 (팀 배정을 덮어쓰지 않도록) */
    assignQuizzes(hashSeed(NET.uid));

    NET.onTeams(t => {
      S.teams = t;
      const before = S.seed;
      assignQuizzes(teamSeedFor(t));
      S.myTeam = myTeamNo(t);
      updateHUD();
      if (g.CHAT) g.CHAT.refresh();
      // 관리자가 팀을 바꾸면 아직 못 푼 단서의 문제도 새 팀 기준으로 바뀐다
      if (S.phase === 'playing' && before !== S.seed) {
        toast('팀이 변경되어 출제 문제가 갱신되었습니다.', 'info', 3000);
      }
    });
    checkBank();                // 문제은행·자료 구성 점검 (콘솔 경고)
    renderLobby();              // 기본 화면을 먼저 그리고
    startTicker();
    if (g.CHAT) g.CHAT.init();  // 채팅 준비
    NET.onGlobal(applyGlobal);  // 그 다음 서버 상태를 반영한다 (순서 중요)
  }

  function hashSeed(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return (h % 99991) + 1; }
  /** 내가 속한 팀 번호 (없으면 null) */
  function myTeamNo(t) {
    const list = (t && t.list) || [];
    for (let i = 0; i < list.length; i++) {
      if ((list[i].members || []).some(m => m.uid === NET.uid)) return list[i].id || (i + 1);
    }
    return null;
  }
  /** 팀이 정해져 있으면 팀 번호로, 아니면 개인 고유값으로 출제 시드를 만든다.
   *  같은 팀이면 어느 기기에서 접속하든 항상 같은 문제가 나온다. */
  function teamSeedFor(t) {
    const no = myTeamNo(t);
    if (no != null) return no * 1013 + 7;
    return hashSeed(NET.uid);
  }

  g.GAME = {
    S, boot, enterRoom, renderLobby, showResults, openBoard, computeBoard,
    applyGlobal, finishRoom, assignQuizzes, siteForRoom, answersOf, teamCode, updateHUD,
    myTeamNo, teamSeedFor, placeExit
  };
})(window);
