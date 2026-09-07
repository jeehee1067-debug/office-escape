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
    tab: 'team',                // 'team' | 'global'
    watchTeam: null,            // 관리자가 들여다보는 팀 번호
    subs: {},                   // 채널별 구독 해제 함수
    msgs: {},                   // 채널별 메시지
    seen: {},                   // 채널별로 읽은 개수
    lastSent: 0,
    built: false
  };

  const myTeam = () => (g.GAME && g.GAME.S ? g.GAME.S.myTeam : null);
  const isAdmin = () => !!(g.GAME && g.GAME.S && g.GAME.S.me && g.GAME.S.me.isAdmin);
  const inRoom = () => !!(g.GAME && g.GAME.S && g.GAME.S.phase === 'playing');

  /** 지금 화면에서 쓸 수 있는 채널 목록 */
  function channels() {
    const list = [];
    const t = isAdmin() ? S.watchTeam : myTeam();
    if (t != null) list.push({ key: 'team', path: 'team/' + t, label: t + '팀' });
    if (!inRoom() || isAdmin()) list.push({ key: 'global', path: 'global', label: '전체' });
    return list;
  }
  function pathOf(key) {
    const c = channels().find(x => x.key === key);
    return c ? c.path : null;
  }

  /* ---------------- 화면 ---------------- */
  function build() {
    if (S.built) return;
    S.built = true;

    const wrap = el('div', 'chat-panel hidden');
    wrap.id = 'chat-panel';
    wrap.innerHTML =
      '<div class="chat-head">' +
      '  <div class="chat-tabs" id="chat-tabs"></div>' +
      '  <select id="chat-team-pick" class="chat-team-pick hidden"></select>' +
      '  <button id="chat-close" class="chat-x" title="닫기">✕</button>' +
      '</div>' +
      '<div id="chat-log" class="chat-log"></div>' +
      '<div class="chat-note" id="chat-note"></div>' +
      '<div class="chat-row">' +
      '  <input id="chat-input" class="chat-input" type="text" maxlength="' + MAX_LEN + '" ' +
      '         placeholder="메시지 입력 (Enter 전송)" autocomplete="off">' +
      '  <button id="chat-send" class="chat-send">전송</button>' +
      '</div>';
    document.getElementById('app').appendChild(wrap);

    $('#chat-close').onclick = () => setOpen(false);
    $('#chat-send').onclick = send;
    $('#chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
    });
    $('#chat-team-pick').onchange = (e) => {
      S.watchTeam = e.target.value ? +e.target.value : null;
      S.tab = S.watchTeam != null ? 'team' : 'global';   // 고른 팀 대화로 바로 전환
      resubscribe(); renderTabs(); renderLog();
    };
  }

  function renderTabs() {
    const box = $('#chat-tabs'); if (!box) return;
    const list = channels();
    box.innerHTML = list.map(c =>
      '<button class="chat-tab' + (S.tab === c.key ? ' on' : '') + '" data-ch="' + c.key + '">' +
      esc(c.label) + '<i class="chat-dot' + (unread(c.key) ? '' : ' hidden') + '">' +
      (unread(c.key) > 99 ? '99+' : unread(c.key)) + '</i></button>').join('');
    box.querySelectorAll('.chat-tab').forEach(b => {
      b.onclick = () => { S.tab = b.dataset.ch; markRead(S.tab); renderTabs(); renderLog(); SFX.select(); };
    });

    // 관리자용 팀 선택
    const pick = $('#chat-team-pick');
    if (isAdmin()) {
      const teams = ((g.GAME.S.teams || {}).list) || [];
      const cur = S.watchTeam;
      pick.innerHTML = '<option value="">팀 대화 보기</option>' +
        teams.map(t => '<option value="' + t.id + '"' + (cur === t.id ? ' selected' : '') + '>' + t.id + '팀</option>').join('');
      pick.classList.remove('hidden');
    } else pick.classList.add('hidden');

    // 안내 문구
    const note = $('#chat-note');
    if (!list.length) note.textContent = '아직 팀이 배정되지 않았습니다. 관리자가 팀을 구성하면 팀 대화를 할 수 있어요.';
    else if (inRoom() && !isAdmin()) note.textContent = '방 안에서는 같은 팀끼리만 대화할 수 있습니다.';
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
      return '<div class="chat-msg' + (mine ? ' mine' : '') + '">' +
        (mine ? '' : '<span class="chat-name">' + esc(m.name || '?') +
          (m.team != null ? ' <b>' + m.team + '팀</b>' : '') + '</span>') +
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
    document.body.classList.toggle('chat-open', v);   // 가려지는 버튼을 옮기기 위해
    if (v) {
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

  g.CHAT = { init, toggle, refresh, setOpen };
})(window);
