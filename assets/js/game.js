/* ============================================================
   game.js — 게임 본체 (씬 구성 · 기믹 · 타이머 · 채점)
   ============================================================ */
(function (g) {
  'use strict';
  const { $, $$, el, esc, modal, toast, say, mmss, SFX } = g.UI;
  const { CONFIG, AVATARS, BOSSES, BANK, ROOMS } = g.DATA;

  /* 시퀀스 기믹 좌표 (씬 픽셀 기준) */
  const SEQ_SPOTS = {
    1: { 'mon-l': [28, 62, 32, 25], 'mon-c': [72, 56, 40, 31], 'mon-r': [124, 62, 32, 25] },
    4: { 'v1': [210, 78, 24, 11], 'v2': [210, 90, 24, 11], 'v3': [210, 101, 24, 11] }
  };

  const S = {
    me: null, global: null, run: null, players: {}, teams: null,
    room: 0, phase: 'boot', quizzes: {}, seed: 1,
    gate: {}, clueApi: {}, bossEl: null, waitModal: null, timer: null, ended: false, lastRoomRendered: null
  };

  /* ---------- 좌표 (배경 그림 기준 백분율) ---------- */
  const pctX = v => (v / PX.W * 100) + '%';
  const pctY = v => (v / PX.H * 100) + '%';

  /** rect = [왼쪽%, 위%, 너비%, 높이%] */
  function placePct(node, r) {
    node.style.left = r[0] + '%'; node.style.top = r[1] + '%';
    node.style.width = r[2] + '%'; node.style.height = r[3] + '%';
  }

  /* ---------- 문제 배정 (팀 시드 기반, 재현 가능) ---------- */
  function lcg(seed) { let s = (seed >>> 0) || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  function assignQuizzes(seed) {
    S.seed = seed;
    const out = {};
    for (let r = 1; r <= CONFIG.ROOM_COUNT; r++) {
      const rand = lcg(seed * 7919 + r * 104729);
      const pool = BANK[r].slice();
      const pick = [];
      while (pick.length < CONFIG.CLUES_PER_ROOM && pool.length) {
        pick.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
      }
      out[r] = pick;
    }
    S.quizzes = out;
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
    const sc = NET.scoreOf(S.run);
    $('#hud-score').textContent = sc.score.toLocaleString() + ' P';
    $('#hud-player').textContent = (S.me.isAdmin ? '👑 ' : '') + S.me.name + (S.me.loc ? ' · ' + S.me.loc : '');
    const dots = [];
    for (let i = 0; i < CONFIG.CLUES_PER_ROOM; i++) dots.push(i < solvedCount(S.room) ? '●' : '○');
    $('#hud-clues').textContent = S.room ? dots.join('') : '- - -';
    $('#hud-room').textContent = S.room ? (ROOMS[S.room] ? ROOMS[S.room].full : '') : '대기실';
    $('#btn-admin').classList.toggle('hidden', !S.me.isAdmin);
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
    const st = $('#stage'); if (st) st.style.aspectRatio = '3 / 2';
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

  function addActor(avatarOpts, x, yFeet, tag, cls, scale) {
    const a = g.UI.actorEl(avatarOpts, tag, cls, scale || 3);
    const c = a.querySelectorAll('canvas');
    const uw = (c[0] && +c[0].dataset.uw) || PX.CH_W;
    const uh = (c[0] && +c[0].dataset.uh) || PX.CH_H;
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
    say(msg || '대기실이다. 관리자가 게임을 시작할 때까지 기다리자!\n다른 참가자들도 속속 도착하고 있다.');
    drawLobbyCrowd();
  }
  function drawLobbyCrowd() {
    if (S.phase !== 'lobby' && S.phase !== 'intermission') return;
    const layer = $('#actor-layer');
    $$('.actor', layer).forEach(a => clearInterval(a._anim));
    layer.innerHTML = '';
    const list = Object.values(S.players || {})
      .filter(p => p && p.uid && p.online && !p.isAdmin)
      .slice(0, 18);
    // 나
    addActor(AVATARS[S.me.avatar] || AVATARS[0], 40, 152, S.me.name + ' (나)', 'me', 3);
    let i = 0;
    list.forEach(p => {
      if (p.uid === NET.uid) return;
      const col = i % 6, row = Math.floor(i / 6);
      const x = 78 + col * 26 + (row % 2) * 13;
      const y = 122 + row * 13;
      addActor(AVATARS[p.avatar] || AVATARS[0], x, Math.min(y, 156), p.name, '', 2);
      i++;
    });
    const total = Object.values(S.players || {}).filter(p => p && p.uid && !p.isAdmin).length;
    const badge = el('div', 'actor-tag', '👥 접속 ' + total + '명');
    badge.style.cssText += 'position:absolute;left:4%;top:6%;font-size:10px';
    layer.appendChild(badge);
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
      stage.style.aspectRatio = '3 / 2';
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
    g.UI.bgmUp();          // 방 시작 → 배경음악 다시 올리기

    /* 방 담당자 */
    S.bossEl = addBoss(R);

    /* 살펴보기 지점 */
    (R.hints || []).forEach(h => addHotspot(h.at, () => { SFX.select(); say(h.msg, '👀 살펴보기'); }, h.label || '살펴보기', 'look'));

    /* 함정(낚시) */
    (R.traps || []).forEach(t => {
      addHotspot(t.at, () => {
        SFX.trap();
        say(t.msg, '🎣 …');
        if (t.cost) { NET.addTrap(S.room); toast('함정! -' + CONFIG.TRAP_PENALTY + '점', 'bad'); }
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
    const meta = '<div class="quiz-meta"><span>단서 <b>' + (idx + 1) + '/' + CONFIG.CLUES_PER_ROOM + '</b></span>' +
      '<span>배점 <b>' + q.score.toLocaleString() + '점</b></span>' +
      '<span>오답 <b>-' + CONFIG.WRONG_PENALTY.toLocaleString() + '</b></span></div>';
    let inner = meta + '<div class="quiz-q">' + esc(q.q) + '</div>';
    if (q.type === 'short') {
      if (q.hint) inner += '<div class="quiz-hint">💡 ' + esc(q.hint) + '</div>';
      inner += '<div class="quiz-input-row"><input id="qin" class="pk-input" type="text" maxlength="24" placeholder="정답 입력 후 Enter"><button id="qsub" class="pk-btn pk-btn-main">제출</button></div>';
    } else {
      inner += '<div class="quiz-choices">' + q.choices.map((c, i) =>
        '<button class="quiz-choice" data-i="' + i + '">' + (i + 1) + '. ' + esc(c) + '</button>').join('') + '</div>';
    }
    wrap.innerHTML = inner;

    const m = modal({
      title: '📋 단서 ' + slot + ' · ' + (ROOMS[S.room] ? ROOMS[S.room].title : ''),
      html: wrap, closable: true,
      onMount: (body) => {
        const submit = (val, node) => {
          const ok = q.type === 'short'
            ? q.ans.some(a => norm(a) === norm(val))
            : (+val === q.ans);
          if (isSolved(S.room, slot)) { m.close(); toast('이미 해결한 단서입니다.', 'info'); return; }
          if (ok) {
            if (node) node.classList.add('ok');
            SFX.great();
            onCorrect(q, slot, boss);
            setTimeout(() => m.close(), 420);
          } else {
            if (node) { node.classList.add('no'); setTimeout(() => node.classList.remove('no'), 600); }
            SFX.no();
            NET.addWrong(S.room, slot);
            toast('❌ 오답! -' + CONFIG.WRONG_PENALTY.toLocaleString() + '점', 'bad');
          }
        };
        if (q.type === 'short') {
          const i = body.querySelector('#qin');
          setTimeout(() => i.focus(), 80);
          i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(i.value, null); });
          body.querySelector('#qsub').onclick = () => submit(i.value, null);
        } else {
          body.querySelectorAll('.quiz-choice').forEach(b => b.onclick = () => submit(b.dataset.i, b));
        }
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
      buttons: S.me.isAdmin ? [{ label: '👑 관리자 패널 열기', cls: 'pk-btn-gold', onClick: () => g.ADMIN.open() }] : []
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
      buttons: S.me.isAdmin ? [{ label: '👑 관리자 패널', cls: 'pk-btn-gold', onClick: () => g.ADMIN.open() }] : []
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
    NET.onTeams(t => {
      S.teams = t;
      const seed = teamSeedFor(t);
      assignQuizzes(seed);
    });
    assignQuizzes(hashSeed(NET.uid));
    renderLobby();              // 기본 화면을 먼저 그리고
    startTicker();
    NET.onGlobal(applyGlobal);  // 그 다음 서버 상태를 반영한다 (순서 중요)
  }

  function hashSeed(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return (h % 99991) + 1; }
  function teamSeedFor(t) {
    if (t && t.list) {
      const list = t.list;
      for (let i = 0; i < list.length; i++) {
        if ((list[i].members || []).some(m => m.uid === NET.uid)) return (list[i].id || (i + 1)) * 1013 + 7;
      }
    }
    return hashSeed(NET.uid);
  }

  g.GAME = {
    S, boot, enterRoom, renderLobby, showResults, openBoard, computeBoard,
    applyGlobal, finishRoom, assignQuizzes, teamCode, updateHUD
  };
})(window);
