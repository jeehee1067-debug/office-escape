/* ============================================================
   net.js — Firebase 실시간 동기화 계층
   · 서버 시각 기준 타이머 (클라이언트 시계 조작 방지)
   · 기록(점수/시간)은 서버에 "덮어쓸 수 없는" 형태로 1회만 기록
   ============================================================ */
(function (g) {
  'use strict';

  const CFG = g.DATA.CONFIG;
  const ROOT = CFG.DB_ROOT;

  const firebaseConfig = {
    apiKey: 'AIzaSyB8aGt8TwxBU1LFehYmb-vIBPo2UNpL1zQ',
    authDomain: 's1fa-escape.firebaseapp.com',
    databaseURL: 'https://s1fa-escape-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 's1fa-escape',
    storageBucket: 's1fa-escape.firebasestorage.app',
    messagingSenderId: '277773638642',
    appId: '1:277773638642:web:eeb697b77914e84842e96b'
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();
  const ref = (p) => db.ref(ROOT + '/' + p);

  /* ---------- 서버 시각 ---------- */
  let clockSkew = 0;
  db.ref('.info/serverTimeOffset').on('value', s => { clockSkew = s.val() || 0; });
  const now = () => Date.now() + clockSkew;
  const TS = firebase.database.ServerValue.TIMESTAMP;

  /* ---------- 접속 상태 ---------- */
  let connected = false;
  const connCbs = [];

  /* ---------- 현재 진행 상태 (관리자가 통째로 다시 쓸 때 바탕이 된다) ---------- */
  let curGlobal = null;

  /* ---------- 고유 ID (기기별 영구) ---------- */
  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  let uid = localStorage.getItem('s1fa.uid');
  if (!uid) { uid = uuid(); localStorage.setItem('s1fa.uid', uid); }

  /* ---------- 실시간 구독 오류 (권한 문제를 눈에 보이게) ---------- */
  const subErrCbs = [];
  function onSubError(path, err) {
    console.error('[S1FA] 실시간 구독 실패 (' + path + '):', err && err.message ? err.message : err);
    subErrCbs.forEach(f => { try { f(path, err); } catch (e) { } });
  }

  /* ---------- 타임아웃 (응답 없는 요청으로 화면이 멈추지 않게) ---------- */
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + (label || ''))), ms || 8000))
    ]);
  }

  /* ---------- 관리자 키 (비밀번호 해시) ---------- */
  let adminKey = null;
  /** 관리자 쓰기에 함께 싣는 증표: 키 + 서버 시각 */
  const stamp = () => ({ key: adminKey, n: TS });
  async function makeAdminKey(pw) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('s1fa::' + pw));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return 'plain::' + pw; }
  }

  /* ---------- 프레즌스 ---------- */
  function armPresence() {
    const r = ref('players/' + uid);
    r.onDisconnect().update({ online: false, lastSeen: TS });
    r.update({ online: true, lastSeen: TS });
  }

  /* ============================================================
     API
     ============================================================ */
  const NET = {
    uid, joined: false, isAdmin: false,
    now, TS, ref, db, withTimeout,
    onSubscribeError(cb) { subErrCbs.push(cb); },
    get connected() { return connected; },
    onConnection(cb) { connCbs.push(cb); cb(connected); },

    /**
     * 관리자 로그인 검증.
     * 반환값: 'ok' | 'wrong' (비밀번호 불일치) | 'nodb' (서버에 접근 불가)
     */
    async initAdmin(pw) {
      adminKey = await makeAdminKey(pw);

      /* 최초 1회 키 등록. 규칙상 이미 있으면 거부되므로 결과는 보지 않는다.
         (config 는 읽을 수 없는 경로라 transaction 은 쓸 수 없다 — 평범한 set 이어야 한다) */
      try { await withTimeout(ref('config/adminKey').set(adminKey), 8000); } catch (e) { }

      /* 검증: 키가 맞을 때만 쓸 수 있는 자리에 써 본다. 규칙이 비밀번호를 대신 확인해 준다.
         규칙이 없는 상태(로컬 대체 저장소 등)에서는 저장된 키와 직접 비교한다. */
      try {
        let stored = null;
        try { const s = await withTimeout(ref('config/adminKey').get(), 3000); if (s.exists()) stored = s.val(); } catch (e) { }
        if (stored !== null && stored !== adminKey) return 'wrong';
        await withTimeout(ref('config/verify').set({ _k: adminKey, at: TS }), 8000);
        this.isAdmin = true;
        this.publishBank().catch(e => console.warn('[S1FA] 배점표 등록 실패:', e));
        return 'ok';
      } catch (e) {
        // 쓰기까지 막혔다면 비밀번호 문제인지 DB 문제인지 구분한다
        const st = await this.probe();
        return st.ok ? 'wrong' : 'nodb';
      }
    },

    /** 데이터베이스에 실제로 붙을 수 있는지 확인 */
    async probe() {
      try {
        await withTimeout(ref('global/state').get(), 8000, 'global');
        return { ok: true };
      } catch (e) {
        const msg = String((e && e.message) || e);
        return { ok: false, code: msg.indexOf('timeout') === 0 ? 'timeout' : 'denied', message: msg };
      }
    },
    useAdminKey(k) {
      adminKey = k; this.isAdmin = true;
      this.publishBank().catch(() => { });
    },

    /** 문제은행의 문제별 배점을 서버에 올린다.
     *  규칙은 정답 기록의 points 가 이 표의 값과 같을 때만 받아 주므로,
     *  참가자가 배점을 부풀릴 수 없고 문제은행을 고쳐도 규칙을 다시 손댈 필요가 없다. */
    publishBank() {
      const scores = {};
      const bank = (g.DATA && g.DATA.BANK) || {};
      Object.keys(bank).forEach(r => (bank[r] || []).forEach(q => {
        if (q && q.id && typeof q.score === 'number') scores[q.id] = q.score;
      }));
      if (!Object.keys(scores).length) return Promise.resolve();
      return ref('bank').set({ _k: stamp(), scores });
    },
    get adminKey() { return adminKey; },

    /* ----- 글로벌 진행 상태 -----
       · 참가자가 읽는 것은 global/state 뿐. 관리자 키는 global/_k 에 두어 아무도 읽지 못한다.
       · 관리자 쓰기는 항상 global 전체를 { _k:{key, n}, state } 로 통째로 set 한다.
         n 은 서버 시각 — 규칙이 "이번 쓰기에 키를 함께 냈는지" 를 이것으로 확인하므로,
         저장돼 있던 키에 기대어 state 만 고치는 부분 쓰기는 거부된다. */
    onGlobal(cb) { ref('global/state').on('value', s => cb(s.val() || null), e => onSubError('global', e)); },
    async getGlobal() { const s = await withTimeout(ref('global/state').get(), 8000, 'global'); return s.val() || null; },
    setGlobal(patch) {
      const state = Object.assign({}, curGlobal || {}, patch, { updatedAt: TS });
      Object.keys(state).forEach(k => { if (state[k] === undefined) delete state[k]; });
      return ref('global').set({ _k: stamp(), state });
    },
    replaceGlobal(obj) {
      return ref('global').set({ _k: stamp(), state: Object.assign({}, obj, { updatedAt: TS }) });
    },

    /* ----- 참가자 ----- */
    onPlayers(cb) { ref('players').on('value', s => cb(s.val() || {}), e => onSubError('players', e)); },
    async listPlayers() { const s = await withTimeout(ref('players').get(), 8000, 'players'); return s.val() || {}; },
    async joinPlayer(info) {
      this.joined = true;
      await withTimeout(ref('players/' + uid).update({
        uid, name: info.name, loc: info.loc, avatar: info.avatar,
        isAdmin: !!info.isAdmin, online: true, joinedAt: TS, lastSeen: TS
      }), 8000, 'join');
      armPresence();
    },
    updatePlayer(patch) { return ref('players/' + uid).update(patch); },
    removePlayer() { return ref('players/' + uid).remove(); },

    /* ----- 기록(덮어쓰기 불가) ----- */
    onRuns(cb) { ref('runs').on('value', s => cb(s.val() || {}), e => onSubError('runs', e)); },
    onMyRun(cb) { ref('runs/' + uid).on('value', s => cb(s.val() || null), e => onSubError('runs/me', e)); },
    async getRun(u) { const s = await ref('runs/' + (u || uid)).get(); return s.val() || null; },
    /** 문제 정답 기록 — 이미 있으면 서버가 거부(규칙) 하거나 무시한다 */
    async recordSolve(room, slot, payload) {
      const r = ref('runs/' + uid + '/rooms/' + room + '/solves/' + slot);
      const snap = await r.get();
      if (snap.exists()) return false;                   // 이미 기록됨 → 재기록 불가
      await r.set(Object.assign({ at: TS, uid }, payload)).catch(() => { });
      return true;
    },
    /** 방 종료 기록 — 최초 1회만 */
    async recordRoomDone(room, payload) {
      const r = ref('runs/' + uid + '/rooms/' + room + '/done');
      const snap = await r.get();
      if (snap.exists()) return false;
      await r.set(Object.assign({ at: TS }, payload)).catch(() => { });
      return true;
    },
    /** 오답 카운트(감점 근거) — 누적만 가능 */
    addWrong(room, slot) {
      return ref('runs/' + uid + '/rooms/' + room + '/wrong/' + slot)
        .transaction(v => (v || 0) + 1).catch(() => { });
    },
    addTrap(room) {
      return ref('runs/' + uid + '/rooms/' + room + '/traps')
        .transaction(v => (v || 0) + 1).catch(() => { });
    },
    setRunMeta(patch) { return ref('runs/' + uid + '/meta').update(patch).catch(() => { }); },

    /* ----- 채팅 ----- */
    /** channel: 'global' 또는 'team/3' — 최근 60개만 구독한다 */
    onChat(channel, cb) {
      const q = ref('chat/' + channel).limitToLast(60);
      const h = q.on('value', s => {
        const v = s.val() || {};
        cb(Object.keys(v).sort().map(k => Object.assign({ _id: k }, v[k])));
      }, e => onSubError('chat/' + channel, e));
      return () => { try { q.off('value', h); } catch (e) { } };
    },
    sendChat(channel, msg) {
      return ref('chat/' + channel).push({
        uid, name: String(msg.name || '').slice(0, 12),
        team: msg.team == null ? null : msg.team,
        text: String(msg.text || '').slice(0, 100),
        at: TS
      });
    },

    /* ----- 팀 ----- */
    onTeams(cb) { ref('teams/state').on('value', s => cb(s.val() || null), e => onSubError('teams', e)); },
    async getTeams() { const s = await withTimeout(ref('teams/state').get(), 8000, 'teams'); return s.val() || null; },
    setTeams(t) { return ref('teams').set({ _k: stamp(), state: { list: t, at: TS } }); },

    /* ----- 초기화 ----- */
    async resetAll() {
      // 1) 관리자만 찍을 수 있는 '초기화 시각' — 규칙은 이 시각 15초 안의 삭제만 허용한다
      await this.setGlobal({ wipeAt: TS });
      // 2) 참가자·기록·채팅 삭제, 팀 비우기
      await ref('runs').remove();
      await ref('players').remove();
      await ref('chat').remove();
      await this.setTeams([]);
      // 3) 새 판 — resetToken 이 바뀌면 참가자 화면은 로그인으로 돌아간다
      await this.replaceGlobal({
        phase: 'lobby', room: 1, startAt: null, pausedAt: null, pauseTotal: 0,
        resetToken: Date.now(), locked: false
      });
    },
    async resetRoomProgress(room) {
      // 관리자가 '어느 방을 언제' 리셋하는지 찍은 뒤 15초 안에만 그 방 기록 삭제가 허용된다
      await this.setGlobal({ roomReset: { room: String(room), at: TS } });
      const snap = await ref('runs').get();
      const all = snap.val() || {};
      const updates = {};
      Object.keys(all).forEach(u => { updates[u + '/rooms/' + room] = null; });
      if (Object.keys(updates).length) await ref('runs').update(updates);
    }
  };

  /* ---------- 점수 계산 (서버 기록으로부터 재계산) ---------- */
  NET.scoreOf = function (run) {
    let score = 0, time = 0, solved = 0, rooms = {};
    if (!run || !run.rooms) return { score, time, solved, rooms };
    Object.keys(run.rooms).forEach(k => {
      const r = run.rooms[k]; if (!r) return;
      let rs = 0;
      if (r.solves) Object.keys(r.solves).forEach(s => {
        const v = r.solves[s];
        if (v && typeof v.points === 'number') { rs += Math.max(0, Math.min(20000, v.points)); solved++; }
      });
      if (r.wrong) Object.keys(r.wrong).forEach(s => { rs -= CFG.WRONG_PENALTY * (r.wrong[s] || 0); });
      if (r.traps) rs -= CFG.TRAP_PENALTY * r.traps;
      if (r.done) {
        rs += Math.max(0, Math.min(CFG.TIME_BONUS_MAX, r.done.bonus || 0));
        time += Math.max(0, Math.min(CFG.ROOM_SECONDS, r.done.sec || 0));
      }
      rs = Math.max(0, rs);
      rooms[k] = rs;
      score += rs;
    });
    return { score, time, solved, rooms };
  };

  /* 진행 상태를 항상 최신으로 (관리자 setGlobal 의 바탕) */
  ref('global/state').on('value', s => { curGlobal = s.val() || null; }, () => { });

  /* 연결 상태 구독 (NET 정의 이후) */
  db.ref('.info/connected').on('value', s => {
    connected = !!s.val();
    connCbs.forEach(f => f(connected));
    if (connected && NET.joined) armPresence();
  });

  g.NET = NET;
})(window);
