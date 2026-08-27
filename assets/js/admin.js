/* ============================================================
   admin.js — 관리자 통제 패널
   ============================================================ */
(function (g) {
  'use strict';
  const { $, el, esc, modal, toast, confirmBox, mmss, SFX } = g.UI;
  const { CONFIG } = g.DATA;

  let panel = null, refreshTimer = null;

  const PHASE_LABEL = { lobby: '대기실', playing: '진행 중', results: '결과 발표' };

  function gs() { return g.GAME.S.global || {}; }

  /* ---------- 상태 요약 ---------- */
  function stateHTML() {
    const s = gs();
    const players = Object.values(g.GAME.S.players || {}).filter(p => p && p.uid && !p.isAdmin);
    const online = players.filter(p => p.online).length;
    let remain = '-';
    if (s.phase === 'playing' && s.startAt) {
      let e = NET.now() - s.startAt - (s.pauseTotal || 0);
      if (s.pausedAt) e -= (NET.now() - s.pausedAt);
      remain = mmss(Math.max(0, CONFIG.ROOM_SECONDS - e / 1000));
    }
    return '<div class="admin-state">' +
      '상태 : <b>' + (PHASE_LABEL[s.phase] || '미시작') + (s.pausedAt ? ' (일시정지)' : '') + '</b><br>' +
      '현재 방 : <b>' + (s.room || 1) + '관</b>' + (s.phase === 'playing' ? '' : ' (대기 중)') +
      '　남은 시간 : <b>' + remain + '</b><br>' +
      '참가자 : <b>' + players.length + '명</b> (접속 중 ' + online + '명)　팀 : <b>' +
      ((g.GAME.S.teams && g.GAME.S.teams.list) ? g.GAME.S.teams.list.length + '팀' : '미구성') + '</b>' +
      '</div>';
  }

  /* ---------- 참가자 현황 표 ---------- */
  function playersHTML() {
    const runs = g.GAME.S.allRuns || {};
    const rows = Object.values(g.GAME.S.players || {})
      .filter(p => p && p.uid && !p.isAdmin)
      .map(p => {
        const sc = NET.scoreOf(runs[p.uid]);
        const run = runs[p.uid] || {};
        let cur = '대기', prog = '-';
        const st = gs();
        if (st.phase === 'playing') {
          const rec = (run.rooms || {})[st.room] || {};
          const solved = Object.keys(rec.solves || {}).length;
          cur = rec.done ? st.room + '관 완료' : st.room + '관 진행';
          prog = solved + '/' + CONFIG.CLUES_PER_ROOM;
        } else if (st.phase === 'results') cur = '결과 확인';
        return { p, sc, cur, prog };
      })
      .sort((a, b) => b.sc.score - a.sc.score);

    if (!rows.length) return '<p style="text-align:center;padding:14px;color:#8a8f9c">접속한 참가자가 없습니다.</p>';
    let h = '<div class="scroll-y"><table class="pk-table"><thead><tr><th>접속</th><th>근무지</th><th>이름</th><th>현재</th><th>단서</th><th>점수</th><th>시간</th></tr></thead><tbody>';
    rows.forEach(r => {
      h += '<tr><td><span class="dot ' + (r.p.online ? 'on' : 'off') + '"></span></td>' +
        '<td>' + esc(r.p.loc || '-') + '</td><td>' + esc(r.p.name) + '</td>' +
        '<td>' + esc(r.cur) + '</td><td>' + r.prog + '</td>' +
        '<td><b>' + r.sc.score.toLocaleString() + '</b></td><td>' + mmss(r.sc.time) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  /* ---------- 패널 본문 ---------- */
  function bodyHTML() {
    const s = gs();
    const playing = s.phase === 'playing';
    const paused = !!s.pausedAt;
    const cur = s.room || 1;
    const isLast = cur >= CONFIG.ROOM_COUNT;
    const dim = ' disabled style="opacity:.4"';

    /* 진행 버튼 : 대기실 상태에서도 방을 열 수 있어야 한다 */
    const nextLabel = isLast ? '🏁 결과 발표로' : '➡ ' + (cur + 1) + '관 열기';
    const startRoomBtn = playing
      ? '<button class="pk-btn pk-btn-gold" data-act="pause">' + (paused ? '▶ 재개' : '⏸ 일시정지') + '</button>'
      : '<button class="pk-btn pk-btn-green" data-act="resume">▶ ' + cur + '관 시작 (타이머 처음부터)</button>';

    return stateHTML() +
      '<div class="admin-grid">' +
      startRoomBtn +
      '<button class="pk-btn pk-btn-main" data-act="next">' + nextLabel + '</button>' +
      '<button class="pk-btn pk-btn-ghost" data-act="prev"' + (cur > 1 ? '' : dim) + '>⬅ ' + Math.max(1, cur - 1) + '관으로</button>' +
      '<button class="pk-btn pk-btn-ghost" data-act="lobby"' + (playing ? '' : dim) + '>🏠 전원 대기실로</button>' +
      '<button class="pk-btn pk-btn-ghost" data-act="resetroom">🧹 ' + cur + '관 리셋 후 재시작</button>' +
      '<button class="pk-btn pk-btn-green" data-act="start">🚀 1관부터 새로 시작</button>' +
      '<button class="pk-btn pk-btn-purple" data-act="teams">🎲 랜덤 팀 구성</button>' +
      '<button class="pk-btn pk-btn-ghost" data-act="csv">💾 결과 CSV</button>' +
      '<button class="pk-btn pk-btn-ghost" data-act="results">🏁 결과 발표</button>' +
      '<button class="pk-btn pk-btn-red" data-act="wipe">🔄 전체 데이터 초기화</button>' +
      '</div>' +
      (playing ? '' : '<p style="font-size:11px;color:#8a5a12;background:#fff7d6;border:2px solid var(--gold);' +
        'border-radius:6px;padding:6px 8px;margin-top:8px;line-height:1.7">' +
        '지금은 <b>대기실</b> 상태입니다. 위의 <b>' + cur + '관 시작</b> 또는 <b>' + (isLast ? '결과 발표' : (cur + 1) + '관 열기') +
        '</b> 를 눌러 진행하세요.</p>') +
      '<div class="admin-sec"><h4>👥 참가자 실시간 현황</h4>' + playersHTML() + '</div>' +
      '<div class="admin-sec"><button class="pk-btn pk-btn-ghost pk-btn-sm" data-act="logout">🚪 관리자 로그아웃</button></div>';
  }

  /* ---------- 액션 ---------- */
  const ACT = {
    async start() {
      confirmBox('게임 시작', '모든 참가자를 1관으로 이동시키고 타이머를 시작합니다. 진행하시겠습니까?', async () => {
        await NET.setGlobal({ phase: 'playing', room: 1, startAt: NET.TS, pauseTotal: 0, pausedAt: null });
        toast('게임을 시작했습니다!', 'good');
      }, '시작하기');
    },
    /** 현재 방을 (다시) 시작 — 전원 대기실로 부른 뒤 이어가기 */
    async resume() {
      const s = gs();
      const room = s.room || 1;
      await NET.setGlobal({ phase: 'playing', room, startAt: NET.TS, pauseTotal: 0, pausedAt: null });
      toast(room + '관을 시작했습니다.', 'good');
    },
    async next() {
      const s = gs();
      const cur = s.room || 1;
      if (cur >= CONFIG.ROOM_COUNT) return ACT.results();
      await NET.setGlobal({ phase: 'playing', room: cur + 1, startAt: NET.TS, pauseTotal: 0, pausedAt: null });
      toast((cur + 1) + '관을 열었습니다.', 'good');
    },
    async prev() {
      const s = gs();
      const room = Math.max(1, (s.room || 1) - 1);
      await NET.setGlobal({ phase: 'playing', room, startAt: NET.TS, pauseTotal: 0, pausedAt: null });
      toast(room + '관으로 되돌렸습니다.', 'info');
    },
    async pause() {
      const s = gs();
      if (s.pausedAt) {
        const add = NET.now() - s.pausedAt;
        await NET.setGlobal({ pausedAt: null, pauseTotal: (s.pauseTotal || 0) + add });
        toast('게임을 재개했습니다.', 'good');
      } else {
        await NET.setGlobal({ pausedAt: NET.TS });
        toast('게임을 일시정지했습니다.', 'info');
      }
    },
    async lobby() {
      await NET.setGlobal({ phase: 'lobby', pausedAt: null });
      toast('전원을 대기실로 이동시켰습니다.', 'info');
    },
    async resetroom() {
      const room = gs().room || 1;
      confirmBox('방 리셋', room + '관의 모든 참가자 진행 기록을 지우고 타이머를 다시 시작합니다.', async () => {
        await NET.resetRoomProgress(room);
        await NET.setGlobal({ phase: 'playing', room, startAt: NET.TS, pauseTotal: 0, pausedAt: null });
        toast(room + '관을 리셋했습니다.', 'info');
      }, '리셋');
    },
    async results() {
      await NET.setGlobal({ phase: 'results', pausedAt: null });
      toast('결과를 발표합니다!', 'good');
    },
    wipe() {
      confirmBox('전체 초기화', '모든 참가자·기록·팀 데이터를 삭제하고 참가자를 로그인 화면으로 되돌립니다.\n관리자는 로그아웃되지 않습니다.', async () => {
        await NET.resetAll();
        toast('전체 초기화 완료', 'good');
      }, '완전 초기화');
    },
    teams() { buildTeams(); },
    csv() { exportCSV(); },
    logout() {
      confirmBox('관리자 로그아웃', '관리자 세션을 종료하고 로그인 화면으로 돌아갑니다.', () => {
        localStorage.removeItem('s1fa.admin');
        localStorage.removeItem('s1fa.me');
        location.reload();
      }, '로그아웃');
    }
  };

  /* ---------- 팀 구성 ---------- */
  function buildTeams() {
    const players = Object.values(g.GAME.S.players || {}).filter(p => p && p.uid && !p.isAdmin);
    if (players.length < 2) return toast('참가자가 너무 적습니다.', 'bad');
    const shuffle = a => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(v => v[1]);
    const sr3 = shuffle(players.filter(p => p.loc === 'SR3'));
    const s1l = shuffle(players.filter(p => p.loc !== 'SR3'));
    const size = players.length <= 8 ? 2 : (players.length <= 24 ? 3 : 4);
    const n = Math.max(1, Math.round(players.length / size));
    const teams = Array.from({ length: n }, (_, i) => ({ id: i + 1, members: [] }));
    let i = 0;
    // 근무지가 골고루 섞이도록 번갈아 배분
    while (sr3.length || s1l.length) {
      const pick = (i % 2 === 0 ? (sr3.pop() || s1l.pop()) : (s1l.pop() || sr3.pop()));
      if (!pick) break;
      teams[i % n].members.push({ uid: pick.uid, name: pick.name, loc: pick.loc });
      i++;
    }
    NET.setTeams(teams);
    showTeams(teams);
  }
  function showTeams(teams) {
    let h = '<div class="scroll-y"><table class="pk-table"><thead><tr><th>팀</th><th>인원</th><th>팀원</th></tr></thead><tbody>';
    teams.forEach(t => {
      h += '<tr><td><b>' + t.id + '팀</b></td><td>' + t.members.length + '</td><td style="text-align:left">' +
        t.members.map(m => esc('[' + (m.loc || '-') + '] ' + m.name)).join(', ') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    modal({
      title: '🎲 랜덤 팀 구성 결과', html: h + '<p style="font-size:11px;color:#3f4453;margin-top:8px">※ 팀마다 출제되는 3문제 조합이 달라집니다(컨닝 방지).</p>',
      wide: true, closable: true,
      buttons: [
        { label: '🔄 다시 구성', cls: 'pk-btn-red', close: true, onClick: () => buildTeams() },
        { label: '💾 CSV 저장', cls: 'pk-btn-green', close: false, onClick: () => downloadCSV('teams.csv', teamsCSV(teams)) }
      ]
    });
  }
  function teamsCSV(teams) {
    let s = '팀,근무지,이름\n';
    teams.forEach(t => t.members.forEach(m => { s += t.id + ',' + (m.loc || '') + ',' + m.name + '\n'; }));
    return s;
  }

  /* ---------- CSV ---------- */
  function exportCSV() {
    const rows = g.GAME.computeBoard();
    const runs = g.GAME.S.allRuns || {};
    let s = '순위,이름,근무지,총점,총시간(초),맞춘단서';
    for (let r = 1; r <= CONFIG.ROOM_COUNT; r++) s += ',' + r + '관점수,' + r + '관시간';
    s += '\n';
    rows.forEach((r, i) => {
      const sc = NET.scoreOf(runs[r.uid]);
      s += [i + 1, r.name, r.loc || '', r.score, r.time, r.solved].join(',');
      for (let n = 1; n <= CONFIG.ROOM_COUNT; n++) {
        const rec = ((runs[r.uid] || {}).rooms || {})[n] || {};
        s += ',' + (sc.rooms[n] || 0) + ',' + ((rec.done && rec.done.sec) || 0);
      }
      s += '\n';
    });
    downloadCSV('s1fa_escape_result.csv', s);
  }
  function downloadCSV(name, content) {
    const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    toast('CSV를 저장했습니다.', 'good');
  }

  /* ---------- 패널 열기 ---------- */
  function open() {
    if (panel && document.body.contains(panel.back)) return;
    panel = modal({
      title: '👑 관리자 통제 패널', wide: true, closable: true,
      html: bodyHTML(),
      onClose: () => { clearInterval(refreshTimer); panel = null; },
      onMount: (body, back) => {
        back.dataset.keep = '1';    // 방이 바뀌어도 패널이 닫히지 않게
        bind(body);
        clearInterval(refreshTimer);
        refreshTimer = setInterval(() => {
          if (!document.body.contains(body)) return clearInterval(refreshTimer);
          const focus = document.activeElement;
          body.innerHTML = bodyHTML();
          bind(body);
        }, 2500);
      }
    });
  }
  function bind(body) {
    body.querySelectorAll('[data-act]').forEach(b => {
      b.onclick = () => { SFX.select(); const f = ACT[b.dataset.act]; if (f) f(); };
    });
  }

  g.ADMIN = { open, buildTeams, exportCSV };
})(window);
