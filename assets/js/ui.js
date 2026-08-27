/* ============================================================
   ui.js — 대사창 / 모달 / 토스트 / 사운드 / 표 헬퍼
   ============================================================ */
(function (g) {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- 사운드 (칩튠 효과음) ---------------- */
  let actx = null, soundOn = localStorage.getItem('s1fa.sound') !== 'off';
  function ac() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function beep(freq, dur, type, vol) {
    if (!soundOn) return;
    const a = ac(); if (!a) return;
    const o = a.createOscillator(), gn = a.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    gn.gain.setValueAtTime(vol == null ? .06 : vol, a.currentTime);
    gn.gain.exponentialRampToValueAtTime(.0001, a.currentTime + (dur || .08));
    o.connect(gn).connect(a.destination); o.start(); o.stop(a.currentTime + (dur || .08) + .02);
  }
  function melody(notes) { if (!soundOn) return; notes.forEach((n, i) => setTimeout(() => beep(n[0], n[1], n[2] || 'square'), i * (n[3] || 90))); }

  const SFX = {
    tick: () => beep(880, .03, 'square', .025),
    select: () => beep(660, .06),
    open: () => melody([[523, .07], [784, .1]]),
    ok: () => melody([[659, .08], [784, .08], [988, .16]]),
    great: () => melody([[523, .08], [659, .08], [784, .08], [1046, .22]]),
    no: () => melody([[220, .12, 'sawtooth'], [165, .2, 'sawtooth']]),
    trap: () => melody([[300, .07, 'triangle'], [200, .07, 'triangle'], [140, .16, 'triangle']]),
    door: () => melody([[392, .09], [523, .09], [659, .18]]),
    warn: () => beep(440, .1, 'triangle', .05),
    move: () => beep(300, .04, 'triangle', .04)
  };

  /* ---------------- 대사창 ---------------- */
  let typeTimer = null;
  function say(text, speaker) {
    const box = $('#dialogue-text'), sp = $('#dialogue-speaker');
    if (speaker) { sp.textContent = speaker; sp.classList.remove('hidden'); }
    else sp.classList.add('hidden');
    clearInterval(typeTimer);
    const full = String(text || '');
    let i = 0; box.textContent = '';
    typeTimer = setInterval(() => {
      box.textContent = full.slice(0, ++i);
      if (i % 3 === 0) SFX.tick();
      if (i >= full.length) clearInterval(typeTimer);
    }, 18);
  }

  /* ---------------- 토스트 ---------------- */
  function toast(msg, kind, ms) {
    const t = el('div', 'toast ' + (kind || 'info'), esc(msg));
    $('#toast-root').appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms || 2200);
  }

  /* ---------------- 모달 ---------------- */
  const stack = [];
  function modal(opts) {
    const back = el('div', 'modal-back');
    const m = el('div', 'modal' + (opts.wide ? ' wide' : ''));
    if (opts.closable !== false) {
      const x = el('button', 'modal-close', '✕');
      x.onclick = () => { SFX.select(); close(back); if (opts.onClose) opts.onClose(); };
      m.appendChild(x);
    }
    if (opts.title) m.appendChild(el('div', 'modal-title', esc(opts.title)));
    const body = el('div', 'modal-body');
    if (typeof opts.html === 'string') body.innerHTML = opts.html;
    else if (opts.html) body.appendChild(opts.html);
    m.appendChild(body);
    if (opts.buttons && opts.buttons.length) {
      const row = el('div', 'modal-actions');
      opts.buttons.forEach(b => {
        const btn = el('button', 'pk-btn ' + (b.cls || 'pk-btn-ghost'), esc(b.label));
        btn.onclick = () => { SFX.select(); if (b.onClick) b.onClick(back, body); if (b.close !== false) close(back); };
        row.appendChild(btn);
      });
      m.appendChild(row);
    }
    back.appendChild(m);
    if (opts.low) back.dataset.low = '1';      // 관리자 패널보다 아래에 깔리는 창
    if (opts.backdropClose) back.addEventListener('click', e => { if (e.target === back) { close(back); if (opts.onClose) opts.onClose(); } });
    $('#modal-root').appendChild(back);
    stack.push(back);
    if (opts.onMount) opts.onMount(body, back);
    SFX.open();
    return { back, body, close: () => close(back) };
  }
  function close(back) { if (!back) return; back.remove(); const i = stack.indexOf(back); if (i >= 0) stack.splice(i, 1); }
  /** 열린 창을 모두 닫는다. dataset.keep 이 붙은 창(관리자 패널)은 남긴다 */
  function closeAll(force) {
    for (let i = stack.length - 1; i >= 0; i--) {
      const back = stack[i];
      if (!force && back.dataset.keep) continue;
      close(back);
    }
  }
  function confirmBox(title, msg, onYes, yesLabel) {
    modal({
      title, html: '<p style="line-height:1.8">' + esc(msg) + '</p>', closable: true,
      buttons: [
        { label: yesLabel || '확인', cls: 'pk-btn-red', onClick: onYes },
        { label: '취소', cls: 'pk-btn-ghost' }
      ]
    });
  }
  function prompt(title, label, onOk, opts) {
    opts = opts || {};
    modal({
      title,
      html: '<p style="margin-bottom:8px">' + esc(label) + '</p>' +
        '<input id="__pv" class="pk-input" type="' + (opts.password ? 'password' : 'text') + '" ' +
        (opts.numeric ? 'inputmode="numeric" ' : '') + 'maxlength="' + (opts.max || 30) + '">',
      buttons: [{ label: '확인', cls: 'pk-btn-main', onClick: (b, body) => onOk($('#__pv', body).value.trim()) },
      { label: '취소' }],
      onMount: (body) => {
        const i = $('#__pv', body);
        setTimeout(() => i.focus(), 60);
        i.addEventListener('keydown', e => {
          if (e.key === 'Enter') { const v = i.value.trim(); closeTop(); onOk(v); }
        });
      }
    });
  }
  function closeTop() { if (stack.length) close(stack[stack.length - 1]); }

  /* ---------------- 시간 포맷 ---------------- */
  function mmss(sec) {
    sec = Math.max(0, Math.floor(sec));
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }

  /* ---------------- 캐릭터 DOM ---------------- */
  function actorEl(avatarOpts, tag, tagCls, scale) {
    const wrap = el('div', 'actor');
    const c0 = PX.characterCanvas(avatarOpts, scale || 3, 0);
    const c1 = PX.characterCanvas(avatarOpts, scale || 3, 1);
    c1.style.display = 'none';
    wrap.appendChild(c0); wrap.appendChild(c1);
    let f = 0;
    wrap._anim = setInterval(() => {
      f ^= 1; c0.style.display = f ? 'none' : 'block'; c1.style.display = f ? 'block' : 'none';
    }, 520 + Math.random() * 200);
    if (tag) wrap.appendChild(el('div', 'actor-tag ' + (tagCls || ''), esc(tag)));
    return wrap;
  }
  function bubble(actor, text, ms) {
    const b = el('div', 'actor-bubble', esc(text));
    actor.appendChild(b);
    setTimeout(() => b.remove(), ms || 1800);
  }

  /* ---------------- 순위표 HTML ---------------- */
  function leaderboardHTML(rows, myUid) {
    if (!rows.length) return '<p style="text-align:center;padding:20px;color:#8a8f9c">아직 기록이 없습니다.</p>';
    let h = '<div class="scroll-y"><table class="pk-table"><thead><tr><th>#</th><th>이름</th><th>근무지</th><th>점수</th><th>시간</th><th>단서</th></tr></thead><tbody>';
    rows.forEach((r, i) => {
      const cls = (r.uid === myUid ? 'me-row' : (i < 3 ? 'rank-' + (i + 1) : ''));
      h += '<tr class="' + cls + '"><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.loc || '-') +
        '</td><td><b>' + r.score.toLocaleString() + '</b></td><td>' + mmss(r.time) + '</td><td>' + r.solved + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  /* ---------------- 배경음악 (부드럽게 켜고 끄기) ---------------- */
  const BGM_VOL = 0.18;          // 방 진행 중 볼륨
  let fadeTimer = null;
  function bgmEl() { return document.getElementById('bgm'); }

  /** 목표 볼륨까지 서서히 변화. to = 0 이면 다 줄어든 뒤 일시정지 */
  function bgmFade(to, ms) {
    const a = bgmEl(); if (!a) return;
    clearInterval(fadeTimer);
    if (!soundOn) { a.pause(); a.volume = 0; return; }
    to = Math.max(0, Math.min(1, to));
    ms = ms || 1500;
    if (to > 0 && a.paused) { a.volume = 0; a.play().catch(() => { }); }
    const from = a.volume, steps = Math.max(1, Math.round(ms / 60));
    let i = 0;
    fadeTimer = setInterval(() => {
      i++;
      const t = i / steps;
      a.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (i >= steps) {
        clearInterval(fadeTimer);
        a.volume = to;
        if (to === 0) a.pause();
      }
    }, 60);
  }
  /** 방 진행 중 — 소리를 원래대로 */
  function bgmUp(ms) { bgmFade(BGM_VOL, ms || 1200); }
  /** 대기실 — 조용히 사라지게 */
  function bgmDown(ms) { bgmFade(0, ms || 2000); }

  g.UI = {
    $, $$, el, esc, modal, close, closeAll, closeTop, confirmBox, prompt, toast, say, mmss,
    SFX, actorEl, bubble, leaderboardHTML,
    bgmFade, bgmUp, bgmDown, BGM_VOL,
    get soundOn() { return soundOn; },
    setSound(v) { soundOn = v; localStorage.setItem('s1fa.sound', v ? 'on' : 'off'); }
  };
})(window);
