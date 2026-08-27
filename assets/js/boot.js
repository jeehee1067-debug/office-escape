/* ============================================================
   boot.js — 로그인 화면 · 세션 복구 · HUD 버튼 연결
   ============================================================ */
(function (g) {
  'use strict';
  const { $, $$, el, esc, toast, confirmBox, SFX } = g.UI;
  const { AVATARS, CONFIG } = g.DATA;

  let chosen = { avatar: 0, loc: 'SR3' };

  /* ---------- PNG 캐릭터 미리 불러오기 ---------- */
  async function preloadSprites() {
    const list = AVATARS.concat(Object.values(g.DATA.BOSSES));
    const keys = list.map(a => a.sprite).filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);
    if (!keys.length) return;
    const ext = CONFIG.SPRITE_EXT || '.png';
    const found = await Promise.all(
      keys.map(k => PX.setCharImage(k, CONFIG.SPRITE_DIR + k + ext).then(im => (im ? k : null)))
    );
    const ok = found.filter(Boolean);
    if (ok.length) console.info('[S1FA] PNG 캐릭터 사용: ' + ok.join(', '));
  }

  /* ---------- 캐릭터 선택 ---------- */
  function renderAvatars() {
    const box = $('#avatar-picker');
    box.innerHTML = '';
    AVATARS.forEach(a => {
      const cell = el('div', 'avatar-cell' + (a.id === chosen.avatar ? ' is-on' : ''));
      cell.appendChild(PX.characterCanvas(a, 3, 0));
      cell.appendChild(el('span', '', esc(a.name)));
      cell.onclick = () => {
        chosen.avatar = a.id; SFX.select();
        $$('.avatar-cell', box).forEach((c, i) => c.classList.toggle('is-on', i === a.id));
      };
      box.appendChild(cell);
    });
  }

  /* ---------- 근무지 ---------- */
  function bindLoc() {
    $$('#loc-picker .chip').forEach(b => {
      b.onclick = () => {
        chosen.loc = b.dataset.loc; SFX.select();
        $$('#loc-picker .chip').forEach(x => x.classList.toggle('is-on', x === b));
      };
    });
  }

  /* ---------- 참가 ---------- */
  let joining = false;
  async function join() {
    if (joining) return;
    const name = $('#name-input').value.trim();
    if (!name) { toast('이름을 입력해주세요.', 'bad'); $('#name-input').focus(); return; }
    if (name.length > 8) { toast('이름은 8자 이내로 입력해주세요.', 'bad'); return; }

    joining = true;
    const btn = $('#join-btn');
    const label = btn.textContent;
    btn.textContent = '접속 중...';
    btn.disabled = true;
    try {
      // 이름 중복 확인 — 서버에 못 붙어도 입장은 막지 않는다
      try {
        const players = await NET.listPlayers();
        const dup = Object.values(players).some(p => p && p.uid && p.uid !== NET.uid && p.name === name && p.online);
        if (dup) { toast('같은 이름이 이미 접속해 있습니다. 다른 이름을 사용해주세요.', 'bad', 3000); return; }
      } catch (e) {
        console.warn('[S1FA] 이름 중복 확인 실패:', e);
      }

      const me = { name, loc: chosen.loc, avatar: chosen.avatar, isAdmin: false };
      localStorage.setItem('s1fa.me', JSON.stringify(me));
      try {
        await NET.joinPlayer(me);
        toast('대기실에 입장했습니다!', 'good');
      } catch (e) {
        console.error('[S1FA] 서버 등록 실패:', e);
        toast('서버에 기록하지 못했습니다. 화면은 진행되지만 점수가 저장되지 않을 수 있습니다.', 'bad', 5000);
        showConnError();
      }
      g.GAME.boot(me);
    } finally {
      joining = false;
      btn.textContent = label;
      btn.disabled = false;
    }
  }

  /* ---------- 연결 실패 안내 ---------- */
  let connErrShown = false;
  function showConnError(code) {
    if (connErrShown) return;
    connErrShown = true;
    const msg = code === 'timeout'
      ? '서버(Firebase)가 응답하지 않습니다. 인터넷 연결 또는 방화벽을 확인해주세요.'
      : '서버(Firebase)에 접근할 수 없습니다.\n\nFirebase 콘솔 → Realtime Database → 규칙 탭에\ndatabase.rules.json 내용을 붙여넣고 [게시]했는지 확인해주세요.\n(새로 만든 데이터베이스는 기본적으로 모든 접근이 차단되어 있습니다.)';
    g.UI.modal({
      title: '⚠️ 서버 연결 문제',
      html: '<p style="line-height:1.9;white-space:pre-line">' + esc(msg) + '</p>',
      buttons: [{ label: '확인', cls: 'pk-btn-main' }]
    });
  }

  /* ---------- 관리자 로그인 ---------- */
  function adminLogin() {
    g.UI.prompt('👑 관리자 로그인', '관리자 비밀번호를 입력하세요.', async (pw) => {
      if (!pw) return;
      let res;
      try {
        res = await NET.initAdmin(pw);
      } catch (e) {
        console.error('[S1FA] 관리자 확인 실패:', e);
        res = 'nodb';
      }
      if (res === 'wrong') { SFX.no(); toast('비밀번호가 일치하지 않습니다.', 'bad'); return; }
      if (res === 'nodb') { SFX.no(); showConnError(); return; }

      const me = { name: '관리자', loc: '', avatar: 0, isAdmin: true };
      localStorage.setItem('s1fa.me', JSON.stringify(me));
      localStorage.setItem('s1fa.admin', NET.adminKey);
      try { await NET.joinPlayer(me); } catch (e) { console.warn('[S1FA] 관리자 등록 실패:', e); }
      g.GAME.boot(me);
      SFX.great();
      toast('관리자로 로그인했습니다.', 'good');
      setTimeout(() => g.ADMIN.open(), 500);
    }, { password: true, max: 24 });
  }

  /* ---------- 세션 복구 ---------- */
  async function restore() {
    const raw = localStorage.getItem('s1fa.me');
    if (!raw) return false;
    let me;
    try { me = JSON.parse(raw); } catch (e) { return false; }
    if (!me || !me.name) return false;
    if (me.isAdmin) {
      const k = localStorage.getItem('s1fa.admin');
      if (!k) return false;
      NET.useAdminKey(k);
    }
    chosen.avatar = me.avatar || 0;
    chosen.loc = me.loc || 'SR3';
    try { await NET.joinPlayer(me); }
    catch (e) { console.warn('[S1FA] 재접속 등록 실패:', e); }
    g.GAME.boot(me);
    toast('이전 진행 상황을 불러왔습니다.', 'info');
    return true;
  }

  function backToLogin() {
    localStorage.removeItem('s1fa.me');
    location.reload();
  }

  /* ---------- HUD 버튼 ---------- */
  function bindHUD() {
    $('#btn-board').onclick = () => { SFX.select(); g.GAME.openBoard(); };
    $('#btn-admin').onclick = () => { SFX.select(); g.ADMIN.open(); };
    $('#btn-logout').onclick = () => {
      confirmBox('로그아웃', g.GAME.S.me && g.GAME.S.me.isAdmin
        ? '관리자 세션을 종료합니다.'
        : '로그아웃하면 이 기기에서 대기실로 나갑니다.\n(기록은 서버에 남아 같은 이름으로 다시 들어오면 이어집니다.)',
        () => {
          if (!(g.GAME.S.me && g.GAME.S.me.isAdmin)) NET.updatePlayer({ online: false });
          else localStorage.removeItem('s1fa.admin');
          backToLogin();
        }, '로그아웃');
    };
    const bgm = $('#bgm');
    const applySound = () => {
      const on = g.UI.soundOn;
      $('#btn-sound').textContent = on ? '🔊' : '🔇';
      if (on) { bgm.volume = .18; bgm.play().catch(() => { }); } else bgm.pause();
    };
    $('#btn-sound').onclick = () => {
      g.UI.setSound(!g.UI.soundOn); SFX.select(); applySound();
    };
    document.addEventListener('pointerdown', function once() {
      if (g.UI.soundOn) { bgm.volume = .18; bgm.play().catch(() => { }); }
      document.removeEventListener('pointerdown', once);
    });
    $('#btn-sound').textContent = g.UI.soundOn ? '🔊' : '🔇';
  }

  /* ---------- 시작 ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    /* 1) 화면과 버튼부터 즉시 준비 — 네트워크를 절대 기다리지 않는다 */
    renderAvatars();
    bindLoc();
    bindHUD();
    $('#join-btn').onclick = join;
    $('#admin-login-btn').onclick = adminLogin;
    $('#name-input').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
    try { PX.renderScene($('#bg-canvas'), 'lobby'); } catch (e) { }

    if (g.__S1FA_OFFLINE__) {
      toast('오프라인 모드: 서버(Firebase)에 연결하지 못했습니다. 이 브라우저 안에서만 진행됩니다.', 'bad', 5000);
    }

    /* 2) PNG 캐릭터는 뒤에서 천천히 불러오고, 도착하면 다시 그린다 */
    preloadSprites()
      .then(() => { if ($('#login-screen') && !$('#login-screen').classList.contains('hidden')) renderAvatars(); })
      .catch(e => console.warn('[S1FA] 캐릭터 이미지 로딩 문제:', e));

    /* 3) 서버 상태 확인 및 이전 세션 복구 */
    if (!g.__S1FA_OFFLINE__) {
      NET.onSubscribeError(() => showConnError());
      NET.probe().then(st => {
        if (!st.ok) {
          console.error('[S1FA] Firebase 접근 실패:', st);
          showConnError(st.code);
        }
      });
    }

    try {
      const restored = await restore();
      if (!restored) {
        const gs2 = await NET.getGlobal();
        if (gs2 && gs2.resetToken) localStorage.setItem('s1fa.resetToken', String(gs2.resetToken));
      }
    } catch (e) {
      console.warn('[S1FA] 세션 복구 실패:', e);
    }
  });

  g.BOOT = { backToLogin, join, adminLogin };
})(window);
