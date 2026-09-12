/* ============================================================
   chat.js — 채팅
   · 방 안 : 같은 팀끼리만
   · 대기실 : [우리 팀] 과 [전체] 두 개의 대화창
   · 관리자 : 전체 대화 + 원하는 팀의 대화를 골라 볼 수 있음
   ============================================================ */
(function (g) {
  'use strict';
  const { $, el, esc, toast, SFX } = g.UI;

  const MAX_LEN = 100;          // 한 번에 보낼 수 있는 글자 수
  const COOLDOWN = 1200;        // 연속 전송 간격(ms)

  const S = {
    open: false,
    min: false,                 // 접힘 상태 (입력칸만 남김)
    tab: 'team',                // 'team' | 'global'
    subs: {},                   // 채널별 구독 해제 함수
    msgs: {},                   // 채널별 메시지
    seen: {},                   // 채널별로 읽은 개수
    lastSent: 0,
    built: false,
    box: null,                  // {x,y,w,h} — 끌어서 옮긴 위치와 크기
    userSet: false,             // 사용자가 직접 옮기거나 크기를 바꿨는지
    maxed: false,               // 크게 보기
    min: false,                 // 접힘 (입력칸만 남김)
    prevH: ''                   // 접기 전 높이 (펼칠 때 되돌린다)
  };
  const MIN_BAR = 104;          // 접었을 때 높이 (머리말 + 입력칸)

  const myTeam = () => (g.GAME && g.GAME.S ? g.GAME.S.myTeam : null);
  const isAdmin = () => !!(g.GAME && g.GAME.S && g.GAME.S.me && g.GAME.S.me.isAdmin);
  const inRoom = () => !!(g.GAME && g.GAME.S && g.GAME.S.phase === 'playing');

  const teamIds = () => (((g.GAME.S.teams || {}).list) || []).map(t => t.id);

  /** 지금 화면에서 쓸 수 있는 채널 목록 */
  function channels() {
    if (isAdmin()) {
      // 관리자는 전체 대화와 모든 팀 대화를 볼 수 있다
      return [{ key: 'global', path: 'global', label: '전체' }].concat(
        teamIds().map(id => ({ key: 'team' + id, path: 'team/' + id, label: id + '팀' }))
      );
    }
    const list = [];
    const t = myTeam();
    if (t != null) list.push({ key: 'team', path: 'team/' + t, label: '우리 팀(' + t + '팀)' });
    if (!inRoom()) list.push({ key: 'global', path: 'global', label: '전체' });
    return list;
  }
  function pathOf(key) {
    const c = channels().find(x => x.key === key);
    return c ? c.path : null;
  }

  /* ============================================================
     창 위치·크기 (끌어서 옮기기 / 크기 조절)
     · 기기마다 따로 기억한다
     ============================================================ */
  const BOX_KEY = 's1fa.chatbox';
  const MIN_W = 260, MIN_H = 240;
  const WIDE = 760;             // 이 폭부터 "옆에 띄우기" — style.css 의 760px 과 맞춘다

  /** 게임 화면을 가리지 않는 자리를 먼저 찾는다 */
  function defaultBox() {
    const vw = innerWidth, vh = innerHeight;
    const app = document.getElementById('app');
    const rectOf = () => app ? app.getBoundingClientRect()
                             : { top: 0, bottom: vh, left: 0, right: vw };
    let r = rectOf();

    if (vw > WIDE) {
      const w = Math.min(Math.max(MIN_W, Math.round(vw * 0.3)), 460);
      const h = Math.min(Math.max(MIN_H, Math.round(vh * 0.72)), 680);
      // 게임이 비켜 줄 폭을 먼저 정하고 나서 게임 위치를 다시 잰다.
      // (아주 넓은 화면에서는 비켜 주지 않으므로 게임이 가운데로 돌아온다)
      reserve(w);
      r = rectOf();
      // 게임 오른쪽에 자리가 남으면 거기에 — 단, 게임 바로 옆에 붙여서
      // 넓은 모니터에서 화면 양끝으로 갈라져 보이지 않게 한다
      if (vw - r.right >= w + 20) {
        return {
          x: Math.round(Math.min(vw - w - 12, r.right + 16)),
          y: Math.round((vh - h) / 2), w, h
        };
      }
      return { x: vw - w - 14, y: vh - h - 14, w, h };
    }

    // 좁은 화면 — 게임 아래 남는 자리에 (chat-open 이 붙어 게임이 위로 올라간 뒤 계산된다)
    const below = Math.floor(vh - r.bottom - 10);
    if (below >= MIN_H) {
      return { x: 6, y: Math.round(r.bottom + 6), w: vw - 12, h: below };
    }
    const h = Math.min(Math.round(vh * 0.55), vh - 12);
    return { x: 6, y: vh - h - 6, w: vw - 12, h };
  }
  function loadBox() {
    try {
      const b = JSON.parse(localStorage.getItem(BOX_KEY) || 'null');
      if (b && b.w > 0 && b.h > 0) {
        // 지난번에 직접 잡아 둔 자리다. 그때처럼 게임 화면은 자리를 비켜 주지 않는다.
        // (안 그러면 사용자가 옮겨 둔 채팅창 때문에 게임·창이 계속 한쪽으로 밀린다)
        S.userSet = true;
        document.body.classList.add('chat-free');
        return b;
      }
    } catch (e) { }
    return null;
  }
  function saveBox(b) {
    S.userSet = true;
    // 사용자가 자리를 직접 잡았으니 게임 화면은 더 이상 자리를 비켜 주지 않는다
    document.body.classList.add('chat-free');
    try { localStorage.setItem(BOX_KEY, JSON.stringify(b)); } catch (e) { }
  }

  /** 화면 밖으로 나가지 않게 다듬는다 */
  function clampBox(b) {
    const vw = innerWidth, vh = innerHeight;
    // 화면이 최소 크기보다도 작으면 화면에 맞춘다 (밖으로 삐져나가지 않게)
    const minW = Math.min(MIN_W, vw - 8), minH = Math.min(MIN_H, vh - 8);
    const w = Math.max(minW, Math.min(b.w, vw - 8));
    const h = Math.max(minH, Math.min(b.h, vh - 8));
    return {
      w, h,
      x: Math.max(4, Math.min(b.x, vw - w - 4)),
      y: Math.max(4, Math.min(b.y, vh - h - 4))
    };
  }
  /** @param recompute 사용자가 손대지 않았다면 기본 자리를 다시 계산한다 */
  function applyBox(recompute) {
    const p = $('#chat-panel'); if (!p) return;
    if (recompute && !S.userSet) S.box = null;
    if (S.min) {                       // 접힌 동안에는 자리만 잡고 높이는 건드리지 않는다
      const b = clampBox(S.box || loadBox() || defaultBox());
      Object.assign(p.style, { left: b.x + 'px', top: b.y + 'px',
        width: b.w + 'px', height: MIN_BAR + 'px', right: 'auto', bottom: 'auto' });
      reserve(b.w);
      return;
    }
    if (S.maxed) {
      const vw = innerWidth, vh = innerHeight;
      Object.assign(p.style, { left: '8px', top: '8px',
        width: (vw - 16) + 'px', height: (vh - 16) + 'px', right: 'auto', bottom: 'auto' });
      return;
    }
    S.box = clampBox(S.box || loadBox() || defaultBox());
    Object.assign(p.style, { left: S.box.x + 'px', top: S.box.y + 'px',
      width: S.box.w + 'px', height: S.box.h + 'px', right: 'auto', bottom: 'auto' });
    reserve(S.box.w);
  }

  /** 게임 화면이 오른쪽에 비워 둘 폭 — 채팅창 실제 너비에 맞춘다.
      화면이 아주 넓어서 가운데 그대로 두어도 채팅창이 옆에 들어가면 비켜 주지 않는다.
      (안 그러면 창·게임·채팅이 넓은 화면 양끝으로 갈라져 보인다) */
  const APP_MAX = 900;          // #app 의 최대 폭 (style.css 와 같이 맞춘다)
  function reserve(w) {
    const app = document.getElementById('app');
    const appW = Math.min(app ? app.offsetWidth || APP_MAX : APP_MAX, APP_MAX);
    const need = w + 24;
    const free = (innerWidth - appW) / 2;      // 가운데 정렬일 때 한쪽에 남는 폭
    document.documentElement.style.setProperty('--chat-reserve',
      (free >= need ? 0 : need) + 'px');
  }
  function toggleMax() {
    S.maxed = !S.maxed;
    if (S.maxed) { S.min = false; setMinClass(false); }   // 크게 볼 때는 펼친다
    $('#chat-panel').classList.toggle('is-max', S.maxed);
    document.body.classList.toggle('chat-free', S.maxed || S.userSet);
    applyBox();
  }

  /* ---------------- 접기 / 펼치기 ----------------
     접으면 입력칸만 남아 게임 화면을 거의 가리지 않는다.
     크기는 인라인으로 잡혀 있으므로, 접기 전 높이를 기억했다가 되돌린다. */
  function setMinClass(v) {
    const p = $('#chat-panel'); if (p) p.classList.toggle('min', v);
    document.body.classList.toggle('chat-min', v);
    const b = $('#chat-min');
    if (b) { b.textContent = v ? '▴' : '▾'; b.title = v ? '펼치기' : '접기'; }
  }
  function setMin(v) {
    const p = $('#chat-panel'); if (!p) return;
    S.min = v;
    setMinClass(v);
    if (v) {
      S.prevH = p.style.height || '';
      p.style.height = MIN_BAR + 'px';
    } else if (S.prevH) {
      p.style.height = S.prevH; S.prevH = '';
    } else {
      applyBox();
    }
    SFX.select();
    setTimeout(() => { if (g.GAME && g.GAME.placeExit) g.GAME.placeExit(); }, 0);
    if (!v) { renderLog(); const i = $('#chat-input'); if (i) i.focus(); }
  }
  /** 위치·크기를 처음 상태로 되돌린다 */
  function resetBox() {
    S.maxed = false;
    S.userSet = false;
    S.min = false; setMinClass(false); S.prevH = '';
    document.body.classList.remove('chat-free');   // 다시 게임 화면이 자리를 비켜 준다
    try { localStorage.removeItem(BOX_KEY); } catch (e) { }
    $('#chat-panel').classList.remove('is-max');
    S.box = null;
    applyBox(true);
  }

  function initDragResize(panel) {
    const head = panel.querySelector('#chat-head');
    const grip = panel.querySelector('#chat-resize');

    /** 포인터로 끌기 공통 처리 */
    function dragger(handle, onMove, canStart) {
      handle.addEventListener('pointerdown', (e) => {
        if (canStart && !canStart(e)) return;
        if (S.maxed) return;                       // 크게 보기 중에는 고정
        e.preventDefault();
        const start = { px: e.clientX, py: e.clientY, box: Object.assign({}, S.box) };
        handle.setPointerCapture(e.pointerId);
        panel.classList.add('is-dragging');
        const move = (ev) => {
          onMove(ev.clientX - start.px, ev.clientY - start.py, start.box);
          applyBox();
        };
        const up = () => {
          handle.releasePointerCapture(e.pointerId);
          panel.classList.remove('is-dragging');
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          saveBox(S.box);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });
    }

    // 머리말을 끌면 이동 (버튼·드롭다운 위에서는 동작하지 않는다)
    dragger(head,
      (dx, dy, b0) => { S.box = clampBox({ x: b0.x + dx, y: b0.y + dy, w: b0.w, h: b0.h }); },
      (e) => !e.target.closest('button, select, input'));

    // 오른쪽 아래 손잡이를 끌면 크기 조절
    dragger(grip,
      (dx, dy, b0) => { S.box = clampBox({ x: b0.x, y: b0.y, w: b0.w + dx, h: b0.h + dy }); });

    // 머리말 두 번 누르면 크게 / 원래대로
    head.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, select, input')) return;
      toggleMax();
    });

    addEventListener('resize', () => { if (S.open) applyBox(!S.userSet); });
  }

  /* ---------------- 화면 ---------------- */
  function build() {
    if (S.built) return;
    S.built = true;

    const wrap = el('div', 'chat-panel hidden');
    wrap.id = 'chat-panel';
    wrap.innerHTML =
      '<div class="chat-head" id="chat-head">' +
      '  <span class="chat-grip" title="끌어서 옮기기">⠿</span>' +
      '  <div class="chat-tabs" id="chat-tabs"></div>' +
      '  <select id="chat-team-pick" class="chat-team-pick hidden"></select>' +
      '  <button id="chat-reset" class="chat-x chat-reset-btn" title="제자리로">↺</button>' +
      '  <button id="chat-min" class="chat-x chat-min-btn" title="접기">▾</button>' +
      '  <button id="chat-max" class="chat-x chat-max" title="크게 / 원래대로">⛶</button>' +
      '  <button id="chat-close" class="chat-x" title="닫기">✕</button>' +
      '</div>' +
      '<div id="chat-log" class="chat-log"></div>' +
      '<div class="chat-note" id="chat-note"></div>' +
      '<div class="chat-row">' +
      '  <input id="chat-input" class="chat-input" type="text" maxlength="' + MAX_LEN + '" ' +
      '         placeholder="메시지 입력 (Enter 전송)" autocomplete="off">' +
      '  <button id="chat-send" class="chat-send">전송</button>' +
      '</div>' +
      '<span class="chat-resize" id="chat-resize" title="끌어서 크기 조절"></span>';
    document.body.appendChild(wrap);

    $('#chat-close').onclick = () => setOpen(false);
    $('#chat-reset').onclick = () => { resetBox(); SFX.select(); };
    $('#chat-min').onclick = () => setMin(!S.min);
    $('#chat-max').onclick = () => { toggleMax(); SFX.select(); };
    initDragResize(wrap);
    $('#chat-send').onclick = send;
    $('#chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
    });
    $('#chat-team-pick').onchange = (e) => {
      S.tab = e.target.value;          // 'global' 또는 'team3'
      markRead(S.tab);
      renderTabs(); renderLog(); SFX.select();
    };
  }

  function renderTabs() {
    const box = $('#chat-tabs'); if (!box) return;
    const list = channels();
    const pick = $('#chat-team-pick');

    if (isAdmin()) {
      // 대화방이 여러 개라 드롭다운으로 고른다 (읽지 않은 수를 함께 표시)
      box.innerHTML = '';
      pick.innerHTML = list.map(c => {
        const u = unread(c.key);
        return '<option value="' + c.key + '"' + (S.tab === c.key ? ' selected' : '') + '>' +
          esc(c.label) + (u ? ' (' + (u > 99 ? '99+' : u) + ')' : '') + '</option>';
      }).join('');
      pick.classList.remove('hidden');
    } else {
      pick.classList.add('hidden');
      box.innerHTML = list.map(c =>
        '<button class="chat-tab' + (S.tab === c.key ? ' on' : '') + '" data-ch="' + c.key + '">' +
        esc(c.label) + '<i class="chat-dot' + (unread(c.key) ? '' : ' hidden') + '">' +
        (unread(c.key) > 99 ? '99+' : unread(c.key)) + '</i></button>').join('');
      box.querySelectorAll('.chat-tab').forEach(b => {
        b.onclick = () => { S.tab = b.dataset.ch; markRead(S.tab); renderTabs(); renderLog(); SFX.select(); };
      });
    }

    // 안내 문구
    const note = $('#chat-note');
    if (!list.length) note.textContent = '아직 팀이 배정되지 않았습니다. 관리자가 팀을 구성하면 팀 대화를 할 수 있어요.';
    else if (isAdmin()) note.textContent = '관리자는 전체 대화와 모든 팀 대화를 볼 수 있습니다.';
    else if (inRoom()) note.textContent = '방 안에서는 같은 팀끼리만 대화할 수 있습니다.';
    else note.textContent = '';
    note.classList.toggle('hidden', !note.textContent);
  }

  function renderLog() {
    const log = $('#chat-log'); if (!log) return;
    const path = pathOf(S.tab);
    const list = (path && S.msgs[path]) || [];
    if (!path) { log.innerHTML = '<p class="chat-empty">대화할 수 있는 채널이 없습니다.</p>'; return; }
    if (!list.length) { log.innerHTML = '<p class="chat-empty">아직 대화가 없습니다. 먼저 말을 걸어보세요!</p>'; return; }
    log.innerHTML = list.map(m => {
      const mine = m.uid === NET.uid;
      const t = new Date(m.at || Date.now());
      const hm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
      const who = (m.team != null ? '<b>' + m.team + '팀</b> · ' : '') + esc(m.name || '?');
      return '<div class="chat-msg' + (mine ? ' mine' : '') + '">' +
        '<span class="chat-name">' + who + (mine ? ' <em>(나)</em>' : '') + '</span>' +
        '<span class="chat-bubble">' + esc(m.text || '') + '</span>' +
        '<span class="chat-time">' + hm + '</span></div>';
    }).join('');
    log.scrollTop = log.scrollHeight;
    markRead(S.tab);
  }

  function unread(key) {
    const path = pathOf(key); if (!path) return 0;
    const total = (S.msgs[path] || []).length;
    return Math.max(0, total - (S.seen[path] || 0));
  }
  function markRead(key) {
    const path = pathOf(key); if (!path) return;
    S.seen[path] = (S.msgs[path] || []).length;
    badge();
  }
  function badge() {
    const btn = $('#btn-chat'); if (!btn) return;
    const n = channels().reduce((s, c) => s + unread(c.key), 0);
    btn.dataset.n = n > 99 ? '99+' : String(n);
    btn.classList.toggle('has-new', n > 0);
  }

  /* ---------------- 구독 ---------------- */
  function resubscribe() {
    const want = {};
    channels().forEach(c => { want[c.path] = true; });
    // 필요 없어진 구독 해제
    Object.keys(S.subs).forEach(p => {
      if (!want[p]) { try { S.subs[p](); } catch (e) { } delete S.subs[p]; }
    });
    // 새 채널 구독
    Object.keys(want).forEach(p => {
      if (S.subs[p]) return;
      S.subs[p] = NET.onChat(p, list => {
        const prev = (S.msgs[p] || []).length;
        S.msgs[p] = list;
        if (S.seen[p] == null) S.seen[p] = list.length;      // 처음 들어올 땐 다 읽은 것으로
        if (list.length > prev && S.open && pathOf(S.tab) === p) renderLog();
        else if (list.length > prev) {
          const last = list[list.length - 1];
          if (last && last.uid !== NET.uid) SFX.tick();
        }
        badge(); if (S.open) renderTabs();
      });
    });
  }

  /* ---------------- 전송 ---------------- */
  function send() {
    const inp = $('#chat-input');
    const text = (inp.value || '').trim();
    if (!text) return;
    const path = pathOf(S.tab);
    if (!path) { toast('보낼 수 있는 대화방이 없습니다.', 'bad'); return; }
    const now = Date.now();
    if (now - S.lastSent < COOLDOWN) { toast('조금만 천천히 보내주세요.', 'info', 1500); return; }
    S.lastSent = now;
    inp.value = '';
    NET.sendChat(path, {
      name: (g.GAME.S.me && g.GAME.S.me.name) || '?',
      team: myTeam(),
      text
    }).catch(() => toast('메시지를 보내지 못했습니다.', 'bad'));
    SFX.select();
  }

  /* ---------------- 열고 닫기 ---------------- */
  function setOpen(v) {
    build();
    S.open = v;
    const p = $('#chat-panel');
    p.classList.toggle('hidden', !v);
    document.body.classList.toggle('chat-open', v);   // 게임 화면이 채팅 자리를 비켜 주도록
    document.body.classList.toggle('chat-min', v && S.min);
    // 채팅창이 덮은 자리를 피해 '다음 방' 버튼을 다시 배치한다
    setTimeout(() => { if (g.GAME && g.GAME.placeExit) g.GAME.placeExit(); }, 0);
    if (v) {
      applyBox(true);           // 화면이 바뀌었어도 게임을 가리지 않는 자리에
      // 방 안에서는 팀 탭으로, 팀이 없으면 전체로
      const list = channels();
      if (!list.some(c => c.key === S.tab)) S.tab = list.length ? list[0].key : 'global';
      renderTabs(); renderLog();
      setTimeout(() => { const i = $('#chat-input'); if (i) i.focus(); }, 80);
    }
    badge();
  }
  function toggle() { setOpen(!S.open); }

  /** 방↔대기실 전환, 팀 변경 시 채널을 다시 맞춘다 */
  function refresh() {
    build();
    resubscribe();
    if (S.open) { renderTabs(); renderLog(); }
    badge();
  }

  function init() {
    build();
    resubscribe();
    setInterval(refresh, 4000);      // 팀/화면 상태 변화를 따라간다
  }

  g.CHAT = { init, toggle, refresh, setOpen, setMin, resetBox, toggleMax };
})(window);
