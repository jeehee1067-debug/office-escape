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
  async function join() {
    const name = $('#name-input').value.trim();
    if (!name) { toast('이름을 입력해주세요.', 'bad'); $('#name-input').focus(); return; }
    if (name.length > 8) { toast('이름은 8자 이내로 입력해주세요.', 'bad'); return; }

    const players = await NET.listPlayers();
    const dup = Object.values(players).some(p => p && p.uid && p.uid !== NET.uid && p.name === name && p.online);
    if (dup) { toast('같은 이름이 이미 접속해 있습니다. 다른 이름을 사용해주세요.', 'bad', 3000); return; }

    const me = { name, loc: chosen.loc, avatar: chosen.avatar, isAdmin: false };
    localStorage.setItem('s1fa.me', JSON.stringify(me));
    await NET.joinPlayer(me);
    g.GAME.boot(me);
    toast('대기실에 입장했습니다!', 'good');
  }

  /* ---------- 관리자 로그인 ---------- */
  function adminLogin() {
    g.UI.prompt('👑 관리자 로그인', '관리자 비밀번호를 입력하세요.', async (pw) => {
      if (!pw) return;
      const ok = await NET.initAdmin(pw);
      if (!ok) { SFX.no(); toast('비밀번호가 일치하지 않습니다.', 'bad'); return; }
      const me = { name: '관리자', loc: '', avatar: 0, isAdmin: true };
      localStorage.setItem('s1fa.me', JSON.stringify(me));
      localStorage.setItem('s1fa.admin', NET.adminKey);
      await NET.joinPlayer(me);
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
    await NET.joinPlayer(me);
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
    await preloadSprites();
    renderAvatars();
    bindLoc();
    bindHUD();
    $('#join-btn').onclick = join;
    $('#admin-login-btn').onclick = adminLogin;
    $('#name-input').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

    // 대기실 배경 미리보기 (로그인 화면 뒤편)
    try { PX.renderScene($('#bg-canvas'), 'lobby'); } catch (e) { }

    if (g.__S1FA_OFFLINE__) {
      toast('오프라인 모드: 서버(Firebase)에 연결하지 못했습니다. 이 브라우저 안에서만 진행됩니다.', 'bad', 5000);
    }

    const restored = await restore();
    if (!restored) {
      const gs2 = await NET.getGlobal();
      if (gs2 && gs2.resetToken) localStorage.setItem('s1fa.resetToken', String(gs2.resetToken));
    }
  });

  g.BOOT = { backToLogin, join, adminLogin };
})(window);
