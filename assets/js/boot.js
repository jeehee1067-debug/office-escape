/* ============================================================
   boot.js — 로그인 화면 · 세션 복구 · HUD 버튼 연결
   ============================================================ */
(function (g) {
  'use strict';
  const { $, $$, el, esc, toast, confirmBox, SFX } = g.UI;
  const { AVATARS, CONFIG } = g.DATA;

  let chosen = { avatar: 0, loc: 'SR3' };

  /* ---------- 가림막 (준비 전 화면이 스쳐 보이지 않게) ---------- */
  let coverGone = false;
  function hideCover(why) {
    if (coverGone) return;
    coverGone = true;
    const c = document.getElementById('boot-cover');
    if (!c) return;
    c.classList.add('is-gone');
    setTimeout(() => { if (c.parentNode) c.parentNode.removeChild(c); }, 400);
    if (why) console.info('[S1FA] 준비 완료 (' + why + ')');
  }
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

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
  /** PNG 를 다 확인할 때까지(혹은 제한 시간까지) 기다린 뒤 '확인 끝' 표시를 한다.
   *  이 표시 전에는 기본 도트 캐릭터를 아예 그리지 않는다. */
  function settleSprites(limitMs) {
    return Promise.race([preloadSprites().catch(e => {
      console.warn('[S1FA] 캐릭터 이미지 로딩 문제:', e);
    }), wait(limitMs || 6000)]).then(() => PX.markSpritesSettled());
  }

  /* ---------- 캐릭터 선택 ---------- */
  function renderAvatars() {
    const box = $('#avatar-picker');
    box.innerHTML = '';
    AVATARS.forEach(a => {
      const cell = el('div', 'avatar-cell' + (a.id === chosen.avatar ? ' is-on' : ''));
      cell.appendChild(PX.characterCanvas(a, 3, 0));
      cell.appendChild(el('span', '', esc(a.label || ('캐릭터 ' + (a.id + 1)))));
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

    /* 진행 상태·내 기록·팀을 한 번에 받아온 뒤 화면을 그린다.
       이렇게 해야 '로그인 화면 → 대기실 → 실제 방' 으로 두세 번 바뀌지 않고
       처음부터 맞는 방이 나온다. */
    const [gs, run, teams] = await Promise.all([
      NET.getGlobal().catch(() => null),
      NET.getRun().catch(() => null),
      NET.getTeams().catch(() => null)
    ]);

    // 접속 표시는 화면을 막지 않는다 (뒤에서 기록된다)
    NET.joinPlayer(me).catch(e => console.warn('[S1FA] 재접속 등록 실패:', e));

    g.GAME.boot(me, { global: gs, run, teams });
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
    $('#btn-chat').onclick = () => { SFX.select(); g.CHAT.toggle(); };
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
    /** 지금 화면이 방 진행 중인지에 따라 목표 볼륨이 달라진다 */
    const wantLoud = () => g.GAME && g.GAME.S && g.GAME.S.phase === 'playing';
    const applySound = () => {
      const on = g.UI.soundOn;
      $('#btn-sound').textContent = on ? '🔊' : '🔇';
      if (!on) { g.UI.bgmFade(0, 400); return; }
      if (wantLoud()) g.UI.bgmUp(600); else g.UI.bgmFade(0.05, 600);
    };
    $('#btn-sound').onclick = () => {
      g.UI.setSound(!g.UI.soundOn); SFX.select(); applySound();
    };
    // 브라우저 정책상 첫 조작 이후에야 소리가 난다
    document.addEventListener('pointerdown', function once() {
      if (g.UI.soundOn) { bgm.volume = 0; bgm.play().catch(() => { }); applySound(); }
      document.removeEventListener('pointerdown', once);
    });
    $('#btn-sound').textContent = g.UI.soundOn ? '🔊' : '🔇';
  }

  /* ---------- 시작 ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    /* 화면 뒤에서 버튼과 기본 배경을 먼저 준비한다 (가림막이 덮고 있는 동안) */
    bindLoc();
    bindHUD();
    $('#join-btn').onclick = join;
    $('#admin-login-btn').onclick = adminLogin;
    $('#name-input').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
    try { PX.renderScene($('#bg-canvas'), 'lobby'); } catch (e) { }

    if (!g.__S1FA_OFFLINE__) {
      NET.onSubscribeError(() => showConnError());
      NET.probe().then(st => {
        if (!st.ok) {
          console.error('[S1FA] Firebase 접근 실패:', st);
          showConnError(st.code);
        }
      });
    }

    /* 캐릭터 PNG 확인과 세션 복구를 동시에 진행한다 */
    const spritesDone = settleSprites(6000);

    const session = (async () => {
      try {
        const restored = await restore();
        if (!restored) {
          const gs2 = await NET.getGlobal().catch(() => null);
          if (gs2 && gs2.resetToken) localStorage.setItem('s1fa.resetToken', String(gs2.resetToken));
        }
        return restored;
      } catch (e) {
        console.warn('[S1FA] 세션 복구 실패:', e);
        return false;
      }
    })();

    /* 가림막은 (1) 캐릭터 확인 (2) 세션 복구 (3) 방 배경까지 끝나야 걷는다.
       어느 하나가 늦어져도 화면이 멈추지 않도록 전체 제한 시간을 둔다. */
    const ready = (async () => {
      await Promise.all([spritesDone, session]);
      renderAvatars();                       // PNG 가 확정된 뒤에 그린다
      const bg = g.GAME && g.GAME.S && g.GAME.S.bgReady;
      if (bg) await Promise.race([bg, wait(2500)]);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    })();

    await Promise.race([ready.then(() => '준비됨'), wait(7000).then(() => '제한 시간')])
      .then(why => {
        if (!PX.areSpritesSettled()) PX.markSpritesSettled();   // 더는 기다리지 않는다
        renderAvatars();
        hideCover(why);
      });

    if (g.__S1FA_OFFLINE__) {
      toast('오프라인 모드: 서버(Firebase)에 연결하지 못했습니다. 이 브라우저 안에서만 진행됩니다.', 'bad', 5000);
    }
  });

  g.BOOT = { backToLogin, join, adminLogin };
})(window);
