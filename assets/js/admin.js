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
    const tl = teamList();
    let h = '<div class="scroll-y"><table class="pk-table"><thead><tr><th>접속</th><th>팀</th><th>근무지</th><th>이름</th><th>현재</th><th>단서</th><th>점수</th><th>시간</th></tr></thead><tbody>';
    rows.forEach(r => {
      const tno = teamOfUid(tl, r.p.uid);
      h += '<tr><td><span class="dot ' + (r.p.online ? 'on' : 'off') + '"></span></td>' +
        '<td>' + (tno ? tno + '팀' : '-') + '</td>' +
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
      '<button class="pk-btn pk-btn-gold" data-act="editteams">✏️ 팀 편집 · 이동</button>' +
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
    editteams() { openTeamEditor(); },
    csv() { exportCSV(); },
    logout() {
      confirmBox('관리자 로그아웃', '관리자 세션을 종료하고 로그인 화면으로 돌아갑니다.', () => {
        localStorage.removeItem('s1fa.admin');
        localStorage.removeItem('s1fa.me');
        location.reload();
      }, '로그아웃');
    }
  };

  /* ---------- 팀 구성 ----------
     규칙
       · 한 팀은 최소 3명 (2명짜리 팀은 만들지 않는다)
       · 되도록 3명으로 나누고, 어쩔 수 없을 때만 4명
       · 3명 팀 = (SR3 2 + S1L 1) 또는 (SR3 1 + S1L 2)
       · 4명 팀 = (SR3 2 + S1L 2)
     → 즉 한 팀에 같은 근무지가 2명을 넘지 않는다.
        한쪽 인원이 다른 쪽의 2배를 넘으면 규칙을 지킬 수 없다.
     ------------------------------------------------------------ */

  /**
   * x = (SR3 2, S1L 1) 팀 수, y = (SR3 1, S1L 2) 팀 수, z = (SR3 2, S1L 2) 팀 수
   * 4명 팀(z)이 가장 적은 조합을 찾는다.
   */
  function planTeams(a, b) {
    if (a + b < 3) return null;
    const yMax = Math.floor((2 * b - a) / 3);
    for (let y = Math.max(yMax, 0); y >= 0; y--) {
      const rem = 2 * b - a - 3 * y;
      if (rem < 0 || rem % 2) continue;
      const z = rem / 2;
      const x = y + a - b;
      if (x < 0) continue;
      if (2 * x + y + 2 * z === a && x + 2 * y + 2 * z === b) return { x, y, z };
    }
    return null;
  }

  const shuffle = a => a.map(v => [Math.random(), v]).sort((p, q) => p[0] - q[0]).map(v => v[1]);
  const asMember = p => ({ uid: p.uid, name: p.name, loc: p.loc });

  function buildTeams(quiet) {
    const players = Object.values(g.GAME.S.players || {}).filter(p => p && p.uid && !p.isAdmin);
    if (players.length < 3) return toast('참가자가 3명 이상이어야 팀을 만들 수 있습니다.', 'bad', 3000);

    const sr3 = shuffle(players.filter(p => p.loc === 'SR3'));
    const s1l = shuffle(players.filter(p => p.loc !== 'SR3'));
    const plan = planTeams(sr3.length, s1l.length);
    const teams = [];
    let warn = '';
    let id = 1;

    if (plan) {
      /* 규칙대로 정확히 배분 */
      const order = shuffle(
        Array(plan.x).fill('x').concat(Array(plan.y).fill('y'), Array(plan.z).fill('z'))
      );
      order.forEach(kind => {
        const m = [];
        if (kind === 'x') { m.push(sr3.pop(), sr3.pop(), s1l.pop()); }
        else if (kind === 'y') { m.push(sr3.pop(), s1l.pop(), s1l.pop()); }
        else { m.push(sr3.pop(), sr3.pop(), s1l.pop(), s1l.pop()); }
        teams.push({ id: id++, members: m.filter(Boolean).map(asMember) });
      });
    } else {
      /* 규칙을 지킬 수 없는 인원 구성 — 최소 3명 / 되도록 균등하게 나누고 알린다 */
      const few = sr3.length <= s1l.length ? sr3 : s1l;
      const many = sr3.length <= s1l.length ? s1l : sr3;
      const n = players.length;
      const T = Math.max(1, Math.min(Math.floor(n / 3), few.length || 1));
      for (let i = 0; i < T; i++) teams.push({ id: id++, members: [] });
      // 적은 쪽을 먼저 한 명씩 돌려 담아 모든 팀이 섞이게
      few.forEach((p, i) => teams[i % T].members.push(asMember(p)));
      // 많은 쪽은 인원이 적은 팀부터 채운다
      many.forEach(p => {
        teams.sort((A, B) => A.members.length - B.members.length || A.id - B.id);
        teams[0].members.push(asMember(p));
      });
      teams.sort((A, B) => A.id - B.id);
      const big = sr3.length >= s1l.length ? 'SR3' : 'S1L';
      warn = 'SR3 ' + sr3.length + '명 : S1L ' + s1l.length + '명 — 한쪽이 다른 쪽의 2배를 넘어 ' +
        '「같은 근무지 최대 2명」 규칙을 지킬 수 없습니다. ' + big + ' 인원이 3명 이상인 팀이 생깁니다.';
    }

    NET.setTeams(teams);
    if (!quiet) showTeams(teams, warn);
    return teams;
  }

  function teamStat(t) {
    const m = t.members || [];
    const a = m.filter(x => x.loc === 'SR3').length;
    return { n: m.length, sr3: a, s1l: m.length - a };
  }
  /** 규칙을 지킨 팀인지 */
  function teamOk(t) {
    const s = teamStat(t);
    if (s.n < 3 || s.n > 4) return false;
    if (s.sr3 > 2 || s.s1l > 2) return false;
    return s.sr3 >= 1 && s.s1l >= 1;
  }

  function showTeams(teams, warn) {
    const bad = teams.filter(t => !teamOk(t)).length;
    let h = '';
    if (warn) h += '<p style="font-size:11px;line-height:1.8;color:#8a5a12;background:#fff7d6;' +
      'border:2px solid var(--gold);border-radius:6px;padding:7px 9px;margin-bottom:8px">⚠️ ' + esc(warn) + '</p>';
    else h += '<p style="font-size:11px;line-height:1.8;color:#1c5c34;background:#cdf0d6;' +
      'border:2px solid var(--green);border-radius:6px;padding:7px 9px;margin-bottom:8px">' +
      '✅ 모든 팀이 3~4명이고 같은 근무지가 2명을 넘지 않습니다.</p>';

    h += '<div class="scroll-y"><table class="pk-table"><thead><tr>' +
      '<th>팀</th><th>인원</th><th>구성</th><th>팀원</th></tr></thead><tbody>';
    teams.forEach(t => {
      const s = teamStat(t);
      h += '<tr' + (teamOk(t) ? '' : ' style="background:#f6d3ce"') + '>' +
        '<td><b>' + t.id + '팀</b></td><td>' + s.n + '명</td>' +
        '<td>SR3 ' + s.sr3 + ' · S1L ' + s.s1l + '</td>' +
        '<td style="text-align:left">' + (t.members || []).map(m =>
          esc('[' + (m.loc || '-') + '] ' + m.name)).join(', ') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p style="font-size:11px;color:#3f4453;margin-top:8px">' +
      '총 <b>' + teams.length + '팀</b> · 3명 팀 ' + teams.filter(t => teamStat(t).n === 3).length +
      ' · 4명 팀 ' + teams.filter(t => teamStat(t).n === 4).length +
      (bad ? ' · <span style="color:#c0392b">규칙 미충족 ' + bad + '팀</span>' : '') +
      '<br>※ 팀마다 출제되는 3문제 조합이 달라집니다(컨닝 방지).</p>';

    modal({
      title: '🎲 랜덤 팀 구성 결과', html: h, wide: true, closable: true,
      buttons: [
        { label: '🔄 다시 구성', cls: 'pk-btn-red', close: true, onClick: () => buildTeams() },
        { label: '✏️ 직접 편집', cls: 'pk-btn-gold', close: true, onClick: () => openTeamEditor() },
        { label: '💾 CSV 저장', cls: 'pk-btn-green', close: false, onClick: () => downloadCSV('teams.csv', teamsCSV(teams)) }
      ]
    });
  }
  function teamsCSV(teams) {
    let s = '팀,인원,근무지,이름\n';
    teams.forEach(t => (t.members || []).forEach(m => {
      s += t.id + ',' + (t.members || []).length + ',' + (m.loc || '') + ',' + m.name + '\n';
    }));
    return s;
  }

  /* ---------- 팀 편집 (대기 중 · 진행 중 모두 가능) ---------- */
  function teamList() {
    const t = g.GAME.S.teams;
    return (t && t.list) ? JSON.parse(JSON.stringify(t.list)) : [];
  }
  function teamOfUid(list, uid) {
    for (const t of list) if ((t.members || []).some(m => m.uid === uid)) return t.id;
    return null;
  }
  /** 참가자를 다른 팀으로 옮긴다. teamId 가 0 이면 미배정 */
  function moveMember(list, player, teamId) {
    list.forEach(t => { t.members = (t.members || []).filter(m => m.uid !== player.uid); });
    if (teamId) {
      let t = list.find(x => x.id === teamId);
      if (!t) { t = { id: teamId, members: [] }; list.push(t); }
      t.members.push({ uid: player.uid, name: player.name, loc: player.loc });
    }
    list.sort((a, b) => a.id - b.id);
    return list;
  }

  function editTeamsHTML() {
    const list = teamList();
    const players = Object.values(g.GAME.S.players || {})
      .filter(p => p && p.uid && !p.isAdmin)
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    const maxId = list.reduce((m, t) => Math.max(m, t.id || 0), 0);
    const slots = Math.max(maxId, 1);

    let h = '<p style="font-size:11px;line-height:1.8;color:#3f4453;margin-bottom:8px">' +
      '팀을 바꾸면 <b>그 참가자에게 출제되는 문제도 새 팀 기준으로 바뀝니다.</b><br>' +
      '이미 맞힌 문제의 점수는 그대로 유지됩니다. 게임 진행 중에도 변경할 수 있습니다.</p>';

    if (!players.length) return h + '<p style="text-align:center;padding:14px;color:#8a8f9c">참가자가 없습니다.</p>';

    h += '<div class="scroll-y"><table class="pk-table"><thead><tr>' +
      '<th>접속</th><th>근무지</th><th>이름</th><th>팀</th></tr></thead><tbody>';
    players.forEach(p => {
      const cur = teamOfUid(list, p.uid) || 0;
      let opt = '<option value="0"' + (cur === 0 ? ' selected' : '') + '>미배정</option>';
      for (let i = 1; i <= slots + 1; i++) {
        opt += '<option value="' + i + '"' + (cur === i ? ' selected' : '') + '>' + i + '팀</option>';
      }
      h += '<tr><td><span class="dot ' + (p.online ? 'on' : 'off') + '"></span></td>' +
        '<td>' + esc(p.loc || '-') + '</td><td>' + esc(p.name) + '</td>' +
        '<td><select class="team-sel" data-uid="' + esc(p.uid) + '">' + opt + '</select></td></tr>';
    });
    h += '</tbody></table></div>';

    // 팀별 요약
    h += '<div class="admin-sec"><h4>팀 구성 현황</h4>';
    if (!list.length) h += '<p style="font-size:11px;color:#8a8f9c">아직 구성된 팀이 없습니다.</p>';
    else h += '<table class="pk-table"><thead><tr><th>팀</th><th>인원</th><th>팀원</th></tr></thead><tbody>' +
      list.map(t => '<tr><td><b>' + t.id + '팀</b></td><td>' + (t.members || []).length + '</td>' +
        '<td style="text-align:left">' + (t.members || []).map(m => esc(m.name)).join(', ') + '</td></tr>').join('') +
      '</tbody></table>';
    h += '</div>';
    return h;
  }

  function openTeamEditor() {
    const m = modal({
      title: '✏️ 팀 편집', wide: true, closable: true,
      html: editTeamsHTML(),
      buttons: [
        { label: '🎲 랜덤으로 다시 구성', cls: 'pk-btn-purple', close: false, onClick: () => { buildTeams(true); rerender(); } },
        { label: '💾 CSV 저장', cls: 'pk-btn-green', close: false, onClick: () => downloadCSV('teams.csv', teamsCSV(teamList())) }
      ],
      onMount: (body) => bindSel(body)
    });
    function rerender() { m.body.innerHTML = editTeamsHTML(); bindSel(m.body); }
    function bindSel(body) {
      body.querySelectorAll('.team-sel').forEach(sel => {
        sel.onchange = async () => {
          const uid = sel.dataset.uid;
          const player = (g.GAME.S.players || {})[uid];
          if (!player) return;
          const list = moveMember(teamList(), player, +sel.value);
          await NET.setTeams(list);
          SFX.select();
          toast(player.name + ' → ' + (+sel.value ? sel.value + '팀' : '미배정'), 'good', 1600);
          setTimeout(rerender, 250);
        };
      });
    }
    // 다른 관리자가 바꿔도 따라 갱신
    const iv = setInterval(() => {
      if (!document.body.contains(m.body)) return clearInterval(iv);
      if (!m.body.querySelector('select:focus')) rerender();
    }, 4000);
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

  g.ADMIN = { open, buildTeams, exportCSV, openTeamEditor };
})(window);
