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
    gate: {}, timer: null, held: null, ended: false, lastRoomRendered: null
  };

  /* ---------- 좌표 변환 ---------- */
  const pctX = v => (v / PX.W * 100) + '%';
  const pctY = v => (v / PX.H * 100) + '%';

  function placeRect(node, r) {
    node.style.left = pctX(r[0]); node.style.top = pctY(r[1]);
    node.style.width = pctX(r[2]); node.style.height = pctY(r[3]);
  }
  function placeProp(node, at, size) {
    node.style.left = pctX(at[0]); node.style.top = pctY(at[1]);
    node.style.width = pctX(size); node.style.height = pctY(size);
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
    if (S.phase !== 'playing' || !S.global || !S.global.startAt) {
      rt.textContent = mmss(CONFIG.ROOM_SECONDS);
      rt.classList.remove('is-warn');
    } else {
      const rem = roomRemain();
      rt.textContent = mmss(rem);
      rt.classList.toggle('is-warn', rem <= 30);
      if (rem <= 30 && rem > 29.5) SFX.warn();
      if (rem <= 0 && !S.ended) finishRoom('timeout');
    }
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
      $$('.prop', l).forEach(p => p._cleanup && p._cleanup());
      l.innerHTML = '';
    });
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
    a.style.left = pctX(x - PX.CH_W / 2);
    a.style.top = pctY(yFeet - PX.CH_H);
    a.style.width = pctX(PX.CH_W);
    const c = a.querySelectorAll('canvas');
    c.forEach(cc => { cc.style.width = '100%'; cc.style.height = 'auto'; });
    $('#actor-layer').appendChild(a);
    return a;
  }
  function addProp(name, at, size, opts) {
    opts = opts || {};
    const d = el('div', 'prop');
    d.appendChild(PX.propCanvas(name, 4));
    placeProp(d, at, size || 22);
    if (opts.z) d.style.zIndex = opts.z;
    $('#prop-layer').appendChild(d);
    return d;
  }
  function addHotspot(rect, onClick, title) {
    const h = el('div', 'hotspot');
    placeRect(h, rect);
    if (title) h.title = title;
    h.addEventListener('click', e => { e.stopPropagation(); onClick(h); });
    $('#prop-layer').appendChild(h);
    return h;
  }
  function addSparkle(rect) {
    const s = el('div', 'sparkle', '✨');
    s.style.left = pctX(rect[0] + rect[2] / 2);
    s.style.top = pctY(rect[1] - 2);
    $('#fx-layer').appendChild(s);
    return s;
  }

  /* ============================================================
     대기실 / 인터미션 씬
     ============================================================ */
  function renderLobby(msg) {
    S.phase = 'lobby'; S.room = 0; S.ended = false;
    clearLayers(); renderScene('lobby'); showTitle('대기실');
    updateHUD();
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
      const x = 74 + col * 26 + (row % 2) * 12;
      const y = 116 + row * 15;
      addActor(AVATARS[p.avatar] || AVATARS[0], x, Math.min(y, 156), p.name, '', 2);
      i++;
    });
    const total = Object.values(S.players || {}).filter(p => p && p.uid && !p.isAdmin).length;
    const badge = el('div', 'actor-tag', '👥 접속 ' + total + '명');
    badge.style.cssText += 'position:absolute;left:4%;top:6%;font-size:10px';
    layer.appendChild(badge);
  }

  /* ============================================================
     방 입장
     ============================================================ */
  function enterRoom(n) {
    const R = ROOMS[n]; if (!R) return;
    S.room = n; S.phase = 'playing'; S.ended = false; S.held = null;
    S.gate = {};
    g.UI.closeAll();
    clearLayers();
    renderScene(R.scene);
    showTitle(R.banner);
    updateHUD();
    say(R.welcome, R.full);
    SFX.door();

    /* NPC */
    const boss = BOSSES[R.boss];
    const bossActor = addActor(boss, R.bossAt[0], R.bossAt[1], boss.name, 'boss', 3);
    addActor(AVATARS[S.me.avatar] || AVATARS[0], R.playerAt[0], R.playerAt[1], S.me.name, 'me', 3);

    /* 고정 소품 */
    (R.decor || []).forEach(d => addProp(d.prop, d.at, d.size || 20, { z: 6 }));

    /* 힌트 지점 (화이트보드 등) */
    (R.hints || []).forEach(h => addHotspot(h.at, () => { SFX.select(); say(h.msg, '📋 메모'); }, '살펴보기'));

    /* 함정(낚시) */
    (R.traps || []).forEach(t => {
      const p = addProp(t.prop, t.at, t.size || 20);
      const fire = () => {
        SFX.trap();
        say(t.msg, '🎣 …');
        if (t.cost) {
          NET.addTrap(S.room);
          toast('함정! -' + CONFIG.TRAP_PENALTY + '점', 'bad');
        }
      };
      if (t.drag) PUZZLE.makeDraggable(p, $('#stage'), { onMoved: () => { p.classList.add('gone'); fire(); }, onTap: fire });
      else p.addEventListener('click', fire);
    });

    /* 단서 3개 */
    R.clues.forEach((c, idx) => buildClue(R, c, idx));

    /* 문 */
    buildDoor(R);
    startTicker();

    /* 이미 시간이 지난 상태로 들어왔다면 즉시 종료 처리 */
    if (roomRemain() <= 0) finishRoom('timeout');
  }

  /* ---------- 문 ---------- */
  function buildDoor(R) {
    const d = addHotspot(R.doorAt, () => {
      if (!allSolved(S.room)) {
        SFX.no();
        say('문이 잠겨 있다. 이 방의 단서 ' + CONFIG.CLUES_PER_ROOM + '개를 모두 풀어야 열린다!\n(현재 ' + solvedCount(S.room) + '/' + CONFIG.CLUES_PER_ROOM + ')');
        return;
      }
      finishRoom('cleared');
    }, '다음 방으로');
    d.id = 'door-hot';
    refreshDoor();
  }
  function refreshDoor() {
    const d = $('#door-hot'); if (!d) return;
    const open = allSolved(S.room);
    let tag = $('#door-tag');
    if (!tag) {
      tag = el('div', 'actor-tag', '');
      tag.id = 'door-tag';
      tag.style.cssText += 'position:absolute;z-index:30';
      $('#fx-layer').appendChild(tag);
    }
    const R = ROOMS[S.room]; if (!R) return;
    tag.style.left = pctX(R.doorAt[0] - 4);
    tag.style.top = pctY(R.doorAt[1] + R.doorAt[3] / 2 - 5);
    tag.textContent = open ? (S.room === CONFIG.ROOM_COUNT ? '🎉 최종 탈출!' : '🚪 ' + (S.room + 1) + '관으로') : '🔒 잠김';
    tag.style.background = open ? '#2e8b4f' : '#fbfbf7';
    tag.style.color = open ? '#fff' : '#1d2029';
    if (open && !$('#door-spark')) { const s = addSparkle(R.doorAt); s.id = 'door-spark'; }
  }

  /* ============================================================
     단서 · 기믹 구성
     ============================================================ */
  function buildClue(R, clue, idx) {
    const slot = clue.slot;
    const quiz = S.quizzes[S.room][idx];
    const done = isSolved(S.room, slot);
    const gate = clue.gate;
    let opened = done;      // 기믹 통과 여부

    const openQuiz = () => {
      if (isSolved(S.room, slot)) { SFX.select(); say('이미 해결한 단서다. 다른 곳을 찾아보자!'); return; }
      askQuiz(quiz, slot, idx);
    };

    /* 단서 자리(hotspot) */
    let hot = null;
    if (clue.hotspot) {
      hot = addHotspot(clue.hotspot, () => {
        if (isSolved(S.room, slot)) { SFX.select(); say('✅ 이미 해결한 단서다.'); return; }
        if (!opened) { runGate(); return; }
        openQuiz();
      }, clue.label);
      if (done) hot.classList.add('solved');
    }

    const markOpen = (msg) => {
      opened = true;
      if (msg) say(msg, '🔎 단서 발견');
      SFX.great();
      if (clue.hotspot && !isSolved(S.room, slot)) addSparkle(clue.hotspot);
      if (clue.prop) addProp(clue.prop, [clue.hotspot[0] + 2, clue.hotspot[1]], 16, { z: 15 });
      setTimeout(openQuiz, 500);
    };

    /* ----- 기믹 종류별 구성 ----- */
    function runGate() {
      switch (gate.type) {
        case 'wire':
          say(gate.before); PUZZLE.wire(gate.pairs || 3, () => markOpen(gate.after)); break;
        case 'wipe':
          say(gate.before); PUZZLE.wipe(gate.code, () => markOpen(gate.after)); break;
        case 'dial':
          say(gate.before); PUZZLE.dial(gate.target, gate.tol, gate.hint, () => markOpen(gate.after)); break;
        case 'keypad': {
          if (gate.needFirst && !isSolved(S.room, gate.needFirst) && !S.gate['note' + gate.needFirst]) {
            SFX.no(); say(gate.needFirstMsg); return;
          }
          say(gate.before); PUZZLE.keypad(teamCode(), () => markOpen(gate.after)); break;
        }
        case 'talk': case 'drag': case 'sequence': case 'pickOne': case 'twoStep':
        case 'collect': case 'clearAll':
          say(gate.before); break;
        default: openQuiz();
      }
    }

    if (done) { /* 이미 푼 단서는 기믹 재구성 불필요 */ }

    if (gate.type === 'drag' && !done) {
      const p = addProp(gate.prop, gate.at, gate.size || 22, { z: 18 });
      say0(gate.before);
      PUZZLE.makeDraggable(p, $('#stage'), {
        onMoved: () => { p.classList.add('gone'); markOpen(gate.after); },
        onTap: () => { SFX.move(); say('꽤 무겁다. 끌어서 치워보자! (드래그)'); }
      });
    }

    if (gate.type === 'sequence' && !done) {
      const spots = SEQ_SPOTS[S.room] || {};
      let step = 0;
      gate.targets.forEach((name, i) => {
        const rect = spots[name]; if (!rect) return;
        addHotspot(rect, (node) => {
          if (opened) return;
          if (gate.order[step] === i) {
            step++; SFX.ok();
            node.style.background = 'rgba(255,255,255,.35)';
            if (step >= gate.order.length) { markOpen(gate.after); }
            else say('찰칵! (' + step + '/' + gate.order.length + ') 다음 순서를 눌러보자.');
          } else {
            step = 0; SFX.no();
            $$('.hotspot').forEach(n => n.style.background = '');
            say('삐— 순서가 틀렸다! 처음부터 다시.\n' + (gate.hint || ''));
          }
        }, '눌러보기');
      });
    }

    if (gate.type === 'pickOne' && !done) {
      const base = clue.hotspot;
      const w = base[2] / gate.options;
      for (let i = 0; i < gate.options; i++) {
        addHotspot([base[0] + i * w, base[1], w - 1, base[3]], () => {
          if (opened) return;
          if (i === gate.correct - 1) markOpen(gate.after);
          else { SFX.trap(); say(gate.wrong, '🎣 …'); }
        }, (i + 1) + '번째 서랍');
      }
    }

    if (gate.type === 'twoStep' && !done) {
      const s1 = gate.step1;
      const cup = addProp(s1.prop, s1.at, s1.size || 14, { z: 20 });
      let hasCup = false;
      const pick = () => { hasCup = true; cup.classList.add('gone'); SFX.select(); say(s1.msg); };
      PUZZLE.makeDraggable(cup, $('#stage'), { onTap: pick, onMoved: pick });
      if (hot) {
        hot.title = '커피머신';
        hot.addEventListener('click', () => {
          if (opened || isSolved(S.room, slot)) return;
          if (!hasCup) { SFX.no(); say('컵이 없다! 먼저 종이컵을 찾아 집어오자.'); }
          else markOpen(gate.step2Msg);
        });
      }
    }

    if (gate.type === 'collect' && !done) {
      let n = 0;
      const target = gate.target;
      addProp('tray', [target[0], target[1]], 26, { z: 8 });
      gate.props.forEach((pn, i) => {
        const p = addProp(pn, gate.at[i], 16, { z: 20 });
        PUZZLE.makeDraggable(p, $('#stage'), {
          onDrop: (dist, node) => {
            const st = $('#stage').getBoundingClientRect();
            const r = node.getBoundingClientRect();
            const cx = (r.left + r.width / 2 - st.left) / st.width * PX.W;
            const cy = (r.top + r.height / 2 - st.top) / st.height * PX.H;
            const inTray = cx > target[0] - 6 && cx < target[0] + target[2] + 6 && cy > target[1] - 10 && cy < target[1] + target[3] + 12;
            if (inTray) {
              node.classList.add('gone'); n++; SFX.ok();
              if (n >= gate.props.length) markOpen(gate.after);
              else say('시편을 트레이에 담았다. (' + n + '/' + gate.props.length + ')');
            } else if (dist > 20) { SFX.move(); say('트레이 위에 정확히 올려놓아야 한다!'); }
            else { SFX.select(); say('정밀 시편이다. 트레이로 옮기자. (드래그)'); }
          }
        });
      });
    }

    if (gate.type === 'clearAll' && !done) {
      let n = 0;
      gate.props.forEach((pn, i) => {
        const p = addProp(pn, gate.at[i], 14, { z: 20 - i });
        PUZZLE.makeDraggable(p, $('#stage'), {
          onMoved: (node) => {
            node.classList.add('gone'); n++; SFX.move();
            if (n >= gate.props.length) {
              S.gate['note' + slot] = true;
              markOpen(gate.after + '\n쪽지에 적힌 번호: ' + teamCode());
            } else say('컵을 치웠다. (' + n + '/' + gate.props.length + ')');
          },
          onTap: () => { SFX.select(); say('종이컵이다. 끌어서 치워보자! (드래그)'); }
        });
      });
    }

    if (gate.type === 'talk' && !done) {
      const bossActor = $$('.actor', $('#actor-layer')).find(a => a.querySelector('.actor-tag.boss'));
      if (bossActor) {
        bossActor.style.pointerEvents = 'auto';
        bossActor.style.cursor = 'pointer';
        bossActor.addEventListener('click', () => {
          if (isSolved(S.room, slot)) { say('파트장님: 잘 하고 있어요! 계속 진행하세요.', BOSSES[R.boss].name); return; }
          g.UI.bubble(bossActor, '!');
          markOpen('파트장님이 문제를 내주셨다!');
        });
      }
      const rect = [R.bossAt[0] - 14, R.bossAt[1] - 36, 28, 36];
      addHotspot(rect, () => {
        if (isSolved(S.room, slot)) { say('파트장님: 계속 진행하세요!', BOSSES[R.boss].name); return; }
        markOpen('파트장님이 문제를 내주셨다!');
      }, '말 걸기');
    }

    function say0(t) { if (idx === 0) setTimeout(() => say(R.welcome + '\n\n' + t), 900); }
  }

  /* ============================================================
     퀴즈
     ============================================================ */
  function askQuiz(q, slot, idx) {
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
      title: '📋 단서 ' + slot + ' — ' + (ROOMS[S.room] ? ROOMS[S.room].title : ''),
      html: wrap, closable: true,
      onMount: (body) => {
        const submit = (val, node) => {
          const ok = q.type === 'short'
            ? q.ans.some(a => norm(a) === norm(val))
            : (+val === q.ans);
          if (ok) {
            if (node) node.classList.add('ok');
            SFX.great();
            onCorrect(q, slot);
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

  async function onCorrect(q, slot) {
    const rem = roomRemain();
    await NET.recordSolve(S.room, slot, { qid: q.id, points: q.score, room: S.room, left: Math.round(rem) });
    toast('✅ 정답! +' + q.score.toLocaleString() + '점', 'good');
    say((q.ok || '정답!') + '\n(+' + q.score.toLocaleString() + '점)', BOSSES[ROOMS[S.room].boss].name);
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
      '<div id="im-board"></div>' +
      '<p style="text-align:center;margin-top:10px;font-size:12px;color:#3f4453">' +
      (last ? '모든 방을 마쳤습니다. 관리자의 결과 발표를 기다려주세요!' : '관리자가 다음 방을 열어줄 때까지 대기실에서 기다려주세요...') + '</p>';

    clearLayers(); renderScene('lobby'); showTitle(last ? '최종 대기실' : '대기실');
    drawLobbyCrowd();
    say(last ? '모든 관을 통과했다! 결과 발표를 기다리자.' : S.room + '관을 마쳤다. 다음 방이 열릴 때까지 잠시 대기하자.');

    modal({
      title: last ? '🎉 전 구간 완료' : '⏳ ' + S.room + '관 완료 — 대기 중',
      html, closable: !!S.me.isAdmin, wide: true,
      onMount: (body) => { renderBoardInto(body.querySelector('#im-board')); },
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
    clearLayers(); renderScene('hall'); showTitle('결과 발표');
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
      S.run = run;
      updateHUD(); refreshDoor();
      if (S.phase === 'playing' && allSolved(S.room)) {
        say('단서를 모두 찾았다! 이제 문으로 가자 🚪');
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
    NET.onGlobal(applyGlobal);
    startTicker();
    renderLobby();
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
