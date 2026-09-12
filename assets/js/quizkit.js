/* ============================================================
   quizkit.js — 문제 입력 위젯 + 연출 효과
   ------------------------------------------------------------
   문제 종류(q.type)에 맞는 입력 화면을 그려주고,
   입력값을 "문자열 하나"로 정리해 game.js 의 채점으로 넘긴다.

     short  주관식 한 칸
     choice 객관식
     multi  여러 칸 (자료 두 장에서 얻은 값을 이어 붙일 때)
     order  순서대로 클릭해 배열하기
     grid   배치도에서 칸 하나 고르기
     lock   회전 다이얼 자물쇠

   정답 연출(색종이·도장)과 오답 연출(흔들림)도 여기에 있다.
   ============================================================ */
(function (g) {
  'use strict';
  const { el, esc, toast, SFX } = g.UI;

  /* ============================================================
     입력 위젯
     ============================================================ */
  /**
   * @param {object} q     문제
   * @param {Element} host 입력이 들어갈 자리
   * @param {function} submit  submit(값문자열, 눌린요소)
   */
  function mount(q, host, submit) {
    const type = q.type || 'short';
    if (type === 'choice') return mountChoice(q, host, submit);
    if (type === 'multi') return mountMulti(q, host, submit);
    if (type === 'order') return mountOrder(q, host, submit);
    if (type === 'grid') return mountGrid(q, host, submit);
    if (type === 'lock') return mountLock(q, host, submit);
    return mountShort(q, host, submit);
  }

  /* ---------- 주관식 ---------- */
  function mountShort(q, host, submit) {
    host.innerHTML =
      '<div class="quiz-input-row"><input id="qin" class="pk-input" type="text" maxlength="24" ' +
      'placeholder="' + esc(q.placeholder || '정답 입력 후 Enter') + '">' +
      '<button id="qsub" class="pk-btn pk-btn-main">제출</button></div>';
    const i = host.querySelector('#qin');
    i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(i.value, null); });
    host.querySelector('#qsub').onclick = () => submit(i.value, null);
    setTimeout(() => i.focus(), 80);
  }

  /* ---------- 객관식 ---------- */
  function mountChoice(q, host, submit) {
    host.innerHTML = '<div class="quiz-choices">' + q.choices.map((c, i) =>
      '<button class="quiz-choice" data-i="' + i + '">' + (i + 1) + '. ' + esc(c) + '</button>').join('') + '</div>';
    host.querySelectorAll('.quiz-choice').forEach(b => b.onclick = () => submit(b.dataset.i, b));
  }

  /* ---------- 여러 칸 (조합 정답) ----------
     q.slots : [{ label:'좌석 번호', len:2, hint:'예) A1' }, ...]
     정답은 각 칸을 순서대로 이어 붙인 문자열과 비교한다.            */
  function mountMulti(q, host, submit) {
    const slots = q.slots || [{ len: 4 }];
    host.innerHTML =
      '<div class="quiz-slots">' + slots.map((s, i) =>
        '<div class="quiz-slot"><label>' + esc(s.label || (i + 1) + '번째') + '</label>' +
        '<input class="pk-input slot-in" data-i="' + i + '" type="text" maxlength="' + (s.len || 4) + '" ' +
        'size="' + (s.len || 4) + '" placeholder="' + esc(s.hint || '') + '"></div>' +
        (i < slots.length - 1 ? '<span class="quiz-slot-plus">+</span>' : '')).join('') +
      '</div><div class="quiz-input-row"><button id="qsub" class="pk-btn pk-btn-main">제출</button></div>';

    const ins = Array.from(host.querySelectorAll('.slot-in'));
    const val = () => ins.map(i => i.value.trim()).join('');
    ins.forEach((inp, i) => {
      inp.addEventListener('input', () => {
        const max = +inp.getAttribute('maxlength');
        if (inp.value.length >= max && ins[i + 1]) ins[i + 1].focus();
      });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(val(), null); });
    });
    host.querySelector('#qsub').onclick = () => submit(val(), null);
    setTimeout(() => ins[0] && ins[0].focus(), 80);
  }

  /* ---------- 순서 배열 ----------
     q.items : 화면에 섞어서 보여줄 항목들
     q.order : 올바른 순서(항목 이름 그대로)                        */
  function mountOrder(q, host, submit) {
    const items = (q.items || q.order || []).slice().sort(() => Math.random() - .5);
    host.innerHTML =
      '<p class="quiz-sub">순서대로 눌러 배열하세요.</p>' +
      '<div class="quiz-order">' + items.map(t =>
        '<button class="ord-item" data-t="' + esc(t) + '"><i></i>' + esc(t) + '</button>').join('') + '</div>' +
      '<div class="quiz-input-row"><button id="qreset" class="pk-btn pk-btn-ghost">↺ 다시</button>' +
      '<button id="qsub" class="pk-btn pk-btn-main">제출</button></div>';

    let picked = [];
    const paint = () => host.querySelectorAll('.ord-item').forEach(b => {
      const n = picked.indexOf(b.dataset.t);
      b.classList.toggle('on', n >= 0);
      b.querySelector('i').textContent = n >= 0 ? (n + 1) : '';
    });
    host.querySelectorAll('.ord-item').forEach(b => b.onclick = () => {
      SFX.select();
      const t = b.dataset.t;
      if (picked.indexOf(t) >= 0) picked = picked.filter(x => x !== t); else picked.push(t);
      paint();
    });
    host.querySelector('#qreset').onclick = () => { picked = []; paint(); };
    host.querySelector('#qsub').onclick = () => {
      if (picked.length < items.length) { toast('아직 다 고르지 않았습니다.', 'info', 1400); return; }
      submit(picked.join(''), null);
    };
  }

  /* ---------- 배치도에서 칸 고르기 ----------
     q.gridRows / q.gridCols : 행·열 이름. 값은 "행+열" (예: B3)      */
  function mountGrid(q, host, submit) {
    const rows = q.gridRows || ['A', 'B', 'C'], cols = q.gridCols || ['1', '2', '3', '4'];
    host.innerHTML =
      '<p class="quiz-sub">' + esc(q.gridLabel || '해당하는 칸을 고르세요.') + '</p>' +
      '<table class="quiz-grid"><thead><tr><th></th>' + cols.map(c => '<th>' + esc(c) + '</th>').join('') +
      '</tr></thead><tbody>' + rows.map(r => '<tr><th>' + esc(r) + '</th>' +
        cols.map(c => '<td><button class="grid-cell" data-v="' + esc(r + c) + '">' + esc(r + c) + '</button></td>').join('') +
        '</tr>').join('') + '</tbody></table>' +
      '<div class="quiz-input-row"><span class="quiz-pick" id="qpick">선택: -</span>' +
      '<button id="qsub" class="pk-btn pk-btn-main">제출</button></div>';

    let pick = '';
    host.querySelectorAll('.grid-cell').forEach(b => b.onclick = () => {
      SFX.select(); pick = b.dataset.v;
      host.querySelectorAll('.grid-cell').forEach(x => x.classList.toggle('on', x === b));
      host.querySelector('#qpick').textContent = '선택: ' + pick;
    });
    host.querySelector('#qsub').onclick = () => {
      if (!pick) { toast('칸을 먼저 고르세요.', 'info', 1400); return; }
      submit(pick, null);
    };
  }

  /* ---------- 회전 다이얼 자물쇠 ----------
     q.digits : 다이얼 개수 (기본 4)
     q.chars  : 다이얼에 새겨진 글자 (기본 0~9)                      */
  function mountLock(q, host, submit) {
    const n = q.digits || 4;
    const chars = (q.chars || '0123456789').split('');
    const pos = new Array(n).fill(0);

    host.innerHTML =
      '<p class="quiz-sub">' + esc(q.lockLabel || '다이얼을 돌려 자물쇠를 여세요.') + '</p>' +
      '<div class="lock-row">' + Array.from({ length: n }, (_, i) =>
        '<div class="lock-dial"><button class="lock-up" data-i="' + i + '">▲</button>' +
        '<div class="lock-win"><span class="lock-prev" data-p="' + i + '"></span>' +
        '<b class="lock-cur" data-c="' + i + '"></b>' +
        '<span class="lock-next" data-n="' + i + '"></span></div>' +
        '<button class="lock-down" data-i="' + i + '">▼</button></div>').join('') + '</div>' +
      '<div class="quiz-input-row"><button id="qsub" class="pk-btn pk-btn-main">🔓 열기</button></div>';

    const paint = () => {
      for (let i = 0; i < n; i++) {
        const L = chars.length;
        host.querySelector('[data-c="' + i + '"]').textContent = chars[pos[i]];
        host.querySelector('[data-p="' + i + '"]').textContent = chars[(pos[i] - 1 + L) % L];
        host.querySelector('[data-n="' + i + '"]').textContent = chars[(pos[i] + 1) % L];
      }
    };
    const turn = (i, d) => {
      const L = chars.length;
      pos[i] = (pos[i] + d + L) % L;
      SFX.tick();
      const w = host.querySelectorAll('.lock-win')[i];
      w.classList.remove('spin'); void w.offsetWidth; w.classList.add('spin');
      paint();
    };
    host.querySelectorAll('.lock-up').forEach(b => b.onclick = () => turn(+b.dataset.i, -1));
    host.querySelectorAll('.lock-down').forEach(b => b.onclick = () => turn(+b.dataset.i, 1));
    host.querySelectorAll('.lock-win').forEach((w, i) =>
      w.addEventListener('wheel', e => { turn(i, Math.sign(e.deltaY)); e.preventDefault(); }, { passive: false }));
    host.querySelector('#qsub').onclick = () => submit(pos.map(p => chars[p]).join(''), null);
    paint();
  }

  /* ============================================================
     연출 효과
     ============================================================ */
  const CONFETTI = ['#e8b83b', '#3d6ea8', '#2e8b4f', '#c0392b', '#7b5ea7', '#f2a7c4'];

  /** 정답 : 화면 번쩍 + 색종이 + 도장 */
  function celebrate(node) {
    flash('#fff8d0');
    const root = document.getElementById('fx-root') || document.body;
    const box = el('div', 'confetti-box');
    for (let i = 0; i < 34; i++) {
      const c = el('i');
      c.style.left = Math.random() * 100 + '%';
      c.style.background = CONFETTI[i % CONFETTI.length];
      c.style.animationDelay = (Math.random() * .35) + 's';
      c.style.animationDuration = (1.1 + Math.random() * .9) + 's';
      c.style.transform = 'rotate(' + Math.floor(Math.random() * 360) + 'deg)';
      box.appendChild(c);
    }
    root.appendChild(box);
    setTimeout(() => box.remove(), 2400);
    if (node) stamp(node, '정답!');
  }

  /** 도장 찍기 */
  function stamp(node, text) {
    if (!node) return;
    const s = el('div', 'fx-stamp', esc(text || '정답!'));
    node.appendChild(s);
    setTimeout(() => s.remove(), 1400);
  }

  /** 오답 : 흔들림 + 붉은 번쩍 */
  function shake(node) {
    flash('#ff6b6b', .28);
    if (!node) return;
    node.classList.remove('fx-shake'); void node.offsetWidth; node.classList.add('fx-shake');
    setTimeout(() => node.classList.remove('fx-shake'), 620);
  }

  /** 화면 전체 번쩍 */
  function flash(color, alpha) {
    const root = document.getElementById('fx-root') || document.body;
    const f = el('div', 'fx-flash');
    f.style.background = color || '#fff';
    f.style.setProperty('--fa', alpha == null ? .55 : alpha);
    root.appendChild(f);
    setTimeout(() => f.remove(), 460);
  }

  g.QKIT = { mount, celebrate, shake, flash, stamp };
})(window);
