/* ============================================================
   pixel.js — GBA(240x160) 해상도 픽셀아트 렌더링 엔진
   캐릭터 / 오브젝트 / 배경 씬을 캔버스에 직접 찍어 그린다.
   ============================================================ */
(function (global) {
  'use strict';

  const W = 240, H = 160;              // 씬 기준 해상도 (GBA와 동일)
  const OUT = '#1d2029';               // 공통 외곽선

  /* ---------- 기본 유틸 ---------- */
  function make(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    return c;
  }
  function ctxOf(c) { const x = c.getContext('2d'); x.imageSmoothingEnabled = false; return x; }
  function P(x, ox, oy) { return (a, b, w, h, c) => { x.fillStyle = c; x.fillRect(ox + a, oy + b, w, h); }; }
  function box(x, a, b, w, h, fill, line) {
    x.fillStyle = line || OUT; x.fillRect(a, b, w, h);
    x.fillStyle = fill; x.fillRect(a + 1, b + 1, w - 2, h - 2);
  }
  function rnd(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = s * 16807 % 2147483647) / 2147483647; }

  /* ---------- 3x5 비트맵 폰트 (표지판/숫자용) ---------- */
  const F = {
    A:'111101111101101',B:'110101110101110',C:'111100100100111',D:'110101101101110',
    E:'111100110100111',F:'111100110100100',G:'111100101101111',H:'101101111101101',
    I:'111010010010111',J:'001001001101111',K:'101101110101101',L:'100100100100111',
    M:'101111111101101',N:'110101101101101',O:'111101101101111',P:'111101111100100',
    Q:'111101101111011',R:'111101111110101',S:'111100111001111',T:'111010010010010',
    U:'101101101101111',V:'101101101101010',W:'101101111111101',X:'101101010101101',
    Y:'101101010010010',Z:'111001010100111',
    '0':'111101101101111','1':'010110010010111','2':'111001111100111','3':'111001111001111',
    '4':'101101111001001','5':'111100111001111','6':'111100111101111','7':'111001001001001',
    '8':'111101111101111','9':'111101111001111',
    '-':'000000111000000','.':'000000000000010','/':'001001010100100',':':'000010000010000',' ':'000000000000000'
  };
  function text(x, str, px, py, color, scale) {
    scale = scale || 1; x.fillStyle = color;
    str = String(str).toUpperCase();
    for (let i = 0; i < str.length; i++) {
      const g = F[str[i]]; if (!g) continue;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++)
        if (g[r * 3 + c] === '1') x.fillRect(px + (i * 4 + c) * scale, py + r * scale, scale, scale);
    }
  }
  function textW(str, scale) { return String(str).length * 4 * (scale || 1); }

  /* ============================================================
     캐릭터 — 32 x 48 도트 스프라이트 (sprites.js 의 문자 그리드를 색칠)
     ============================================================ */
  const CH_W = 38, CH_H = 60;

  /** 색 밝기 조절 (-1 어둡게 ~ +1 밝게) */
  function tint(hex, f) {
    const n = parseInt(String(hex).replace('#', ''), 16);
    let r = (n >> 16) & 255, g2 = (n >> 8) & 255, b = n & 255;
    if (f >= 0) { r += (255 - r) * f; g2 += (255 - g2) * f; b += (255 - b) * f; }
    else { r *= (1 + f); g2 *= (1 + f); b *= (1 + f); }
    return '#' + [r, g2, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  }

  function paletteFor(o) {
    const skin = o.skin || '#f8dcbb';
    const hair = o.hair || '#3a2a1d';
    const top = o.top || '#4f7fd4';
    const pants = o.pants || '#2f3a52';
    const eye = o.eye || '#5d7ba8';
    const cap = o.cap || '#c0392b';
    return {
      O: '#20242e',
      S: skin, d: tint(skin, -0.10), n: tint(skin, -0.22), F: tint(skin, 0.15),
      b: '#f4a2ab', m: '#b3695f',
      e: '#23283a', i: tint(eye, -0.38), I: eye, w: '#ffffff',
      h: hair, H: tint(hair, 0.34), k: tint(hair, -0.38),
      c: top, C: tint(top, 0.24), v: tint(top, -0.20),
      p: pants, P: tint(pants, -0.24),
      f: o.shoes || '#2a2f3c',
      g: '#2b2f3a', G: '#d6ecff',
      t: o.tie || '#c0392b',
      L: '#f6f6f2', l: '#d8d8d0',
      q: cap, Q: tint(cap, -0.32),
      B: o.badge || '#3d6ea8'
    };
  }

  function paintGrid(x, rows, pal, bob) {
    for (let y = 0; y < rows.length; y++) {
      const line = rows[y], dy = (bob && y < rows.length - 3) ? 1 : 0;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '.' || ch === ' ') continue;
        const col = pal[ch]; if (!col) continue;
        x.fillStyle = col; x.fillRect(i, y + dy, 1, 1);
      }
    }
  }

  /** 캐릭터를 캔버스에 그린다 (frame 0|1 : 숨쉬기 애니메이션) */
  function drawChibi(x, ox, oy, o, frame) {
    const S = global.SPR; if (!S) return;
    const pal = paletteFor(o), bob = !!frame;
    x.save(); x.translate(ox, oy);
    paintGrid(x, S.BASE, pal, bob);
    if (o.skirt) paintGrid(x, S.SKIRT, pal, bob);
    if (o.tie) paintGrid(x, S.TIE, pal, bob);
    if (o.coat) paintGrid(x, S.COAT, pal, bob);
    if (o.badge) paintGrid(x, S.BADGE, pal, bob);
    paintGrid(x, S.HAIR[o.style] || S.HAIR.short, pal, bob);
    if (o.glasses) paintGrid(x, S.GLASSES, pal, bob);
    x.restore();
  }

  /* ---- PNG 스프라이트 지원 ----
     직접 그렸거나 준비한 이미지를 캐릭터로 쓰고 싶을 때 사용한다.
     PX.setCharImage('girl', 'assets/img/char/girl.png')  →  AVATARS 에 sprite:'girl' 추가
     이미지 크기는 자유(도트 원본 크기 그대로 권장). 화면에서는 키 48 기준으로 맞춰진다. */
  const charImages = {};
  function setCharImage(key, url) {
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        charImages[key] = im;
        document.dispatchEvent(new CustomEvent('s1fa:sprite', { detail: key }));
        res(im);
      };
      im.onerror = () => res(null);
      im.src = url;
    });
  }
  function hasCharImage(key) { return !!charImages[key]; }

  /** 캐릭터 캔버스 생성. canvas.dataset.uw/uh 에 씬 좌표 기준 크기가 담긴다. */
  function characterCanvas(opts, scale, frame) {
    scale = scale || 4;
    const img = opts && opts.sprite && charImages[opts.sprite];
    if (img) {
      const c = make(img.naturalWidth * scale, img.naturalHeight * scale);
      const x = ctxOf(c);
      x.imageSmoothingEnabled = false;
      // 숨쉬기 프레임: 아랫부분(발)은 고정하고 윗부분만 1px 내림
      const cut = Math.round(img.naturalHeight * 0.93);
      if (frame) {
        x.drawImage(img, 0, 0, img.naturalWidth, cut, 0, scale, c.width, cut * scale);
        x.drawImage(img, 0, cut, img.naturalWidth, img.naturalHeight - cut,
          0, cut * scale, c.width, (img.naturalHeight - cut) * scale);
      } else {
        x.drawImage(img, 0, 0, c.width, c.height);
      }
      // 화면 크기: 높이를 기준으로 맞추고 가로는 원본 비율 유지
      const cfg = (global.DATA && global.DATA.CONFIG) || {};
      const uh = (opts && opts.spriteH) || cfg.SPRITE_HEIGHT || CH_H;
      c.dataset.uh = uh;
      c.dataset.uw = Math.round(uh * img.naturalWidth / img.naturalHeight);
      return c;
    }
    const c = make(CH_W * scale, CH_H * scale);
    const x = ctxOf(c);
    x.save(); x.scale(scale, scale);
    drawChibi(x, 0, 0, opts || {}, frame || 0);
    x.restore();
    c.dataset.uw = CH_W; c.dataset.uh = CH_H;
    return c;
  }

  /* ============================================================
     배경 프리미티브
     ============================================================ */
  function floorTiles(x, y0, c1, c2, seam) {
    let y = y0, i = 0;
    while (y < H) {
      const hh = Math.max(5, Math.round(5 + i * 1.35));
      for (let px = -14, j = 0; px < W + 14; px += 24, j++) {
        x.fillStyle = ((i + j) % 2) ? c1 : c2;
        x.fillRect(px, y, 24, hh);
      }
      x.fillStyle = seam; x.fillRect(0, y, W, 1);
      y += hh; i++;
    }
  }
  function wall(x, top, hy, c, base) {
    x.fillStyle = c; x.fillRect(0, top, W, hy - top);
    x.fillStyle = 'rgba(255,255,255,.14)'; x.fillRect(0, top, W, 3);
    x.fillStyle = 'rgba(0,0,0,.05)'; x.fillRect(0, hy - 18, W, 12);
    x.fillStyle = base; x.fillRect(0, hy - 6, W, 6);
    x.fillStyle = OUT; x.fillRect(0, hy - 7, W, 1);
  }
  function ceilingLights(x, y) {
    y = y || 3;
    for (let i = 0; i < 3; i++) {
      const px = 22 + i * 78;
      box(x, px, y, 46, 7, '#4a505c', '#20242e');
      x.fillStyle = '#fff6c8'; x.fillRect(px + 2, y + 2, 42, 3);
      x.fillStyle = '#ffffff'; x.fillRect(px + 3, y + 2, 40, 1);
      x.fillStyle = '#ffe9a0'; x.fillRect(px + 2, y + 5, 42, 1);
      x.fillStyle = 'rgba(255,253,224,.18)';
      x.beginPath(); x.moveTo(px + 2, y + 7); x.lineTo(px + 46, y + 7);
      x.lineTo(px + 54, y + 22); x.lineTo(px - 6, y + 22); x.closePath(); x.fill();
    }
  }
  /** 천장 밴드 + 조명 */
  function ceiling(x, h) {
    h = h || 12;
    x.fillStyle = '#3c414c'; x.fillRect(0, 0, W, h);
    x.fillStyle = '#2c313b'; x.fillRect(0, h - 2, W, 2);
    for (let i = 0; i < 8; i++) { x.fillStyle = '#4d5460'; x.fillRect(i * 32, 0, 2, h - 2); }
    ceilingLights(x, 2);
  }

  function windowPane(x, px, py, w, h) {
    box(x, px, py, w, h, '#bfe3f5', '#6f7683');
    x.fillStyle = '#a9d6ee'; x.fillRect(px + 1, py + h / 2, w - 2, h / 2 - 1);
    x.fillStyle = '#8fc46f'; x.fillRect(px + 2, py + h - 8, w - 4, 6);
    x.fillStyle = '#6ea854'; x.fillRect(px + 4, py + h - 11, 6, 4);
    x.fillStyle = '#6ea854'; x.fillRect(px + w - 12, py + h - 10, 7, 3);
    x.fillStyle = '#6f7683';
    for (let i = 1; i * 22 < w; i++) x.fillRect(px + i * 22, py, 2, h);
    x.fillRect(px, py + Math.floor(h / 2), w, 2);
    x.fillStyle = '#ffffff55'; x.fillRect(px + 3, py + 3, 8, 2);
  }
  function whiteboard(x, px, py, w, h, seed) {
    box(x, px, py, w, h, '#f7f7f2', '#9aa0a8');
    x.fillStyle = '#c9ccd2'; x.fillRect(px + 1, py + h - 4, w - 2, 3);
    const r = rnd(seed || 7);
    x.fillStyle = '#3d6ea8';
    for (let i = 0; i < 16; i++) {
      const bx = px + 4 + Math.floor(r() * (w - 20));
      const by = py + 5 + Math.floor(r() * (h - 16));
      x.fillRect(bx, by, 4 + Math.floor(r() * 12), 1);
    }
    x.fillStyle = '#c0392b';
    for (let i = 0; i < 5; i++) {
      const bx = px + 6 + Math.floor(r() * (w - 24));
      const by = py + 6 + Math.floor(r() * (h - 18));
      x.strokeStyle = '#c0392b'; x.lineWidth = 1;
      x.strokeRect(bx + .5, by + .5, 9, 6);
    }
    x.fillStyle = '#2e8b4f'; x.fillRect(px + 6, py + h - 12, 20, 1); x.fillRect(px + 6, py + h - 15, 14, 1);
    text(x, 'S1FA', px + w - 24, py + 4, '#1f4e9c', 1);
    x.fillStyle = '#e8b83b'; x.fillRect(px + w - 26, py + h - 6, 6, 2);
    x.fillStyle = '#c0392b'; x.fillRect(px + w - 18, py + h - 6, 6, 2);
  }
  function deskLong(x, px, py, w, top, side) {
    box(x, px - 2, py - 3, w + 4, 6, top || '#e8e2d2', '#9c957f');   // 상판(앞으로 튀어나온 부분)
    x.fillStyle = 'rgba(255,255,255,.5)'; x.fillRect(px, py - 2, w, 2);
    x.fillStyle = side || '#cfc7b2'; x.fillRect(px - 2, py + 3, w + 4, 7);   // 앞면
    x.fillStyle = 'rgba(0,0,0,.12)'; x.fillRect(px - 2, py + 8, w + 4, 2);
    x.fillStyle = OUT; x.fillRect(px - 2, py + 10, w + 4, 1);
    x.fillStyle = '#a8a08c'; x.fillRect(px + 2, py + 11, 3, 16); x.fillRect(px + w - 5, py + 11, 3, 16);
    x.fillStyle = 'rgba(0,0,0,.10)'; x.fillRect(px - 2, py + 27, w + 4, 3);
  }
  function drawers(x, px, py, w, h) {
    box(x, px, py, w, h, '#ded8c6', '#8e876f');
    for (let i = 0; i < 3; i++) {
      x.fillStyle = '#8e876f'; x.fillRect(px + 1, py + 3 + i * Math.floor(h / 3), w - 2, 1);
      x.fillStyle = '#6f6a58'; x.fillRect(px + w / 2 - 3, py + 6 + i * Math.floor(h / 3), 6, 1);
    }
  }
  function monitor(x, px, py, w, h, screen, code) {
    box(x, px, py, w, h, '#2b2f3a', OUT);
    x.fillStyle = screen || '#12324a'; x.fillRect(px + 2, py + 2, w - 4, h - 5);
    const r = rnd((code || 3) * 31 + px);
    if (code === 1) { x.fillStyle = '#67d67a'; for (let i = 0; i < 7; i++) x.fillRect(px + 3, py + 4 + i * 2, 3 + Math.floor(r() * (w - 10)), 1); }
    else if (code === 2) { x.fillStyle = '#7fc7f5'; x.strokeStyle = '#7fc7f5'; x.lineWidth = 1; for (let i = 0; i < 4; i++) x.strokeRect(px + 4 + i * 4 + .5, py + 4 + i * 2 + .5, 8, 5); }
    else { x.fillStyle = '#ffd35c'; for (let i = 0; i < 5; i++) x.fillRect(px + 3 + Math.floor(r() * 6), py + 4 + i * 2, 4 + Math.floor(r() * 8), 1); }
    x.fillStyle = '#ffffff22'; x.fillRect(px + 2, py + 2, w - 4, 1);
    x.fillStyle = '#2b2f3a'; x.fillRect(px + w / 2 - 2, py + h, 4, 3);
    x.fillStyle = OUT; x.fillRect(px + w / 2 - 5, py + h + 3, 10, 2);
  }
  function keyboard(x, px, py, w) {
    box(x, px, py, w, 5, '#dfdcd2', '#8e8b80');
    x.fillStyle = '#a9a69b';
    for (let i = 0; i < Math.floor((w - 4) / 3); i++) x.fillRect(px + 2 + i * 3, py + 2, 2, 1);
  }
  function tower(x, px, py, w, h) {
    box(x, px, py, w, h, '#3a3f4b', OUT);
    x.fillStyle = '#22262f'; x.fillRect(px + 2, py + 2, w - 4, 3);
    x.fillStyle = '#67d67a'; x.fillRect(px + w - 5, py + h - 5, 2, 2);
    x.fillStyle = '#5b6270'; x.fillRect(px + 2, py + h - 8, w - 4, 1);
  }
  function shelfUnit(x, px, py, w, h, seed) {
    box(x, px, py, w, h, '#cfd3d8', '#7d838c');
    const rows = 3, rh = Math.floor(h / rows), r = rnd(seed || 11);
    const cols = ['#c99a6a', '#a9b7c6', '#d6b48b', '#8fa3bb', '#c4c9b3'];
    for (let i = 0; i < rows; i++) {
      const yy = py + i * rh;
      x.fillStyle = '#7d838c'; x.fillRect(px + 1, yy + rh - 1, w - 2, 1);
      for (let bx = px + 2; bx < px + w - 6; bx += 11) {
        const bw = 9, bh = rh - 4;
        box(x, bx, yy + 2, bw, bh, cols[Math.floor(r() * cols.length)], '#7a6a53');
        x.fillStyle = '#00000022'; x.fillRect(bx + 1, yy + 3 + Math.floor(bh / 2), bw - 2, 1);
      }
    }
  }
  function serverRack(x, px, py, w, h) {
    box(x, px, py, w, h, '#31363f', OUT);
    for (let i = 0; i < Math.floor((h - 6) / 7); i++) {
      const yy = py + 3 + i * 7;
      box(x, px + 2, yy, w - 4, 5, '#454b57', '#22262f');
      x.fillStyle = i % 2 ? '#67d67a' : '#ffd35c'; x.fillRect(px + w - 7, yy + 2, 2, 2);
      x.fillStyle = '#7fc7f5'; x.fillRect(px + 4, yy + 2, 2, 2);
    }
  }
  function plantSmallBig(x, px, py) {
    box(x, px, py + 12, 14, 12, '#b4653a', '#7a4324');
    x.fillStyle = '#2e8b4f';
    x.fillRect(px + 5, py + 2, 4, 11); x.fillRect(px, py + 5, 6, 4);
    x.fillRect(px + 8, py + 1, 6, 5); x.fillRect(px + 2, py, 5, 4);
    x.fillStyle = '#3fae66'; x.fillRect(px + 3, py + 1, 2, 2);
  }
  function plant(x, px, py) {
    box(x, px, py + 10, 12, 9, '#b4653a', '#7a4324');
    x.fillStyle = '#2e8b4f';
    x.fillRect(px + 4, py + 2, 4, 9); x.fillRect(px, py + 4, 5, 3);
    x.fillRect(px + 7, py + 1, 5, 4); x.fillRect(px + 2, py, 4, 4); x.fillRect(px + 8, py + 6, 4, 3);
    x.fillStyle = '#3fae66'; x.fillRect(px + 3, py + 1, 2, 2); x.fillRect(px + 9, py + 7, 2, 2);
  }
  function doorway(x, px, py, w, h, open) {
    box(x, px - 3, py - 4, w + 6, h + 4, '#cfc9b8', '#8e8b80');   // 문틀
    box(x, px, py, w, h, '#8b5e34', '#4a3320');
    x.fillStyle = '#a97445'; x.fillRect(px + 2, py + 2, w - 4, h - 4);
    x.fillStyle = '#8b5e34'; x.fillRect(px + 3, py + 5, w - 6, Math.floor(h / 2) - 8);
    x.fillStyle = '#8b5e34'; x.fillRect(px + 3, py + Math.floor(h / 2) + 3, w - 6, Math.floor(h / 2) - 8);
    x.fillStyle = '#e8b83b'; x.fillRect(px + w - 7, py + Math.floor(h / 2) - 1, 4, 4);
    // 문 위 표지판
    box(x, px + 1, py - 11, w - 2, 8, open ? '#2e8b4f' : '#c0392b', OUT);
    const t = open ? 'OPEN' : 'EXIT';
    text(x, t, px + Math.floor(w / 2) - Math.floor(textW(t) / 2) + 1, py - 9, '#ffffff');
    if (open) { x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(px + 2, py + 2, w - 4, h - 4); }
  }

  function poster(x, px, py, w, h, c1, c2, label) {
    box(x, px, py, w, h, c1, OUT);
    x.fillStyle = c2; x.fillRect(px + 2, py + 2, w - 4, Math.floor(h / 2) - 2);
    if (label) text(x, label, px + 3, py + h - 8, '#20242e');
  }
  function cooler(x, px, py) {
    box(x, px, py, 14, 16, '#dfe6ec', '#8b939c');
    box(x, px + 1, py - 12, 12, 13, '#9fd8f0', '#6f8ea0');
    x.fillStyle = '#7fc7f5'; x.fillRect(px + 2, py - 6, 10, 6);
    x.fillStyle = '#4b5563'; x.fillRect(px + 4, py + 5, 6, 2);
    x.fillStyle = '#c0392b'; x.fillRect(px + 3, py + 8, 3, 2);
    x.fillStyle = '#3d6ea8'; x.fillRect(px + 8, py + 8, 3, 2);
  }
  function coffeeMachine(x, px, py) {
    box(x, px, py, 18, 24, '#3a3f4b', OUT);
    x.fillStyle = '#22262f'; x.fillRect(px + 3, py + 12, 12, 9);
    x.fillStyle = '#c0392b'; x.fillRect(px + 4, py + 4, 4, 3);
    x.fillStyle = '#e8b83b'; x.fillRect(px + 10, py + 4, 4, 3);
    x.fillStyle = '#7fc7f5'; x.fillRect(px + 4, py + 8, 10, 2);
    x.fillStyle = '#8e8b80'; x.fillRect(px + 8, py + 12, 2, 3);
  }
  function vending(x, px, py) {
    box(x, px, py, 24, 40, '#c0392b', OUT);
    box(x, px + 2, py + 2, 14, 26, '#2b2f3a', '#111');
    const cols = ['#7fc7f5', '#e8b83b', '#67d67a', '#f5a3c7'];
    for (let r0 = 0; r0 < 3; r0++) for (let c0 = 0; c0 < 3; c0++) {
      x.fillStyle = cols[(r0 + c0) % 4]; x.fillRect(px + 4 + c0 * 4, py + 5 + r0 * 8, 3, 6);
    }
    x.fillStyle = '#dfe6ec'; x.fillRect(px + 18, py + 4, 4, 16);
    x.fillStyle = '#20242e'; x.fillRect(px + 2, py + 30, 20, 7);
  }
  function sofa(x, px, py, w, c) {
    box(x, px, py, w, 10, c || '#5b7fa8', OUT);
    box(x, px, py + 8, w, 8, c || '#5b7fa8', OUT);
    x.fillStyle = '#ffffff33'; x.fillRect(px + 2, py + 2, w - 4, 2);
    x.fillStyle = OUT; x.fillRect(px + 1, py + 15, 3, 4); x.fillRect(px + w - 4, py + 15, 3, 4);
  }
  function roundTable(x, px, py, w) {
    const cx = px + Math.floor(w / 2);
    box(x, px + 3, py, w - 6, 3, '#f2ecdc', '#9c957f');       // 상판 윗면
    box(x, px, py + 2, w, 7, '#e8e2d2', '#9c957f');           // 상판 앞면
    x.fillStyle = 'rgba(255,255,255,.55)'; x.fillRect(px + 3, py + 3, w - 6, 1);
    x.fillStyle = '#c9c1a8'; x.fillRect(px + 1, py + 7, w - 2, 2);
    x.fillStyle = OUT; x.fillRect(px, py + 9, w, 1);
    x.fillStyle = '#b8b09a'; x.fillRect(cx - 3, py + 10, 6, 13);   // 기둥
    x.fillStyle = '#8e876f'; x.fillRect(cx + 1, py + 10, 2, 13);
    box(x, cx - 10, py + 22, 20, 4, '#b8b09a', '#8e876f');         // 받침
    x.fillStyle = 'rgba(0,0,0,.10)'; x.fillRect(px + 2, py + 26, w - 4, 2);
  }
  function noticeBoard(x, px, py, w, h) {
    box(x, px, py, w, h, '#c99a6a', '#7a5a34');
    const cols = ['#f7f7f2', '#ffe9a8', '#cfe8ff', '#ffd7d0'];
    const r = rnd(29);
    for (let i = 0; i < 6; i++) {
      const bx = px + 3 + (i % 3) * Math.floor((w - 8) / 3);
      const by = py + 3 + Math.floor(i / 3) * Math.floor((h - 6) / 2);
      x.fillStyle = cols[Math.floor(r() * 4)]; x.fillRect(bx, by, 12, 9);
      x.fillStyle = '#8e8b80'; x.fillRect(bx + 1, by + 2, 9, 1); x.fillRect(bx + 1, by + 5, 7, 1);
    }
  }
  function semMachine(x, px, py) {
    box(x, px, py, 34, 34, '#dfe6ec', '#8b939c');
    box(x, px + 6, py - 22, 16, 24, '#b9c4cd', '#7d838c');
    x.fillStyle = '#7d838c'; x.fillRect(px + 10, py - 26, 8, 5);
    box(x, px + 24, py + 4, 9, 12, '#2b2f3a', OUT);
    x.fillStyle = '#67d67a'; x.fillRect(px + 26, py + 6, 5, 4);
    x.fillStyle = '#4b5563'; x.fillRect(px + 4, py + 22, 26, 2);
    x.fillStyle = '#e8b83b'; x.fillRect(px + 5, py + 26, 3, 3);
    x.fillStyle = '#c0392b'; x.fillRect(px + 10, py + 26, 3, 3);
    text(x, 'VSEM', px + 6, py + 12, '#1f4e9c');
  }
  function gasCylinder(x, px, py, c) {
    box(x, px, py, 9, 26, c || '#2e8b4f', '#1c5c34');
    x.fillStyle = '#b9c4cd'; x.fillRect(px + 3, py - 4, 3, 5);
    x.fillStyle = '#ffffff33'; x.fillRect(px + 1, py + 2, 2, 20);
    x.fillStyle = '#e8e2d2'; x.fillRect(px + 1, py + 12, 7, 4);
  }
  function fumeHood(x, px, py, w, h) {
    box(x, px, py, w, h, '#cfd3d8', '#7d838c');
    box(x, px + 3, py + 3, w - 6, h - 16, '#a9d6ee', '#6f8ea0');
    x.fillStyle = '#ffffff55'; x.fillRect(px + 5, py + 5, 8, 2);
    x.fillStyle = '#8b939c'; x.fillRect(px + 3, py + h - 12, w - 6, 3);
    x.fillStyle = '#c0392b'; x.fillRect(px + w - 10, py + h - 8, 4, 3);
  }
  function fridge(x, px, py) {
    box(x, px, py, 18, 34, '#e6ebef', '#8b939c');
    x.fillStyle = '#8b939c'; x.fillRect(px + 1, py + 12, 16, 1);
    x.fillStyle = '#4b5563'; x.fillRect(px + 13, py + 4, 2, 6); x.fillRect(px + 13, py + 16, 2, 8);
    x.fillStyle = '#ffe9a8'; x.fillRect(px + 3, py + 3, 6, 5);
  }
  function microwave(x, px, py) {
    box(x, px, py, 20, 12, '#dfe6ec', '#8b939c');
    box(x, px + 2, py + 2, 12, 8, '#2b2f3a', '#111');
    x.fillStyle = '#67d67a'; x.fillRect(px + 15, py + 3, 4, 2);
    x.fillStyle = '#8b939c'; x.fillRect(px + 15, py + 7, 4, 3);
  }
  function trashBins(x, px, py) {
    const cols = ['#c0392b', '#e8b83b', '#3d6ea8', '#2e8b4f'];
    for (let i = 0; i < 4; i++) {
      box(x, px + i * 11, py, 10, 14, cols[i], OUT);
      x.fillStyle = '#00000033'; x.fillRect(px + i * 11 + 1, py + 1, 8, 2);
    }
  }

  /* ============================================================
     씬(방 배경) 정의
     ============================================================ */
  const FLOOR = 76;
  const scenes = {
    /* 대기실 / 라운지 */
    lobby(x) {
      ceiling(x);
      wall(x, 12, FLOOR, '#e9e4d6', '#b9b3a0');
      windowPane(x, 4, 18, 62, 42);
      noticeBoard(x, 74, 16, 50, 32);
      poster(x, 130, 16, 24, 26, '#f7f7f2', '#3d6ea8', 'S1FA');
      doorway(x, 196, 32, 30, 44, false);
      floorTiles(x, FLOOR, '#d9cfae', '#cfc4a0', '#bfb491');
      vending(x, 164, 72);
      cooler(x, 148, 92);
      sofa(x, 8, 92, 56);
      roundTable(x, 74, 104, 36);
      plant(x, 126, 112);
      trashBins(x, 196, 128);
      shelfUnit(x, 0, 128, 36, 32, 77);
    },

    /* 1관 — EFA1 파트 (사무실 셀) */
    room1(x) {
      ceiling(x);
      wall(x, 12, FLOOR, '#eceadf', '#b6b2a2');
      shelfUnit(x, 2, 16, 52, 46, 5);
      whiteboard(x, 60, 14, 90, 46, 17);
      serverRack(x, 156, 16, 34, 44);
      doorway(x, 198, 32, 30, 44, false);
      floorTiles(x, FLOOR, '#ddd3b6', '#d2c7a6', '#c2b795');
      deskLong(x, 14, 86, 156, '#efe9d8', '#d3ccb6');
      monitor(x, 28, 62, 32, 22, '#12324a', 2);
      monitor(x, 72, 56, 40, 28, '#0f2a1c', 1);
      monitor(x, 124, 62, 32, 22, '#2a1330', 3);
      keyboard(x, 72, 88, 40);
      x.fillStyle = '#4b5563'; x.fillRect(120, 89, 6, 4);
      drawers(x, 20, 98, 24, 24);
      drawers(x, 128, 98, 24, 24);
      tower(x, 174, 92, 20, 32);
      plant(x, 178, 132);
      shelfUnit(x, 0, 122, 42, 38, 23);
      drawers(x, 202, 118, 36, 36);
    },

    /* 2관 — EFA2 파트 (장비·배선실) */
    room2(x) {
      ceiling(x);
      wall(x, 12, FLOOR, '#dfe4e9', '#a7aeb8');
      serverRack(x, 2, 14, 38, 48);
      serverRack(x, 44, 18, 32, 44);
      whiteboard(x, 84, 16, 58, 40, 41);
      poster(x, 148, 18, 26, 24, '#f7f7f2', '#c0392b', 'HV');
      doorway(x, 200, 32, 30, 44, false);
      floorTiles(x, FLOOR, '#c9c9c2', '#bebeb6', '#adada6');
      deskLong(x, 10, 88, 130, '#e2e6ea', '#c6cbd0');
      monitor(x, 24, 64, 34, 24, '#0f2a1c', 1);
      monitor(x, 68, 66, 30, 22, '#12324a', 2);
      keyboard(x, 38, 90, 34);
      drawers(x, 100, 98, 34, 26);
      gasCylinder(x, 152, 104, '#3d6ea8');
      coffeeMachine(x, 176, 92);
      shelfUnit(x, 0, 124, 40, 36, 33);
      drawers(x, 204, 116, 34, 38);
      plantSmallBig(x, 168, 128);
    },

    /* 3관 — PFA / VSEM 분석실 */
    room3(x) {
      ceiling(x);
      wall(x, 12, FLOOR, '#e4ecf1', '#a9bac4');
      fumeHood(x, 2, 14, 54, 48);
      whiteboard(x, 62, 16, 52, 34, 61);
      poster(x, 120, 16, 24, 24, '#f7f7f2', '#7b5ea7', 'PFA');
      doorway(x, 150, 32, 28, 44, false);
      floorTiles(x, FLOOR, '#cfd8dd', '#c3ccd2', '#b3bcc2');
      semMachine(x, 192, 92);
      deskLong(x, 8, 88, 118, '#e6ecef', '#c9d2d7');
      monitor(x, 20, 64, 34, 24, '#101c2c', 2);
      monitor(x, 64, 66, 30, 22, '#0f2a1c', 1);
      keyboard(x, 38, 90, 34);
      drawers(x, 96, 98, 24, 24);
      gasCylinder(x, 130, 98, '#2e8b4f');
      gasCylinder(x, 142, 98, '#e8b83b');
      shelfUnit(x, 0, 124, 36, 36, 43);
      plant(x, 172, 132);
    },

    /* 4관 — 캔틴룸 */
    room4(x) {
      ceiling(x);
      wall(x, 12, FLOOR, '#f0e6d8', '#c1b5a0');
      windowPane(x, 2, 18, 54, 40);
      noticeBoard(x, 62, 16, 46, 32);
      poster(x, 114, 16, 24, 24, '#f7f7f2', '#2e8b4f', 'EAT');
      doorway(x, 146, 32, 28, 44, false);
      floorTiles(x, FLOOR, '#e0d3bb', '#d5c7ac', '#c4b699');
      vending(x, 206, 72);
      deskLong(x, 124, 100, 78, '#e8e2d2', '#cfc7b2');
      fridge(x, 182, 66);
      microwave(x, 156, 88);
      coffeeMachine(x, 130, 76);
      roundTable(x, 14, 96, 48);
      roundTable(x, 70, 110, 40);
      trashBins(x, 2, 132);
      plant(x, 118, 130);
    },

    /* 결과 발표 홀 */
    hall(x) {
      ceiling(x);
      wall(x, 12, FLOOR, '#26304a', '#141a2b');
      x.fillStyle = '#3d6ea8';
      for (let i = 0; i < 6; i++) x.fillRect(10 + i * 40, 16, 22, 3);
      whiteboard(x, 62, 20, 116, 42, 91);
      text(x, 'HALL OF FAME', 78, 34, '#1f4e9c', 2);
      floorTiles(x, FLOOR, '#3a2f52', '#332a48', '#2a2340');
      plant(x, 6, 108); plant(x, 220, 108);
      // 시상대
      box(x, 104, 128, 32, 26, '#e8b83b', OUT);
      box(x, 68, 136, 32, 18, '#b9c0cc', OUT);
      box(x, 140, 140, 32, 14, '#c9925b', OUT);
      text(x, '1', 118, 136, '#5c4708'); text(x, '2', 82, 142, '#4b5563'); text(x, '3', 154, 144, '#6b4a24');
      x.fillStyle = '#e8b83b';
      for (let i = 0; i < 24; i++) x.fillRect((i * 41) % 236, 80 + (i * 17) % 46, 2, 2);
    }
  };

  /** 씬을 캔버스에 렌더 */
  function renderScene(canvas, name) {
    const x = ctxOf(canvas);
    x.clearRect(0, 0, W, H);
    (scenes[name] || scenes.lobby)(x);
  }

  /* ============================================================
     소품(오브젝트) 스프라이트 — 상호작용용 개별 캔버스
     ============================================================ */
  const props = {
    fileBox(x) { box(x, 0, 2, 22, 16, '#d8b98a', '#8a6a41'); x.fillStyle = '#f2ead6'; x.fillRect(3, 0, 16, 4); x.fillStyle = '#8a6a41'; x.fillRect(2, 9, 18, 1); x.fillStyle = '#c0392b'; x.fillRect(8, 5, 6, 3); },
    tumbler(x) { box(x, 3, 0, 10, 20, '#2e8b4f', '#1c5c34'); x.fillStyle = '#dfe6ec'; x.fillRect(4, 0, 8, 3); x.fillStyle = '#ffffff44'; x.fillRect(5, 5, 2, 11); },
    memo(x) { box(x, 0, 0, 16, 14, '#fff6b8', '#c9b24a'); x.fillStyle = '#8e8b80'; x.fillRect(3, 4, 10, 1); x.fillRect(3, 7, 8, 1); x.fillRect(3, 10, 9, 1); },
    bag(x) { box(x, 0, 4, 20, 14, '#5b4a3a', '#33281f'); x.fillStyle = '#33281f'; x.fillRect(6, 0, 8, 6); x.fillStyle = '#e8b83b'; x.fillRect(8, 9, 4, 3); },
    papers(x) { box(x, 0, 2, 18, 12, '#f7f7f2', '#a9a69b'); x.fillStyle = '#f2f2ec'; x.fillRect(2, 0, 16, 11); x.fillStyle = '#a9a69b'; x.fillRect(4, 3, 11, 1); x.fillRect(4, 6, 9, 1); },
    mug(x) { box(x, 0, 3, 12, 11, '#f7f7f2', '#a9a69b'); x.fillStyle = '#6b4226'; x.fillRect(2, 4, 8, 3); x.fillStyle = '#a9a69b'; x.fillRect(11, 6, 3, 5); },
    book(x) { box(x, 0, 0, 18, 13, '#3d6ea8', '#22406a'); x.fillStyle = '#f7f7f2'; x.fillRect(2, 2, 14, 2); x.fillStyle = '#e8b83b'; x.fillRect(2, 8, 8, 2); },
    waterJug(x) { box(x, 0, 4, 16, 24, '#cfe8f5', '#7d9aa8'); x.fillStyle = '#8fd0ea'; x.fillRect(2, 8, 12, 16); x.fillStyle = '#3d6ea8'; x.fillRect(5, 0, 6, 5); },
    cup(x) { box(x, 0, 0, 12, 13, '#f7f7f2', '#b9b3a0'); x.fillStyle = '#dcdcd2'; x.fillRect(2, 2, 8, 2); },
    toolbox(x) { box(x, 0, 4, 22, 14, '#c0392b', '#7d1f16'); x.fillStyle = '#8e8b80'; x.fillRect(7, 0, 8, 4); x.fillStyle = '#ffffff44'; x.fillRect(2, 7, 18, 1); },
    sample(x) { box(x, 2, 4, 14, 12, '#b9c4cd', '#7d838c'); x.fillStyle = '#8fd0ea'; x.fillRect(4, 6, 10, 7); x.fillStyle = '#fff'; x.fillRect(5, 7, 3, 2); },
    tray(x) { box(x, 0, 4, 26, 12, '#8b939c', '#4b5563'); x.fillStyle = '#5c646f'; x.fillRect(2, 6, 22, 7); },
    safe(x) { box(x, 0, 0, 26, 26, '#4b5563', OUT); x.fillStyle = '#2b2f3a'; x.fillRect(3, 3, 20, 20); x.fillStyle = '#e8b83b'; x.fillRect(16, 11, 5, 5); x.fillStyle = '#8b939c'; x.fillRect(6, 6, 8, 8); text(x, '00', 6, 16, '#67d67a'); },
    dial(x) { box(x, 0, 0, 20, 20, '#dfe6ec', '#8b939c'); x.fillStyle = '#2b2f3a'; x.fillRect(8, 3, 3, 8); x.fillStyle = '#c0392b'; x.fillRect(9, 9, 2, 2); },
    cable(x) { x.fillStyle = '#c0392b'; x.fillRect(0, 4, 22, 3); x.fillStyle = '#3d6ea8'; x.fillRect(0, 10, 22, 3); x.fillStyle = '#e8b83b'; x.fillRect(0, 16, 22, 3); x.fillStyle = OUT; x.fillRect(10, 2, 3, 19); },
    lunchbox(x) { box(x, 0, 2, 22, 14, '#e8b83b', '#a3811f'); x.fillStyle = '#c0392b'; x.fillRect(2, 7, 18, 2); x.fillStyle = '#fff'; x.fillRect(8, 0, 6, 3); },
    towel(x) { box(x, 0, 2, 20, 12, '#8fd0ea', '#4d7f96'); x.fillStyle = '#ffffff66'; x.fillRect(2, 5, 16, 2); },
    poster(x) { box(x, 0, 0, 20, 24, '#f7f7f2', OUT); x.fillStyle = '#3d6ea8'; x.fillRect(2, 2, 16, 10); x.fillStyle = '#8e8b80'; x.fillRect(3, 15, 14, 1); x.fillRect(3, 18, 10, 1); },
    keycard(x) { box(x, 0, 0, 18, 12, '#dfe6ec', '#8b939c'); x.fillStyle = '#3d6ea8'; x.fillRect(2, 2, 6, 8); x.fillStyle = '#e8b83b'; x.fillRect(10, 3, 6, 2); },
    chair(x) { box(x, 2, 8, 16, 6, '#2b2f3a', OUT); box(x, 3, 0, 14, 9, '#3a3f4b', OUT); x.fillStyle = OUT; x.fillRect(9, 14, 2, 5); x.fillRect(4, 19, 12, 2); },
    plantSmall(x) { box(x, 3, 10, 10, 8, '#b4653a', '#7a4324'); x.fillStyle = '#2e8b4f'; x.fillRect(5, 2, 4, 9); x.fillRect(1, 4, 5, 3); x.fillRect(8, 3, 5, 3); },
    duster(x) { box(x, 0, 6, 20, 8, '#7b5ea7', '#4b3a6a'); x.fillStyle = '#c9b8e8'; x.fillRect(1, 0, 5, 7); }
  };

  /* 각 소품의 "바닥" 위치(28 그리드 기준) — 가구 위에 자연스럽게 올려놓기 위함 */
  const PROP_BOTTOM = {
    fileBox: 18, tumbler: 20, memo: 14, bag: 18, papers: 14, mug: 14, book: 13,
    waterJug: 28, cup: 13, toolbox: 18, sample: 16, tray: 16, safe: 26, dial: 20,
    cable: 21, lunchbox: 16, towel: 14, poster: 24, keycard: 12, chair: 21,
    plantSmall: 18, duster: 14
  };

  /** 소품 캔버스 생성 (28x28 그리드, 내용은 아래쪽 정렬) */
  function propCanvas(name, scale) {
    scale = scale || 3;
    const c = make(28 * scale, 28 * scale);
    const x = ctxOf(c);
    x.save(); x.scale(scale, scale);
    x.translate(0, 26 - (PROP_BOTTOM[name] || 20));
    (props[name] || props.memo)(x);
    x.restore();
    return c;
  }

  global.PX = {
    W, H, OUT, make, ctxOf, box, text, textW, rnd,
    drawChibi, characterCanvas, CH_W, CH_H, tint, setCharImage, hasCharImage,
    renderScene, scenes, props, propCanvas,
    prims: { floorTiles, wall, ceiling, plantSmallBig, windowPane, whiteboard, deskLong, monitor, keyboard, tower, shelfUnit, serverRack, plant, doorway, poster, cooler, coffeeMachine, vending, sofa, roundTable, noticeBoard, semMachine, gasCylinder, fumeHood, fridge, microwave, trashBins, drawers, ceilingLights }
  };
})(window);
