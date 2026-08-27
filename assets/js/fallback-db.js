/* ============================================================
   fallback-db.js — Firebase SDK를 불러오지 못했을 때 쓰는 대체 저장소
   · 사내망/오프라인 등에서 CDN이 막혀도 게임이 동작하도록 함
   · 같은 브라우저의 여러 탭끼리는 BroadcastChannel로 동기화되므로
     로컬에서 관리자/참가자 화면을 나란히 띄워 테스트할 수 있다.
   · 실제 40명 동시 플레이에는 Firebase 연결이 필요하다.
   ============================================================ */
(function (g) {
  'use strict';
  if (g.firebase) return;                       // 정상적으로 SDK가 로드된 경우

  const KEY = 's1fa.localdb';
  const TS_SENTINEL = { '.sv': 'timestamp' };
  let store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { store = {}; }

  let chan = null;
  try { chan = new BroadcastChannel('s1fa-db'); } catch (e) { }

  const listeners = [];                          // {path, cb}

  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const parts = (p) => String(p).split('/').filter(Boolean);

  function getAt(path) {
    let n = store;
    for (const k of parts(path)) { if (n == null || typeof n !== 'object') return null; n = n[k]; }
    return n === undefined ? null : n;
  }
  function setAt(path, val) {
    const ks = parts(path);
    if (!ks.length) { store = val || {}; return; }
    let n = store;
    for (let i = 0; i < ks.length - 1; i++) {
      if (typeof n[ks[i]] !== 'object' || n[ks[i]] === null) n[ks[i]] = {};
      n = n[ks[i]];
    }
    if (val === null || val === undefined) delete n[ks[ks.length - 1]];
    else n[ks[ks.length - 1]] = val;
  }
  function resolve(v) {
    if (v === TS_SENTINEL || (v && typeof v === 'object' && v['.sv'] === 'timestamp')) return Date.now();
    if (Array.isArray(v)) return v.map(resolve);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach(k => { const r = resolve(v[k]); if (r !== undefined) o[k] = r; }); return o; }
    return v;
  }
  function persist(broadcast) {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { }
    if (broadcast && chan) { try { chan.postMessage({ store }); } catch (e) { } }
  }
  function fireAll() {
    listeners.forEach(l => { try { l.cb(snap(getAt(l.path))); } catch (e) { console.warn(e); } });
  }
  function commit() { persist(true); fireAll(); }

  if (chan) chan.onmessage = (e) => { if (e.data && e.data.store) { store = e.data.store; persist(false); fireAll(); } };
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && e.newValue) { try { store = JSON.parse(e.newValue); fireAll(); } catch (err) { } }
  });

  function snap(v) {
    return {
      val: () => clone(v),
      exists: () => v !== null && v !== undefined,
      forEach: (f) => { if (v && typeof v === 'object') Object.keys(v).forEach(k => f(snap(v[k]))); }
    };
  }

  function Ref(path) {
    return {
      path,
      on(evt, cb) { const l = { path, cb }; listeners.push(l); cb(snap(getAt(path))); return cb; },
      off() { for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].path === path) listeners.splice(i, 1); },
      once(evt) { return Promise.resolve(snap(getAt(path))); },
      get() { return Promise.resolve(snap(getAt(path))); },
      set(v) { setAt(path, resolve(v)); commit(); return Promise.resolve(); },
      update(patch) {
        const cur = getAt(path);
        const base = (cur && typeof cur === 'object') ? cur : {};
        const rp = resolve(patch);
        Object.keys(rp).forEach(k => {
          if (k.indexOf('/') >= 0) setAt(path + '/' + k, rp[k]);
          else if (rp[k] === null) delete base[k];
          else base[k] = rp[k];
        });
        setAt(path, base); commit(); return Promise.resolve();
      },
      remove() { setAt(path, null); commit(); return Promise.resolve(); },
      transaction(fn) {
        const r = fn(getAt(path));
        if (r !== undefined) { setAt(path, resolve(r)); commit(); }
        return Promise.resolve({ committed: r !== undefined, snapshot: snap(getAt(path)) });
      },
      onDisconnect() { return { update() { return Promise.resolve(); }, set() { return Promise.resolve(); }, remove() { return Promise.resolve(); } }; },
      child(p) { return Ref(path + '/' + p); }
    };
  }

  const infoRef = (p) => ({
    on(evt, cb) { cb(snap(p === '.info/connected' ? true : 0)); },
    once() { return Promise.resolve(snap(p === '.info/connected' ? true : 0)); }
  });

  g.firebase = {
    initializeApp() { },
    database: Object.assign(function () {
      return { ref: (p) => (String(p).indexOf('.info/') === 0 ? infoRef(p) : Ref(p)) };
    }, { ServerValue: { TIMESTAMP: TS_SENTINEL } })
  };
  g.__S1FA_OFFLINE__ = true;
  console.warn('[S1FA] Firebase SDK를 불러오지 못해 로컬(오프라인) 모드로 실행합니다.');
})(window);
