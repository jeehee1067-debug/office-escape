/* ============================================================
   boot.js — 로그인 화면 · 세션 복구 · HUD 버튼 연결
   ============================================================ */
(function (g) {
  'use strict';
  const { $, $$, el, esc, toast, modal, confirmBox, SFX } = g.UI;
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
        if (lockedLoc && b.dataset.loc !== lockedLoc) {
          toast('팀 배정이 끝나 근무지를 바꿀 수 없습니다.', 'bad', 2600);
          return;
        }
        chosen.loc = b.dataset.loc; SFX.select();
        $$('#loc-picker .chip').forEach(x => x.classList.toggle('is-on', x === b));
      };
    });
  }

  /* ---------- 근무지 잠금 ----------
     팀이 이미 짜인 뒤에 근무지를 바꿔서 들어오면 팀 구성(SR3·S1L 균형)이 깨지고
     그 팀은 전용 문제를 풀 수 없게 된다. 그래서 배정된 뒤에는 바꾸지 못하게 막는다. */
  let lockedLoc = null;          // 팀에 배정되어 고정된 근무지

  /** 팀 명단에서 내 기록을 찾는다.
      기기(브라우저)를 바꾸면 uid 가 달라지므로, uid 로 못 찾으면 이름으로 한 번 더 찾는다.
      — 회사 PC 로 들어왔다가 휴대폰으로 다시 들어오는 경우가 실제로 생긴다. */
  function myTeamEntry(teams, name) {
    const list = (teams && teams.list) || [];
    for (const t of list) {
      const m = (t.members || []).find(x => x && x.uid === NET.uid);
      if (m) return { team: t.id, loc: m.loc, uid: m.uid, name: m.name, by: 'uid' };
    }
    const nm = String(name || '').trim();
    if (!nm) return null;
    for (const t of list) {
      const m = (t.members || []).find(x => x && String(x.name || '').trim() === nm);
      if (m) return { team: t.id, loc: m.loc, uid: m.uid, name: m.name, by: 'name' };
    }
    return null;
  }

  /** 근무지 선택을 잠그고 화면에 알린다 */
  function applyLocLock(loc, teamId) {
    lockedLoc = loc;
    chosen.loc = loc;
    const box = $('#loc-picker');
    if (box) {
      $$('#loc-picker .chip').forEach(b => {
        const on = b.dataset.loc === loc;
        b.classList.toggle('is-on', on);
        b.classList.toggle('is-locked', !on);
        b.disabled = !on;
        b.title = on ? '' : '팀 배정이 끝나 근무지를 바꿀 수 없습니다';
      });
      if (!box.parentNode.querySelector('.loc-lock-note')) {
        const n = el('p', 'loc-lock-note',
          '🔒 ' + teamId + '팀에 배정되어 근무지는 ' + loc + ' 로 고정되었습니다. ' +
          '바꿔야 하면 관리자에게 말씀해주세요.');
        box.parentNode.insertBefore(n, box.nextSibling);
      }
    }
  }

  /** 다른 기기에서 같은 이름으로 들어왔을 때 — 같은 사람인지 확인한다.
      점수와 팀이 참가자 ID 에 묶여 있어서, 이어받지 않으면 그동안의 기록이 사라진다. */
  function askSamePerson(name, mine) {
    return new Promise(resolve => {
      let answered = false;
      const done = v => { if (!answered) { answered = true; resolve(v); } };
      modal({
        title: '🔄 이어서 하시겠습니까?',
        closable: false,
        html: '<p style="font-size:13px;line-height:1.9"><b>' + esc(name) + '</b> 님은 이미 ' +
          '<b>' + esc(String(mine.team)) + '팀</b>(' + esc(mine.loc) + ')으로 참가 중입니다.<br>' +
          '다른 기기나 브라우저에서 다시 들어오신 건가요?</p>' +
          '<p style="font-size:12px;line-height:1.8;color:#5c6272;margin-top:8px">' +
          '「네」 를 누르면 지금까지의 <b>점수와 팀 배정을 그대로 이어서</b> 진행합니다.<br>' +
          '다른 분이라면 「아니요」 를 누르고 <b>다른 이름</b>으로 들어와 주세요.</p>',
        buttons: [
          { label: '네, 저입니다 (이어서 하기)', cls: 'pk-btn-main', onClick: () => done(true) },
          { label: '아니요, 다른 사람입니다', cls: 'pk-btn-ghost', onClick: () => done(false) }
        ]
      });
    });
  }

  /** 근무지를 바꿔서 들어오려 했을 때 알린다 */
  function warnLocLocked(mine) {
    modal({
      title: '🔒 근무지는 바꿀 수 없습니다',
      closable: true,
      html: '<p style="font-size:13px;line-height:1.9">이미 <b>' + esc(String(mine.team)) + '팀</b> 에 ' +
        '<b>' + esc(mine.loc) + '</b> 근무자로 배정되어 있습니다.<br>' +
        '그래서 근무지는 <b>' + esc(mine.loc) + '</b> 로 되돌렸습니다. (이름은 바꾼 대로 유지됩니다)</p>' +
        '<p style="font-size:12px;line-height:1.8;color:#5c6272;margin-top:8px">' +
        '방마다 <b>SR3 전용 · S1L 전용 문제</b>가 번갈아 나옵니다. 팀에 두 근무지가 모두 있어야 탈출할 수 있어서, ' +
        '팀이 짜인 뒤에 근무지를 바꾸면 그 팀이 문제를 풀 수 없게 됩니다.<br>' +
        '정말 바꿔야 한다면 <b>관리자에게 말씀해 주세요.</b> 관리자 패널에서 고칠 수 있습니다.</p>',
      buttons: [{ label: esc(mine.loc) + ' 로 계속하기', cls: 'pk-btn-main', close: true }]
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
      /* 팀 명단부터 확인한다 — 기기를 바꿔 들어온 사람은
         이름 중복으로 막아버리면 안 되고, 이전 기록을 이어줘야 한다. */
      let mine = null;
      try { mine = myTeamEntry(await NET.getTeams(), name); }
      catch (e) { console.warn('[S1FA] 팀 확인 실패:', e); }

      /* 기기를 바꿔 들어온 경우 — 같은 사람이면 이전 ID(=점수·팀)를 이어받는다 */
      if (mine && mine.by === 'name' && mine.uid) {
        if (!await askSamePerson(name, mine)) {
          toast('이미 쓰고 있는 이름입니다. 다른 이름으로 들어와 주세요.', 'bad', 4000);
          $('#name-input').focus();
          return;
        }
        NET.useUid(mine.uid);
      }

      // 이름 중복 확인 — 서버에 못 붙어도 입장은 막지 않는다
      try {
        const players = await NET.listPlayers();
        const dup = Object.values(players).some(p => p && p.uid && p.uid !== NET.uid && p.name === name && p.online);
        if (dup) { toast('같은 이름이 이미 접속해 있습니다. 다른 이름을 사용해주세요.', 'bad', 3000); return; }
      } catch (e) {
        console.warn('[S1FA] 이름 중복 확인 실패:', e);
      }

      /* 팀 배정이 끝난 뒤라면 근무지는 바꿀 수 없다 */
      let locBlocked = null;
      if (mine && mine.loc && mine.loc !== chosen.loc) {
        applyLocLock(mine.loc, mine.team);
        locBlocked = mine;
        chosen.loc = mine.loc;
      }

      const me = { name, loc: chosen.loc, avatar: chosen.avatar, isAdmin: false };
      localStorage.setItem('s1fa.me', JSON.stringify(me));
      localStorage.removeItem('s1fa.resetToken');     // 새 입장 — 이전 판의 초기화 토큰은 잊는다
      try {
        await NET.joinPlayer(me);
        toast('대기실에 입장했습니다!', 'good');
      } catch (e) {
        console.error('[S1FA] 서버 등록 실패:', e);
        toast('서버에 기록하지 못했습니다. 화면은 진행되지만 점수가 저장되지 않을 수 있습니다.', 'bad', 5000);
        showConnError();
      }
      g.GAME.boot(me);
      // 입장 화면이 다 그려진 뒤에 알린다 (boot 이 열려 있던 창을 닫기 때문)
      if (locBlocked) setTimeout(() => warnLocLocked(locBlocked), 600);
    } finally {
      joining = false;
      btn.textContent = label;
      btn.disabled = false;
    }
  }

  /* ---------- 연결 실패 안내 ----------
     어디가 막혔는지까지 알려준다. 채팅만 막힌 경우(규칙이 옛 버전)는
     게임 진행에는 문제가 없으므로 따로 안내한다. */
  let connErrShown = false, chatErrShown = false;
  function showConnError(code, path) {

    /* 채팅 경로만 거부된 경우 — 규칙에 chat 항목이 없는 이전 버전이 올라가 있다 */
    if (path && String(path).indexOf('chat') === 0) {
      if (chatErrShown) return;
      chatErrShown = true;
      const btn = $('#btn-chat'); if (btn) btn.classList.add('hidden');
      if (g.CHAT) g.CHAT.setOpen(false);
      g.UI.modal({
        title: '💬 채팅만 사용할 수 없습니다',
        html: '<p style="line-height:1.9;white-space:pre-line">' + esc(
          '채팅 기록에 접근할 수 없습니다. (거부된 경로: ' + path + ')\n\n' +
          '채팅 기능이 추가되면서 보안 규칙에 chat 항목이 늘었습니다.\n' +
          '예전에 게시한 규칙만 올라가 있으면 채팅만 막힙니다.\n\n' +
          'Firebase 콘솔 → Realtime Database → 규칙 탭에\n' +
          '저장소의 database.rules.json 을 다시 붙여넣고 [게시]한 뒤\n' +
          '새로고침하면 채팅이 켜집니다.\n\n' +
          '게임 진행과 점수 기록은 그대로 됩니다.') + '</p>',
        buttons: [{ label: '확인', cls: 'pk-btn-main' }]
      });
      return;
    }

    if (connErrShown) return;
    connErrShown = true;
    const where = path ? '\n\n거부된 경로: ' + path : '';
    const msg = code === 'timeout'
      ? '서버(Firebase)가 응답하지 않습니다. 인터넷 연결 또는 방화벽을 확인해주세요.'
      : '서버(Firebase)에 접근할 수 없습니다.' + where +
        '\n\nFirebase 콘솔 → Realtime Database → 규칙 탭에\ndatabase.rules.json 내용을 붙여넣고 [게시]했는지 확인해주세요.\n' +
        '(새로 만든 데이터베이스는 기본적으로 모든 접근이 차단되어 있습니다.)\n' +
        '자세한 내용은 F12 → Console 에 찍힌 [S1FA] 메시지를 확인하세요.';
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
      localStorage.removeItem('s1fa.resetToken');
      localStorage.setItem('s1fa.admin', NET.adminKey);
      try { await NET.joinPlayer(me); } catch (e) { console.warn('[S1FA] 관리자 등록 실패:', e); }
      g.GAME.boot(me);
      SFX.great();
      toast('관리자로 로그인했습니다.', 'good');
      setTimeout(() => g.ADMIN.open(), 500);
      // 규칙 게시·배점표 등록이 빠지지 않았는지 조용히 확인한다 (문제가 있을 때만 알림)
      setTimeout(() => g.ADMIN.autoCheck(), 2200);
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

    /* 팀에 이미 배정돼 있으면 그 근무지를 따른다 (임의 변경 방지) */
    const mine = myTeamEntry(teams, me.name);
    if (mine && mine.loc && mine.loc !== me.loc) {
      me.loc = mine.loc;
      chosen.loc = mine.loc;
      localStorage.setItem('s1fa.me', JSON.stringify(me));
      setTimeout(() => warnLocLocked(mine), 800);
    }

    // 접속 표시는 화면을 막지 않는다 (뒤에서 기록된다)
    NET.joinPlayer(me).catch(e => console.warn('[S1FA] 재접속 등록 실패:', e));

    g.GAME.boot(me, { global: gs, run, teams });
    toast('이전 진행 상황을 불러왔습니다.', 'info');
    return true;
  }

  function backToLogin() {
    localStorage.removeItem('s1fa.me');
    localStorage.removeItem('s1fa.resetToken');
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
      NET.onSubscribeError((path) => showConnError(null, path));
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
        return await restore();
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

  g.BOOT = { backToLogin, join, adminLogin, showConnError };
})(window);
