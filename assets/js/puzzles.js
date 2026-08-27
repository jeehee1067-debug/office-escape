/* ============================================================
   puzzles.js — 미니게임 (케이블 / 얼룩닦기 / 배율 다이얼 / 키패드)
   + 스테이지 오브젝트 드래그 헬퍼
   ============================================================ */
(function (g) {
  'use strict';
  const { el, modal, toast, SFX } = g.UI;

  /* ---------- 드래그 헬퍼 (마우스 · 터치 공용) ---------- */
  function makeDraggable(node, stage, opts) {
    opts = opts || {};
    let sx = 0, sy = 0, ox = 0, oy = 0, moved = 0, active = false, fired = false;
    node.classList.add('draggable');

    const down = (e) => {
      if (node.classList.contains('gone')) return;
      active = true; fired = false; moved = 0;
      const pt = e.touches ? e.touches[0] : e;
      sx = pt.clientX; sy = pt.clientY;
      ox = parseFloat(node.style.left); oy = parseFloat(node.style.top);
      node.classList.add('dragging');
      if (opts.onGrab) opts.onGrab();
      e.preventDefault();
    };
    const move = (e) => {
      if (!active) return;
      const pt = e.touches ? e.touches[0] : e;
      const r = stage.getBoundingClientRect();
      const dx = (pt.clientX - sx) / r.width * 100;
      const dy = (pt.clientY - sy) / r.height * 100;
      moved = Math.max(moved, Math.hypot(pt.clientX - sx, pt.clientY - sy));
      node.style.left = (ox + dx) + '%';
      node.style.top = (oy + dy) + '%';
      if (moved > 4 && !fired && opts.onDragStart) { fired = true; opts.onDragStart(); }
      e.preventDefault();
    };
    const up = () => {
      if (!active) return;
      active = false;
      node.classList.remove('dragging');
      const dist = moved;
      if (opts.onDrop) opts.onDrop(dist, node);
      else if (dist > (opts.threshold || 26) && opts.onMoved) opts.onMoved(node);
      else if (dist < 6 && opts.onTap) opts.onTap();
    };

    node.addEventListener('mousedown', down);
    node.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
    node._cleanup = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchend', up);
    };
  }

  /* ============================================================
     1) 케이블 연결
     ============================================================ */
  const WIRE_COLORS = [
    { c: '#c0392b', n: '빨강' }, { c: '#3d6ea8', n: '파랑' },
    { c: '#e8b83b', n: '노랑' }, { c: '#2e8b4f', n: '초록' }
  ];
  function wire(pairs, onDone) {
    pairs = Math.min(pairs || 3, 4);
    const cols = WIRE_COLORS.slice(0, pairs);
    const left = cols.slice().sort(() => Math.random() - .5);
    const right = cols.slice().sort(() => Math.random() - .5);

    const wrap = el('div');
    wrap.innerHTML =
      '<p style="margin-bottom:8px">끊어진 케이블을 <b>같은 색끼리</b> 연결하세요. (왼쪽 → 오른쪽 순서로 탭)</p>' +
      '<div class="mg-stage" style="height:190px"><svg class="wire-svg" viewBox="0 0 300 190" preserveAspectRatio="none"></svg>' +
      '<div class="wire-panel" style="height:100%;align-items:center">' +
      '<div class="wire-col" id="wl"></div><div class="wire-col" id="wr"></div></div></div>' +
      '<p id="wmsg" style="margin-top:8px;font-size:11px;color:#3f4453">남은 연결: ' + pairs + '개</p>';

    modal({
      title: '🔌 케이블 복구', html: wrap, closable: true, wide: false,
      onMount: (body) => {
        const svg = body.querySelector('.wire-svg');
        const L = body.querySelector('#wl'), R = body.querySelector('#wr');
        const msg = body.querySelector('#wmsg');
        let sel = null, done = 0;

        const mk = (col, side) => {
          const p = el('div', 'wire-port');
          p.style.background = col.c;
          p.dataset.color = col.c; p.dataset.side = side;
          p.title = col.n;
          return p;
        };
        left.forEach(c => L.appendChild(mk(c, 'L')));
        right.forEach(c => R.appendChild(mk(c, 'R')));

        const link = (a, b, color) => {
          const st = body.querySelector('.mg-stage').getBoundingClientRect();
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          const x1 = (ra.right - st.left) / st.width * 300, y1 = (ra.top + ra.height / 2 - st.top) / st.height * 190;
          const x2 = (rb.left - st.left) / st.width * 300, y2 = (rb.top + rb.height / 2 - st.top) / st.height * 190;
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', `M${x1},${y1} C${x1 + 60},${y1} ${x2 - 60},${y2} ${x2},${y2}`);
          path.setAttribute('stroke', color); path.setAttribute('stroke-width', '5');
          path.setAttribute('fill', 'none'); path.setAttribute('stroke-linecap', 'round');
          svg.appendChild(path);
        };

        body.querySelectorAll('.wire-port').forEach(p => {
          p.addEventListener('click', () => {
            if (p.classList.contains('done')) return;
            if (!sel) {
              if (p.dataset.side !== 'L') { toast('왼쪽 단자부터 선택하세요', 'info', 1300); return; }
              sel = p; p.classList.add('sel'); SFX.select(); return;
            }
            if (p === sel) { p.classList.remove('sel'); sel = null; return; }
            if (p.dataset.side !== 'R') { toast('오른쪽 단자를 선택하세요', 'info', 1300); return; }
            if (p.dataset.color === sel.dataset.color) {
              link(sel, p, p.dataset.color);
              sel.classList.add('done'); sel.classList.remove('sel');
              p.classList.add('done'); done++; SFX.ok();
              msg.textContent = '남은 연결: ' + (pairs - done) + '개';
              sel = null;
              if (done >= pairs) {
                msg.textContent = '✅ 배선 복구 완료!';
                setTimeout(() => { g.UI.closeTop(); onDone(); }, 550);
              }
            } else {
              SFX.no(); toast('색이 맞지 않습니다! 스파크가 튀었다 ⚡', 'bad', 1400);
              sel.classList.remove('sel'); sel = null;
            }
          });
        });
      }
    });
  }

  /* ============================================================
     2) 얼룩 닦기 (문질러서 지우기)
     ============================================================ */
  function wipe(code, onDone) {
    const wrap = el('div');
    wrap.innerHTML =
      '<p style="margin-bottom:8px">화면이 얼룩투성이다. <b>문질러서</b> 닦아내자! (마우스/손가락으로 드래그)</p>' +
      '<div class="mg-stage" style="position:relative;height:180px">' +
      '<div id="revealed" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:#0e1c2c;color:#67d67a;font-size:30px;letter-spacing:8px">' + g.UI.esc(code) + '</div>' +
      '<canvas id="dirt" style="position:absolute;inset:0;width:100%;height:100%;touch-action:none"></canvas></div>' +
      '<p id="wpmsg" style="margin-top:8px;font-size:11px;color:#3f4453">진행률 0%</p>';

    modal({
      title: '🧽 모니터 청소', html: wrap, closable: true,
      onMount: (body) => {
        const cv = body.querySelector('#dirt');
        const msg = body.querySelector('#wpmsg');
        const rect = () => cv.getBoundingClientRect();
        setTimeout(() => {
          const r = rect();
          cv.width = Math.max(100, r.width); cv.height = Math.max(60, r.height);
          const x = cv.getContext('2d');
          x.fillStyle = '#6b5a3e'; x.fillRect(0, 0, cv.width, cv.height);
          for (let i = 0; i < 260; i++) {
            x.fillStyle = ['#57492f', '#7d6a48', '#4a3d28'][i % 3];
            x.beginPath();
            x.arc(Math.random() * cv.width, Math.random() * cv.height, 4 + Math.random() * 14, 0, 7);
            x.fill();
          }
          x.globalCompositeOperation = 'destination-out';

          let down = false, cleared = 0, fired = false;
          const at = (e) => {
            const p = e.touches ? e.touches[0] : e, r2 = rect();
            return [(p.clientX - r2.left) / r2.width * cv.width, (p.clientY - r2.top) / r2.height * cv.height];
          };
          const rub = (e) => {
            if (!down) return;
            const [px, py] = at(e);
            x.beginPath(); x.arc(px, py, 22, 0, 7); x.fill();
            cleared++;
            if (cleared % 6 === 0) {
              const d = x.getImageData(0, 0, cv.width, cv.height).data;
              let clear = 0;
              for (let i = 3; i < d.length; i += 40) if (d[i] < 40) clear++;
              const pct = Math.round(clear / (d.length / 40) * 100);
              msg.textContent = '진행률 ' + Math.min(100, pct) + '%';
              if (pct > 72 && !fired) {
                fired = true; SFX.great();
                msg.textContent = '✅ 깨끗해졌다! 코드: ' + code;
                x.clearRect(0, 0, cv.width, cv.height);
                setTimeout(() => { g.UI.closeTop(); onDone(); }, 900);
              }
            }
            e.preventDefault();
          };
          cv.addEventListener('mousedown', e => { down = true; rub(e); });
          cv.addEventListener('touchstart', e => { down = true; rub(e); }, { passive: false });
          cv.addEventListener('mousemove', rub);
          cv.addEventListener('touchmove', rub, { passive: false });
          window.addEventListener('mouseup', () => down = false);
          window.addEventListener('touchend', () => down = false);
        }, 60);
      }
    });
  }

  /* ============================================================
     3) 배율 다이얼
     ============================================================ */
  function dial(target, tol, hint, onDone) {
    const start = Math.max(5, Math.min(95, target + (Math.random() > .5 ? 1 : -1) * (18 + Math.floor(Math.random() * 18))));
    const wrap = el('div');
    wrap.innerHTML =
      '<p style="margin-bottom:6px">' + g.UI.esc(hint || '규정 배율로 다이얼을 맞추세요.') + '</p>' +
      '<div class="dial-wrap"><div class="dial-val"><span id="dv">' + start + '</span> kX</div>' +
      '<input id="dr" type="range" min="1" max="99" value="' + start + '">' +
      '<div id="dst" style="font-size:12px;color:#3f4453">다이얼을 움직여 보세요</div></div>';

    modal({
      title: '🔬 VSEM 배율 조정', html: wrap, closable: true,
      buttons: [{ label: '✔ 이 값으로 설정', cls: 'pk-btn-main', close: false, onClick: (back, body) => {
        const v = +body.querySelector('#dr').value;
        if (Math.abs(v - target) <= (tol || 2)) { SFX.great(); g.UI.closeTop(); onDone(); }
        else { SFX.no(); toast('배율이 맞지 않습니다. 초점이 흐릿하다...', 'bad'); }
      } }],
      onMount: (body) => {
        const r = body.querySelector('#dr'), v = body.querySelector('#dv'), st = body.querySelector('#dst');
        r.addEventListener('input', () => {
          v.textContent = r.value;
          const d = Math.abs(+r.value - target);
          st.textContent = d <= (tol || 2) ? '🎯 초점이 선명하다!' : d < 8 ? '🔎 거의 다 왔다...' : d < 20 ? '흐릿하다' : '완전히 흐리다';
          st.style.color = d <= (tol || 2) ? '#2e8b4f' : '#3f4453';
          SFX.tick();
        });
      }
    });
  }

  /* ============================================================
     4) 금고 키패드
     ============================================================ */
  function keypad(code, onDone) {
    const wrap = el('div');
    wrap.innerHTML =
      '<p style="margin-bottom:8px">금고에 네 자리 비밀번호를 입력하세요.</p>' +
      '<div class="keypad-display" id="kd">----</div><div class="keypad" id="kp"></div>';
    modal({
      title: '🔐 비밀 금고', html: wrap, closable: true,
      onMount: (body) => {
        const disp = body.querySelector('#kd'), pad = body.querySelector('#kp');
        let buf = '';
        const render = () => disp.textContent = (buf + '----').slice(0, 4);
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '0', '✔'].forEach(k => {
          const b = el('button', '', k);
          b.onclick = () => {
            SFX.select();
            if (k === '←') buf = buf.slice(0, -1);
            else if (k === '✔') {
              if (buf === String(code)) { SFX.great(); disp.style.color = '#8ef08e'; setTimeout(() => { g.UI.closeTop(); onDone(); }, 400); }
              else { SFX.no(); toast('삐— 비밀번호가 틀렸습니다!', 'bad'); disp.style.color = '#ff8a80'; buf = ''; setTimeout(() => disp.style.color = '#8ef08e', 500); }
            } else if (buf.length < 4) buf += k;
            render();
          };
          pad.appendChild(b);
        });
        render();
      }
    });
  }

  g.PUZZLE = { wire, wipe, dial, keypad, makeDraggable };
})(window);
