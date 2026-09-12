/* ============================================================
   docs.js — 자료(문서) 뷰어
   ------------------------------------------------------------
   방 안에서 찾은 계획표 · 지침 액자 · 좌석 배치도 같은 자료를
   확대해서 들여다보고, 여러 장을 넘겨가며 조합해 푸는 화면.

   · 🔍 확대 / 축소 · 드래그로 이동 · 휠 줌
   · 🔦 UV 램프  — 자료에 숨겨진 글자가 램프 안에서만 드러난다
   · 자료가 여러 장이면 위쪽 탭으로 넘겨본다 (조합 문제용)
   ============================================================ */
(function (g) {
  'use strict';
  const { el, esc, modal, SFX } = g.UI;

  /* ---------- 자료 한 장 그리기 ---------- */
  function paperOf(doc) {
    const paper = el('div', 'doc-paper doc-' + (doc.kind || 'note'));
    if (doc.tint) paper.style.setProperty('--doc-tint', doc.tint);
    let h = '';

    if (doc.head) h += '<div class="doc-head">' + esc(doc.head) + '</div>';
    h += '<div class="doc-title">' + esc(doc.title || '') + '</div>';
    if (doc.sub) h += '<div class="doc-sub">' + esc(doc.sub) + '</div>';

    const kind = doc.kind || 'note';

    if (kind === 'frame') {
      h += '<ol class="doc-lines">' + (docLines(doc).map(t => '<li>' + esc(t) + '</li>').join('')) + '</ol>';

    } else if (kind === 'note') {
      h += '<div class="doc-note">' + docLines(doc).map(t => '<p>' + esc(t) + '</p>').join('') + '</div>';

    } else if (kind === 'table') {
      h += '<table class="doc-table"><thead><tr>' +
        (doc.cols || []).map(c => '<th>' + esc(c) + '</th>').join('') +
        '</tr></thead><tbody>' +
        (doc.rows || []).map(r => '<tr>' + r.map((c, i) =>
          (i === 0 ? '<th>' + esc(c) + '</th>' : '<td>' + esc(c) + '</td>')).join('') + '</tr>').join('') +
        '</tbody></table>';

    } else if (kind === 'seats') {
      // 좌석 배치도 : 행(A,B,C) × 열(1,2,3,4) 격자
      const cols = doc.cols || [], rows = doc.rows || [], cells = doc.cells || {};
      h += '<div class="doc-seatmap"><div class="doc-screenbar">' + esc(doc.front || '창가') + '</div>' +
        '<table class="doc-seats"><thead><tr><th></th>' +
        cols.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr><th>' + esc(r) + '</th>' + cols.map(c => {
          const cell = cells[r + c];
          if (!cell) return '<td class="empty">·</td>';
          return '<td><b>' + esc(r + c) + '</b><span>' + esc(cell.name || '') + '</span>' +
            (cell.no ? '<i>' + esc(cell.no) + '</i>' : '') + '</td>';
        }).join('') + '</tr>').join('') + '</tbody></table></div>';

    } else if (kind === 'labels') {
      h += '<div class="doc-labels">' + (doc.items || []).map(it =>
        '<div class="doc-label"><b>' + esc(it.k) + '</b><span>' + esc(it.v) + '</span></div>').join('') + '</div>';
    }

    if (doc.foot) h += '<div class="doc-foot">' + esc(doc.foot) + '</div>';
    paper.innerHTML = h;

    return paper;
  }

  /* UV 램프로만 보이는 글씨.
     종이 자체는 램프를 켜면 어둡게 깔리므로, 숨은 글씨는 종이 "위"에
     따로 얹어 어두워지지 않게 한다. */
  function uvLayerOf(doc) {
    if (!doc.uv || !doc.uv.length) return null;
    const layer = el('div', 'doc-uvlayer');
    doc.uv.forEach(u => {
      const t = el('div', 'doc-uvtext', esc(u.text));
      t.style.left = (u.x == null ? 50 : u.x) + '%';
      t.style.top = (u.y == null ? 50 : u.y) + '%';
      if (u.size) t.style.fontSize = u.size + 'px';
      if (u.rot) t.style.transform = 'translate(-50%,-50%) rotate(' + u.rot + 'deg)';
      layer.appendChild(t);
    });
    return layer;
  }

  /** 자료의 본문 줄 (크레도처럼 다른 데이터에서 끌어오는 자료 지원) */
  function docLines(doc) {
    if (doc.from === 'credo') return ((g.DATA.CREDO || {}).lines || []).slice();
    return doc.lines || [];
  }

  /* ---------- 자료 뷰어 열기 ---------- */
  /**
   * @param {string|string[]} ids  DATA.DOCS 의 키
   * @param {object} opts { title, start }
   */
  function open(ids, opts) {
    opts = opts || {};
    const DOCS = g.DATA.DOCS || {};
    const list = (Array.isArray(ids) ? ids : [ids]).map(id => ({ id, doc: DOCS[id] })).filter(x => x.doc);
    if (!list.length) return;

    const wrap = el('div', 'doc-view');
    wrap.innerHTML =
      (list.length > 1 ? '<div class="doc-tabs">' + list.map((x, i) =>
        '<button class="doc-tab' + (i === 0 ? ' on' : '') + '" data-i="' + i + '">' +
        (x.doc.icon || '📄') + ' ' + esc(x.doc.title || '자료') + '</button>').join('') + '</div>' : '') +
      '<div class="doc-stage" id="dstage"><div class="doc-zoom" id="dzoom"></div>' +
      '<div class="doc-lamp" id="dlamp"></div></div>' +
      '<div class="doc-bar">' +
      '<button class="doc-btn" data-z="-1">➖</button>' +
      '<span class="doc-zoomval" id="dzv">100%</span>' +
      '<button class="doc-btn" data-z="1">➕</button>' +
      '<button class="doc-btn" data-z="0">⟲ 원래대로</button>' +
      '<button class="doc-btn doc-uvbtn" id="duv">🔦 UV 램프</button>' +
      '</div>' +
      '<p class="doc-tip">드래그하면 움직이고, 휠·➕➖ 로 확대됩니다. 자료에 아무것도 없어 보이면 UV 램프를 켜보세요.</p>';

    return modal({
      title: opts.title || '🔎 자료 살펴보기', html: wrap, wide: true, closable: true,
      onMount: (body) => {
        const stage = body.querySelector('#dstage');
        const zoom = body.querySelector('#dzoom');
        const lamp = body.querySelector('#dlamp');
        const zv = body.querySelector('#dzv');
        let idx = 0, sc = 1, tx = 0, ty = 0, uv = false;

        const apply = () => {
          zoom.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + sc + ')';
          zv.textContent = Math.round(sc * 100) + '%';
        };
        const show = (i) => {
          idx = i; sc = 1; tx = 0; ty = 0;
          zoom.innerHTML = '';
          zoom.appendChild(paperOf(list[i].doc));
          const uvl = uvLayerOf(list[i].doc);
          if (uvl) zoom.appendChild(uvl);
          body.querySelectorAll('.doc-tab').forEach(t => t.classList.toggle('on', +t.dataset.i === i));
          apply();
        };
        const setZoom = (next, cx, cy) => {
          const before = sc;
          sc = Math.max(0.6, Math.min(3.2, next));
          if (cx != null) {                 // 커서 위치를 기준으로 확대
            const r = stage.getBoundingClientRect();
            const px = cx - r.left - r.width / 2 - tx, py = cy - r.top - r.height / 2 - ty;
            tx -= px * (sc / before - 1); ty -= py * (sc / before - 1);
          }
          apply();
        };

        body.querySelectorAll('.doc-tab').forEach(t => t.onclick = () => { SFX.select(); show(+t.dataset.i); });
        body.querySelectorAll('[data-z]').forEach(b => b.onclick = () => {
          SFX.tick();
          const z = +b.dataset.z;
          if (z === 0) { sc = 1; tx = 0; ty = 0; apply(); } else setZoom(sc + z * 0.35);
        });

        /* UV 램프 */
        const uvBtn = body.querySelector('#duv');
        uvBtn.onclick = () => {
          uv = !uv;
          stage.classList.toggle('uv-on', uv);
          uvBtn.classList.toggle('on', uv);
          if (uv) { SFX.warn(); g.UI.toast('🔦 램프를 자료 위에서 움직여 보세요', 'info', 1800); }
        };

        /* 드래그 이동 · 램프 따라다니기 */
        let down = false, sx = 0, sy = 0, bx = 0, by = 0;
        const pt = e => (e.touches && e.touches[0]) ? e.touches[0] : e;
        const move = (e) => {
          const p = pt(e);
          const r = stage.getBoundingClientRect();
          lamp.style.setProperty('--lx', (p.clientX - r.left) + 'px');
          lamp.style.setProperty('--ly', (p.clientY - r.top) + 'px');
          if (!down) return;
          tx = bx + (p.clientX - sx); ty = by + (p.clientY - sy);
          apply(); e.preventDefault();
        };
        stage.addEventListener('mousedown', e => { down = true; const p = pt(e); sx = p.clientX; sy = p.clientY; bx = tx; by = ty; stage.classList.add('grabbing'); });
        stage.addEventListener('touchstart', e => { down = true; const p = pt(e); sx = p.clientX; sy = p.clientY; bx = tx; by = ty; }, { passive: true });
        stage.addEventListener('mousemove', move);
        stage.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('mouseup', () => { down = false; stage.classList.remove('grabbing'); });
        window.addEventListener('touchend', () => { down = false; });
        stage.addEventListener('wheel', e => { setZoom(sc - Math.sign(e.deltaY) * 0.18, e.clientX, e.clientY); e.preventDefault(); }, { passive: false });

        show(opts.start ? Math.max(0, list.findIndex(x => x.id === opts.start)) : 0);
      }
    });
  }

  /** 문제·힌트에 붙일 "자료 보기" 버튼 HTML */
  function buttonsHTML(ids) {
    const DOCS = g.DATA.DOCS || {};
    return (ids || []).filter(id => DOCS[id]).map(id =>
      '<button class="doc-open" data-doc="' + esc(id) + '">' + (DOCS[id].icon || '📄') + ' ' +
      esc(DOCS[id].title) + ' 열기</button>').join('');
  }

  /** 위 버튼들에 클릭 동작을 연결한다 (자료 여러 장이면 탭으로 함께 열림) */
  function bind(container, ids) {
    container.querySelectorAll('.doc-open').forEach(b => {
      b.onclick = () => { SFX.select(); open(ids && ids.length > 1 ? ids : b.dataset.doc, { start: b.dataset.doc }); };
    });
  }

  g.DOCVIEW = { open, paperOf, uvLayerOf, buttonsHTML, bind };
})(window);
