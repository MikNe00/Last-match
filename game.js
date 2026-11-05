'use strict';
/* =====================================================================
   ПОСЛЕДНЯЯ СПИЧКА — The Last Match
   Модули: Utils → Settings/G → AudioMan → Save → Input → Sprites
   ===================================================================== */

/* ============================ UTILS ============================ */
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
const TAU = Math.PI * 2;
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(x, y) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
function C(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function px(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }
function vibrate(ms) { try { if (G && G.settings.vibrate && navigator.vibrate) navigator.vibrate(ms); } catch (e) { } }
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

/* ============================ SETTINGS / GLOBAL STATE ============================ */
const TILE = 16;
const G = {
  state: 'boot',            // boot | menu | play | pause | panel | note | over | ending
  mode: 'campaign',         // campaign | endless | challenge
  challenge: 0,
  depth: 1, distance: 0,
  time: 0,
  settings: { music: 0.7, sfx: 0.8, vibrate: true, quality: 1, ctrl: 1 },
  ach: {},                  // id -> timestamp
  records: { endless: 0, ch: {} },
  stats: { deaths: 0, lit: 0, kills: 0, crafted: 0, chapters: 0, notes: 0 },
  unlocked: 1, endings: [],
  // run:
  chapter: 1, seed: 1, dyn: {},
  world: null,
  player: { x: 0, y: 0, hp: 100, maxhp: 100, dir: 0, moving: false, animT: 0, hurtT: 0, stepT: 0 },
  inv: null,
  match: null,              // {t, max, type}
  partial: null,            // {t, type} догоревшая спичка
  xp: 0, level: 1, sp: 0, upg: {},
  enemies: [], particles: [], lights: [],
  camX: 0, camY: 0,
  eventT: 20, coldT: 0, saveT: 0, hudT: 0,
  matchUsed: 0, chTime: 0, noHit: true,
  prompt: null,             // {obj, label}
  msgSeen: {},
};

/* ============================ AUDIO MANAGER ============================ */
const AudioMan = (() => {
  let ctx = null, master = null, sfxG = null, musG = null, crackleT = 0;
  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.connect(ctx.destination);
      sfxG = ctx.createGain(); sfxG.connect(master);
      musG = ctx.createGain(); musG.connect(master);
      applyVol(); startWind();
    } catch (e) { ctx = null; }
  }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function applyVol() {
    if (!ctx) return;
    sfxG.gain.value = G.settings.sfx;
    musG.gain.value = G.settings.music * 0.35;
  }
  function noiseBuf(dur) {
    const b = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * dur | 0), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function startWind() { // атмосферный ветер
    try {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf(4); src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.6;
      const g = ctx.createGain(); g.gain.value = 0.10;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.05;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      src.connect(lp); lp.connect(g); g.connect(musG);
      src.start(); lfo.start();
    } catch (e) { }
  }
  function tone(f, dur, type, vol, slide) {
    if (!ctx) return;
    try {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'square'; o.frequency.value = f;
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), ctx.currentTime + dur);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g); g.connect(sfxG); o.start(); o.stop(ctx.currentTime + dur);
    } catch (e) { }
  }
  function noise(dur, vol, fFrom, fTo) {
    if (!ctx) return;
    try {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf(dur);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(fFrom, ctx.currentTime);
      if (fTo) bp.frequency.exponentialRampToValueAtTime(fTo, ctx.currentTime + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      src.connect(bp); bp.connect(g); g.connect(sfxG); src.start();
    } catch (e) { }
  }
  function play(name) {
    if (!ctx || G.settings.sfx <= 0) return;
    switch (name) {
      case 'strike': noise(0.28, 0.5, 900, 2600); tone(190, 0.12, 'square', 0.12, 90); break;
      case 'blow': noise(0.35, 0.3, 1400, 300); break;
      case 'pickup': tone(660, 0.08, 'square', 0.12); tone(990, 0.1, 'square', 0.1); break;
      case 'step': noise(0.05, 0.06, 500, 200); break;
      case 'hurt': tone(140, 0.25, 'sawtooth', 0.3, 60); noise(0.2, 0.25, 300, 100); break;
      case 'door': noise(0.5, 0.35, 180, 90); tone(90, 0.4, 'triangle', 0.15); break;
      case 'ui': tone(520, 0.05, 'square', 0.07); break;
      case 'note': tone(440, 0.15, 'triangle', 0.12); tone(550, 0.2, 'triangle', 0.1); break;
      case 'craft': tone(330, 0.1, 'square', 0.12); tone(495, 0.12, 'square', 0.1); tone(660, 0.15, 'square', 0.1); break;
      case 'levelup': [440, 554, 659, 880].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.14), i * 90)); break;
      case 'achieve': [660, 880, 1100].forEach((f, i) => setTimeout(() => tone(f, 0.15, 'square', 0.1), i * 80)); break;
      case 'enemy': tone(70, 0.5, 'sawtooth', 0.22, 45); break;
      case 'event': tone(587, 0.3, 'sine', 0.12); tone(740, 0.35, 'sine', 0.1); break;
      case 'exit': [392, 494, 587, 784].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.13), i * 110)); break;
      case 'trap': noise(0.15, 0.4, 2000, 800); tone(220, 0.15, 'square', 0.15, 110); break;
      case 'lever': tone(260, 0.1, 'square', 0.15); noise(0.12, 0.2, 800, 400); break;
      case 'gameover': [330, 262, 196, 131].forEach((f, i) => setTimeout(() => tone(f, 0.4, 'sawtooth', 0.12), i * 200)); break;
    }
  }
  function crackle(dt, lit) { // потрескивание горящей спички
    if (!ctx || G.settings.sfx <= 0) return;
    if (!lit) { crackleT = 0; return; }
    crackleT -= dt;
    if (crackleT <= 0) { crackleT = 0.08 + Math.random() * 0.18; noise(0.03, 0.05 + Math.random() * 0.05, 1800 + Math.random() * 1600, 900); }
  }
  return { init, resume, applyVol, play, crackle };
})();

/* ============================ SAVE MANAGER (IndexedDB + localStorage) ============================ */
const Save = {
  db: null, useIDB: false,
  init() {
    return new Promise(res => {
      try {
        const rq = indexedDB.open('lastmatch', 1);
        rq.onupgradeneeded = e => { e.target.result.createObjectStore('kv'); };
        rq.onsuccess = e => { this.db = e.target.result; this.useIDB = true; res(true); };
        rq.onerror = () => res(false);
        rq.onblocked = () => res(false);
      } catch (e) { res(false); }
    });
  },
  set(k, v) { // двойная запись: IDB + localStorage
    if (this.useIDB && this.db) { try { this.db.transaction('kv', 'readwrite').objectStore('kv').put(JSON.stringify(v), k); } catch (e) { } }
    try { localStorage.setItem('lm_' + k, JSON.stringify(v)); } catch (e) { }
  },
  get(k) {
    return new Promise(res => {
      if (this.useIDB && this.db) {
        try {
          const rq = this.db.transaction('kv').objectStore('kv').get(k);
          rq.onsuccess = () => {
            if (rq.result !== undefined) { try { res(JSON.parse(rq.result)); return; } catch (e) { } }
            this._ls(k, res);
          };
          rq.onerror = () => this._ls(k, res);
          return;
        } catch (e) { }
      }
      this._ls(k, res);
    });
  },
  _ls(k, res) { try { const v = localStorage.getItem('lm_' + k); res(v ? JSON.parse(v) : null); } catch (e) { res(null); } }
};

/* ============================ INPUT MANAGER ============================ */
const Input = {
  keys: {}, mx: 0, my: 0,
  joyId: null, joyBX: 0, joyBY: 0, joyX: 0, joyY: 0,
  actT: false, strikeT: false, blowT: false,
  init(canvas) {
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (G.state === 'play') {
        if (e.code === 'KeyE' || e.code === 'Enter') this.actT = true;
        if (e.code === 'KeyF' || e.code === 'Space') { this.strikeT = true; e.preventDefault(); }
        if (e.code === 'KeyQ') this.blowT = true;
      }
      if (e.code === 'Escape') UI.escPressed();
      if (e.code === 'KeyI' || e.code === 'Tab') { if (G.state === 'play') UI.openPanel('inv'); else if (G.state === 'panel') UI.closePanel(); e.preventDefault(); }
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });

    const touches = new Map();
    const opt = { passive: false };
    window.addEventListener('touchstart', e => {
      AudioMan.init(); AudioMan.resume();
      for (const t of e.changedTouches) {
        if (t.target.closest && t.target.closest('button, .screen, input, select, .panel')) continue;
        if (G.state !== 'play') continue;
        touches.set(t.identifier, { x: t.clientX, y: t.clientY });
        if (this.joyId === null && t.clientX < window.innerWidth * 0.55 && t.clientY > window.innerHeight * 0.35) {
          this.joyId = t.identifier; this.joyBX = t.clientX; this.joyBY = t.clientY; this.joyX = 0; this.joyY = 0;
          UI.showJoy(true, t.clientX, t.clientY);
        }
      }
      if (G.state === 'play' && !(e.target.closest && e.target.closest('button'))) e.preventDefault();
    }, opt);
    window.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        const rec = touches.get(t.identifier);
        if (rec) { rec.x = t.clientX; rec.y = t.clientY; }
        if (t.identifier === this.joyId) {
          let dx = t.clientX - this.joyBX, dy = t.clientY - this.joyBY;
          const len = Math.hypot(dx, dy), max = 52;
          if (len > max) { dx = dx / len * max; dy = dy / len * max; }
          this.joyX = dx / max; this.joyY = dy / max;
          UI.moveJoy(dx, dy);
        }
      }
      if (G.state === 'play') e.preventDefault();
    }, opt);
    const endT = e => {
      for (const t of e.changedTouches) {
        touches.delete(t.identifier);
        if (t.identifier === this.joyId) { this.joyId = null; this.joyX = 0; this.joyY = 0; UI.showJoy(false); }
      }
    };
    window.addEventListener('touchend', endT);
    window.addEventListener('touchcancel', endT);
    window.addEventListener('pointerdown', () => { AudioMan.init(); AudioMan.resume(); }, { once: false });
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('contextmenu', e => { if (G.state === 'play') e.preventDefault(); });
    window.addEventListener('pointerdown', e => { if (e.target === canvas) canvas.focus(); });

    // HUD-кнопки
    const bind = (id, fn) => {
      const b = $(id);
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); AudioMan.init(); AudioMan.resume(); fn(); });
    };
    bind('#btn-strike', () => { this.strikeT = true; });
    bind('#btn-act', () => { this.actT = true; });
    bind('#btn-blow', () => { this.blowT = true; });
    bind('#btn-inv', () => { if (G.state === 'play') UI.openPanel('inv'); });
    bind('#btn-pause', () => { if (G.state === 'play') UI.pause(); });
  },
  update() { // вычисление вектора движения
    let x = 0, y = 0;
    if (this.joyId !== null) { x = this.joyX; y = this.joyY; }
    else {
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) x -= 1;
      if (this.keys['KeyD'] || this.keys['ArrowRight']) x += 1;
      if (this.keys['KeyW'] || this.keys['ArrowUp']) y -= 1;
      if (this.keys['KeyS'] || this.keys['ArrowDown']) y += 1;
      if (x || y) { const l = Math.hypot(x, y); x /= l; y /= l; }
    }
    this.mx = x; this.my = y;
  },
  takeAct() { const v = this.actT; this.actT = false; return v; },
  takeStrike() { const v = this.strikeT; this.strikeT = false; return v; },
  takeBlow() { const v = this.blowT; this.blowT = false; return v; }
};

/* ============================ SPRITES (программный pixel-art) ============================ */
const SPR = {};
function buildSprites() {
  /* --- персонаж: 4 направления × 2 кадра, 16×22 --- */
  SPR.player = [];
  for (let d = 0; d < 4; d++) for (let f = 0; f < 2; f++) SPR.player.push(drawPlayer(d, f));

  /* --- теневое существо 18×16 --- */
  {
    const c = C(18, 16), g = c.getContext('2d');
    px(g, 4, 4, 10, 10, '#0c1018'); px(g, 2, 6, 14, 8, '#0c1018');
    px(g, 4, 2, 8, 4, '#111827'); px(g, 1, 8, 3, 4, '#0c1018'); px(g, 14, 8, 3, 4, '#0c1018');
    px(g, 3, 12, 3, 3, '#0c1018'); px(g, 9, 12, 3, 3, '#0c1018'); px(g, 13, 12, 2, 3, '#0c1018');
    px(g, 6, 7, 2, 2, '#7de8ff'); px(g, 11, 7, 2, 2, '#7de8ff');
    px(g, 6, 7, 1, 1, '#e8fbff'); px(g, 11, 7, 1, 1, '#e8fbff');
    px(g, 5, 5, 1, 2, '#232c3e'); px(g, 13, 5, 1, 2, '#232c3e');
    SPR.shadow = c;
  }
  /* --- странник 16×24 --- */
  {
    const c = C(16, 24), g = c.getContext('2d');
    px(g, 5, 2, 6, 5, '#2e3444'); px(g, 4, 4, 8, 4, '#2e3444'); px(g, 6, 5, 4, 3, '#0a0d14');
    px(g, 4, 8, 8, 11, '#3a4152'); px(g, 3, 9, 2, 9, '#313848'); px(g, 11, 9, 2, 9, '#313848');
    px(g, 5, 19, 3, 4, '#20242f'); px(g, 9, 19, 3, 4, '#20242f');
    px(g, 12, 13, 3, 4, '#4a5468'); px(g, 13, 14, 1, 1, '#8fd0ff');
    px(g, 4, 8, 8, 1, '#4a5468'); px(g, 6, 11, 4, 1, '#262c3a');
    SPR.watcher = c;
  }
  /* --- объекты мира --- */
  SPR.treeA = treeSprite(0); SPR.treeB = treeSprite(1);
  SPR.rock = rockSprite();
  SPR.bush = bushSprite();
  SPR.hut = hutSprite();
  SPR.house = houseSprite();
  SPR.well = wellSprite();
  SPR.cart = cartSprite();
  SPR.support = supportSprite();
  SPR.doorC = doorSprite(false); SPR.doorO = doorSprite(true);
  SPR.exit = exitSprite();
  SPR.campU = campfireSprite(false); SPR.campL = campfireSprite(true);
  SPR.stash = stashSprite();
  SPR.stashO = stashSprite(true);
  SPR.spikesU = spikesSprite(false); SPR.spikesS = spikesSprite(true);
  SPR.leverU = leverSprite(false); SPR.leverO = leverSprite(true);
  SPR.altarL = altarSprite('#ffbf5a'); SPR.altarD = altarSprite('#6f8fd8');
  SPR.collapse = collapseSprite();
  SPR.symbol = symbolSprite();
  SPR.mushroom = mushSprite();
  SPR.flameGlow = flameGlowSprite();

  /* --- иконки предметов 16×16 --- */
  SPR.icon = {
    match: iconMatch(false), longmatch: iconMatch(true), half: iconMatch(false, true),
    wood: iconWood(), cloth: iconCloth(), metal: iconMetal(), resin: iconResin(),
    artifact: iconArtifact(), key: iconKey(), note: iconNote(),
    torch: iconTorch(), lantern: iconLantern(), matchbox: iconBox(),
    heart: iconHeart(), spark: iconSpark(), eye: iconEye(),
  };
}

function drawPlayer(d, f) {
  const c = C(16, 22), g = c.getContext('2d');
  const leg = f === 0 ? 0 : (d === 1 ? 1 : d === 2 ? -1 : (f ? 1 : 0));
  // ноги
  px(g, 5, 17 + (f && d !== 3 ? 1 : 0), 3, 4 - (f && d !== 3 ? 1 : 0), '#241f18');
  px(g, 9, 17 + (f && d === 3 ? 1 : 0), 3, 4 - (f && d === 3 ? 1 : 0), '#241f18');
  // плащ
  px(g, 3, 8, 10, 10, '#31402c'); px(g, 4, 8, 8, 2, '#3d5036');
  px(g, 2, 9, 2, 7, '#2a3726'); px(g, 12, 9, 2, 7, '#2a3726');
  px(g, 3, 16, 10, 2, '#242f20');
  // капюшон / голова
  px(g, 4, 2, 8, 7, '#3d5036'); px(g, 3, 4, 10, 4, '#3d5036'); px(g, 4, 1, 6, 2, '#31402c');
  if (d === 0) { px(g, 5, 5, 6, 4, '#12100c'); px(g, 6, 6, 1, 1, '#e8d9a8'); px(g, 9, 6, 1, 1, '#e8d9a8'); }
  else if (d === 3) { px(g, 5, 5, 6, 4, '#2a3726'); }
  else if (d === 1) { px(g, 3, 5, 5, 4, '#12100c'); px(g, 4, 6, 1, 1, '#e8d9a8'); px(g, 2, 3, 3, 2, '#31402c'); }
  else { px(g, 8, 5, 5, 4, '#12100c'); px(g, 11, 6, 1, 1, '#e8d9a8'); px(g, 11, 3, 3, 2, '#31402c'); }
  // рука со спичкой (справа) при ходьбе слегка двигается
  if (d !== 1) px(g, 12, 10 + leg, 2, 4, '#3d5036');
  else px(g, 2, 10 - leg, 2, 4, '#3d5036');
  return c;
}
function treeSprite(v) {
  const c = C(20, 30), g = c.getContext('2d');
  px(g, 8, 22, 4, 8, '#3d2b1c'); px(g, 7, 24, 6, 2, '#4a3524');
  if (v === 0) { // ель
    px(g, 6, 14, 8, 8, '#16281a'); px(g, 4, 8, 12, 8, '#16281a'); px(g, 6, 2, 8, 8, '#1a3020');
    px(g, 9, 4, 3, 20, '#203826'); px(g, 6, 8, 2, 3, '#24442c'); px(g, 12, 14, 2, 3, '#24442c');
  } else { // лиственное
    px(g, 2, 8, 16, 14, '#14251а'.replace('а', 'a')); px(g, 4, 4, 12, 6, '#182b1c');
    px(g, 4, 10, 4, 3, '#1f3a24'); px(g, 12, 6, 3, 3, '#1f3a24'); px(g, 8, 14, 5, 3, '#0f1e12');
  }
  return c;
}
function rockSprite() {
  const c = C(16, 12), g = c.getContext('2d');
  px(g, 3, 4, 10, 7, '#4a4f4a'); px(g, 5, 2, 7, 4, '#565c56'); px(g, 2, 6, 3, 4, '#3c413c');
  px(g, 5, 3, 3, 2, '#6a706a'); px(g, 4, 9, 9, 2, '#333833');
  return c;
}
function bushSprite() {
  const c = C(14, 10), g = c.getContext('2d');
  px(g, 2, 4, 10, 5, '#1d3320'); px(g, 4, 2, 7, 4, '#233d27'); px(g, 5, 5, 2, 2, '#2c4c30');
  return c;
}
function hutSprite() {
  const c = C(40, 34), g = c.getContext('2d');
  px(g, 4, 12, 32, 20, '#3a2e20'); px(g, 6, 14, 28, 16, '#2e2418');
  for (let i = 0; i < 5; i++) px(g, 6, 14 + i * 3, 28, 1, '#241c12');
  px(g, 2, 8, 36, 6, '#241a10'); px(g, 6, 4, 28, 6, '#2c2014');
  px(g, 16, 20, 8, 12, '#171008'); px(g, 17, 21, 6, 11, '#0d0904');
  px(g, 8, 16, 5, 4, '#100c06'); px(g, 27, 16, 5, 4, '#100c06');
  px(g, 6, 30, 28, 2, '#1c150c');
  return c;
}
function houseSprite() {
  const c = C(44, 40), g = c.getContext('2d');
  px(g, 3, 14, 38, 24, '#453626'); px(g, 5, 16, 34, 20, '#382c1e');
  for (let i = 0; i < 7; i++) px(g, 5, 16 + i * 3, 34, 1, '#2b2216');
  px(g, 0, 8, 44, 8, '#2a2015'); px(g, 4, 2, 36, 8, '#332717');
  px(g, 4, 3, 36, 2, '#3d2f1c');
  px(g, 18, 24, 9, 14, '#150f08'); px(g, 19, 25, 7, 13, '#0c0803');
  px(g, 8, 20, 7, 6, '#0f0b05'); px(g, 9, 21, 5, 4, '#1a2430');
  px(g, 30, 20, 7, 6, '#0f0b05'); px(g, 31, 21, 5, 4, '#1a2430');
  return c;
}
function wellSprite() {
  const c = C(22, 18), g = c.getContext('2d');
  px(g, 3, 8, 16, 8, '#4a4f4a'); px(g, 5, 6, 12, 4, '#565c56'); px(g, 6, 8, 10, 4, '#0a0f14');
  px(g, 4, 0, 2, 8, '#3d2b1c'); px(g, 16, 0, 2, 8, '#3d2b1c'); px(g, 3, 0, 16, 2, '#2c2014');
  px(g, 4, 14, 14, 2, '#333833');
  return c;
}
function cartSprite() {
  const c = C(22, 14), g = c.getContext('2d');
  px(g, 2, 4, 18, 7, '#4a3524'); px(g, 3, 5, 16, 2, '#5a422c'); px(g, 2, 9, 18, 2, '#332416');
  px(g, 4, 11, 4, 3, '#241a10'); px(g, 14, 11, 4, 3, '#241a10');
  px(g, 6, 2, 8, 3, '#3c2c1c');
  return c;
}
function supportSprite() {
  const c = C(18, 22), g = c.getContext('2d');
  px(g, 2, 2, 3, 20, '#4a3524'); px(g, 13, 2, 3, 20, '#4a3524'); px(g, 1, 2, 16, 4, '#5a422c');
  px(g, 2, 12, 14, 2, '#3c2c1c');
  return c;
}
function doorSprite(open) {
  const c = C(20, 26), g = c.getContext('2d');
  if (!open) {
    px(g, 1, 1, 18, 24, '#4a3826'); px(g, 3, 3, 14, 20, '#3c2e1e');
    for (let i = 0; i < 6; i++) px(g, 3, 4 + i * 3, 14, 1, '#2e2316');
    px(g, 5, 6, 10, 6, '#2a2013'); px(g, 6, 7, 8, 4, '#c9973a');
    px(g, 14, 13, 2, 2, '#8a7a4a');
  } else {
    px(g, 1, 1, 18, 24, '#141008'); px(g, 0, 0, 3, 26, '#4a3826'); px(g, 17, 0, 3, 26, '#4a3826');
    px(g, 1, 0, 18, 3, '#4a3826');
  }
  return c;
}
function exitSprite() {
  const c = C(28, 34), g = c.getContext('2d');
  px(g, 3, 4, 4, 28, '#3c4148'); px(g, 21, 4, 4, 28, '#3c4148');
  px(g, 3, 2, 22, 5, '#4a505a'); px(g, 5, 7, 18, 3, '#2c3038');
  px(g, 8, 12, 12, 20, '#0a1420');
  px(g, 10, 14, 8, 16, '#0e2233'); px(g, 12, 16, 4, 12, '#16344e');
  px(g, 2, 30, 24, 3, '#2c3038');
  return c;
}
function campfireSprite(lit) {
  const c = C(24, 14), g = c.getContext('2d');
  px(g, 3, 9, 7, 3, '#4a3524'); px(g, 12, 8, 9, 3, '#3c2c1c');
  px(g, 8, 10, 8, 3, '#241a10');
  if (!lit) { px(g, 9, 6, 6, 3, '#181410'); }
  else { px(g, 9, 5, 6, 4, '#c9541e'); px(g, 10, 3, 4, 4, '#e88a2e'); px(g, 11, 4, 2, 2, '#ffd76a'); }
  return c;
}
function stashSprite(opened) {
  const c = C(16, 12), g = c.getContext('2d');
  if (!opened) {
    px(g, 2, 3, 12, 8, '#4a3a22'); px(g, 2, 3, 12, 2, '#5c4a2c');
    px(g, 7, 5, 2, 4, '#c9973a'); px(g, 1, 5, 14, 1, '#332818');
  } else {
    px(g, 2, 5, 12, 6, '#332818'); px(g, 2, 2, 12, 3, '#241c10'); px(g, 3, 5, 10, 4, '#12100a');
  }
  return c;
}
function spikesSprite(sprung) {
  const c = C(16, 10), g = c.getContext('2d');
  px(g, 1, 7, 14, 3, '#2c3038');
  if (!sprung) for (let i = 0; i < 4; i++) { px(g, 2 + i * 3, 2, 2, 6, '#7a8494'); px(g, 2 + i * 3, 1, 1, 2, '#9aa4b4'); }
  else for (let i = 0; i < 4; i++) px(g, 2 + i * 3, 6, 2, 2, '#5a6474');
  return c;
}
function leverSprite(on) {
  const c = C(12, 14), g = c.getContext('2d');
  px(g, 2, 10, 8, 3, '#3c4148');
  if (on) { px(g, 5, 3, 2, 8, '#8a4a2a'); px(g, 4, 2, 4, 3, '#c9973a'); }
  else { px(g, 5, 5, 2, 6, '#8a4a2a'); px(g, 4, 8, 4, 3, '#c9973a'); }
  return c;
}
function altarSprite(col) {
  const c = C(24, 26), g = c.getContext('2d');
  px(g, 4, 12, 16, 12, '#3c4148'); px(g, 6, 8, 12, 5, '#4a505a'); px(g, 8, 2, 8, 7, '#2c3038');
  px(g, 9, 0, 6, 3, col); px(g, 10, 3, 4, 4, col);
  px(g, 6, 16, 12, 1, '#2c3038'); px(g, 6, 20, 12, 1, '#2c3038');
  return c;
}
function collapseSprite() {
  const c = C(18, 8), g = c.getContext('2d');
  px(g, 1, 4, 5, 3, '#4a4f4a'); px(g, 6, 2, 6, 5, '#565c56'); px(g, 12, 4, 5, 3, '#3c413c');
  px(g, 7, 3, 2, 2, '#6a706a');
  return c;
}
function symbolSprite() {
  const c = C(14, 14), g = c.getContext('2d');
  px(g, 2, 2, 10, 10, '#2c3038'); px(g, 3, 3, 8, 8, '#23262c');
  px(g, 5, 5, 4, 1, '#c9973a'); px(g, 5, 8, 4, 1, '#c9973a'); px(g, 6, 6, 2, 2, '#8a6a2a');
  return c;
}
function mushSprite() {
  const c = C(10, 9), g = c.getContext('2d');
  px(g, 4, 4, 2, 5, '#c9b898'); px(g, 1, 1, 8, 4, '#a4502e'); px(g, 2, 0, 6, 2, '#c06a3a');
  px(g, 3, 2, 1, 1, '#e8d0b0'); px(g, 6, 2, 1, 1, '#e8d0b0');
  return c;
}
function flameGlowSprite() {
  const c = C(32, 32), g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 18, 1, 16, 18, 15);
  gr.addColorStop(0, 'rgba(255,220,140,0.9)'); gr.addColorStop(0.4, 'rgba(255,160,60,0.45)');
  gr.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return c;
}
/* --- иконки --- */
function iconMatch(long, half) {
  const c = C(16, 16), g = c.getContext('2d');
  px(g, 7, 6, 2, 9, half ? '#7a6248' : '#c9a06a');
  px(g, 6, 4, 4, 3, long ? '#e88a2e' : '#c9541e');
  if (long) px(g, 7, 2, 2, 2, '#ffd76a');
  return c;
}
function iconWood() { const c = C(16, 16), g = c.getContext('2d'); px(g, 2, 5, 12, 4, '#7a5a34'); px(g, 2, 5, 12, 1, '#96744a'); px(g, 3, 6, 2, 2, '#5c4226'); px(g, 1, 10, 10, 3, '#6a4c2c'); px(g, 1, 10, 10, 1, '#84643c'); return c; }
function iconCloth() { const c = C(16, 16), g = c.getContext('2d'); px(g, 3, 3, 10, 10, '#9a8a6a'); px(g, 3, 3, 10, 2, '#b0a080'); px(g, 3, 6, 10, 1, '#847458'); px(g, 3, 10, 10, 1, '#847458'); px(g, 6, 4, 1, 8, '#847458'); return c; }
function iconMetal() { const c = C(16, 16), g = c.getContext('2d'); px(g, 3, 5, 10, 6, '#8a94a4'); px(g, 3, 5, 10, 2, '#aab4c4'); px(g, 5, 8, 2, 2, '#5a6474'); px(g, 9, 8, 2, 2, '#5a6474'); return c; }
function iconResin() { const c = C(16, 16), g = c.getContext('2d'); px(g, 4, 4, 8, 8, '#c98a2e'); px(g, 5, 3, 6, 3, '#e8aa3e'); px(g, 6, 6, 2, 2, '#8a5a1a'); px(g, 4, 10, 8, 2, '#8a5a1a'); return c; }
function iconArtifact() { const c = C(16, 16), g = c.getContext('2d'); px(g, 5, 2, 6, 12, '#3c5a8a'); px(g, 6, 3, 4, 10, '#5a82c0'); px(g, 7, 5, 2, 5, '#9ac0f0'); px(g, 4, 6, 1, 4, '#2c4468'); return c; }
function iconKey() { const c = C(16, 16), g = c.getContext('2d'); px(g, 3, 3, 5, 5, '#c9973a'); px(g, 4, 4, 3, 3, '#402e10'); px(g, 8, 5, 6, 2, '#c9973a'); px(g, 12, 7, 2, 3, '#c9973a'); px(g, 8, 5, 2, 1, '#e8c060'); return c; }
function iconNote() { const c = C(16, 16), g = c.getContext('2d'); px(g, 3, 2, 10, 12, '#c9bda0'); px(g, 4, 4, 8, 1, '#6a5c40'); px(g, 4, 6, 8, 1, '#6a5c40'); px(g, 4, 8, 6, 1, '#6a5c40'); px(g, 4, 11, 8, 1, '#8a3a2a'); return c; }
function iconTorch() { const c = C(16, 16), g = c.getContext('2d'); px(g, 7, 6, 2, 9, '#7a5a34'); px(g, 6, 3, 4, 4, '#e88a2e'); px(g, 7, 1, 2, 3, '#ffd76a'); px(g, 5, 5, 6, 2, '#a4502e'); return c; }
function iconLantern() { const c = C(16, 16), g = c.getContext('2d'); px(g, 5, 2, 6, 2, '#5a6474'); px(g, 4, 4, 8, 10, '#4a505a'); px(g, 6, 6, 4, 6, '#ffd76a'); px(g, 7, 7, 2, 4, '#fff0b0'); px(g, 5, 13, 6, 1, '#3c4148'); return c; }
function iconBox() { const c = C(16, 16), g = c.getContext('2d'); px(g, 2, 4, 12, 9, '#8a3a2a'); px(g, 2, 4, 12, 2, '#a4502e'); px(g, 2, 9, 12, 1, '#6a2a1e'); px(g, 7, 6, 2, 5, '#e8d9a8'); px(g, 1, 6, 1, 5, '#5a2418'); return c; }
function iconHeart() { const c = C(16, 16), g = c.getContext('2d'); px(g, 3, 3, 4, 4, '#c04030'); px(g, 9, 3, 4, 4, '#c04030'); px(g, 2, 5, 12, 5, '#c04030'); px(g, 4, 10, 8, 3, '#c04030'); px(g, 6, 13, 4, 2, '#c04030'); px(g, 4, 4, 2, 2, '#e86a50'); return c; }
function iconSpark() { const c = C(16, 16), g = c.getContext('2d'); px(g, 7, 1, 2, 14, '#ffd76a'); px(g, 1, 7, 14, 2, '#ffd76a'); px(g, 4, 4, 2, 2, '#fff0b0'); px(g, 10, 10, 2, 2, '#fff0b0'); return c; }
function iconEye() { const c = C(16, 16), g = c.getContext('2d'); px(g, 2, 6, 12, 5, '#c9bda0'); px(g, 5, 5, 6, 7, '#e8dfc8'); px(g, 6, 6, 4, 5, '#3c5a8a'); px(g, 7, 7, 2, 3, '#101018'); return c; }

/* ============================ DATA: предметы, рецепты, улучшения, достижения ============================ */
const ITEMS = {
  match:     { name: 'Спичка',          desc: 'Обычная спичка. Горит около 25 секунд. Свет — жизнь.' },
  longmatch: { name: 'Восковая спичка', desc: 'Пропитана смолой. Горит вдвое дольше обычной.', usable: true },
  half:      { name: 'Догоревшая спичка', desc: 'Осталось немного. Поджечь можно, но недолго прогорит.', usable: true },
  torch:     { name: 'Факел',           desc: 'Яркое пламя в руке. Горит ~50 секунд, светит шире спички.', usable: true },
  lantern:   { name: 'Фонарь',          desc: 'Надёжный источник света. Горит ~2 минуты, широкий радиус.', usable: true },
  matchbox:  { name: 'Запасной коробок', desc: '+5 к максимальному запасу спичек.', usable: true },
  wood:      { name: 'Древесина',       desc: 'Сухие ветки и доски. Топливо для костров и основа крафта.' },
  cloth:     { name: 'Ткань',           desc: 'Лоскуты полотна. Годятся для факелов и фонарей.' },
  metal:     { name: 'Металл',          desc: 'Железные детали из вагонеток и механизмов.' },
  resin:     { name: 'Смола',           desc: 'Липкая смола деревьев. Отлично поддерживает пламя.' },
  artifact:  { name: 'Артефакт',        desc: 'Странный светящийся осколок. Он слегка тёплый.' },
  key:       { name: 'Старый ключ',     desc: 'Ржавый, но рабочий ключ от шахтной двери.' },
  note:      { name: 'Записка',         desc: 'Чьи-то записи. Прочтите в журнале (инвентарь → Записки).' },
};

const RECIPES = [
  { id: 'longmatch', name: 'Восковая спичка', out: { longmatch: 1 }, need: { match: 2, resin: 1 }, desc: 'Горит ~50 секунд' },
  { id: 'torch',     name: 'Факел',           out: { torch: 1 },     need: { wood: 1, cloth: 1, resin: 1 }, desc: 'Яркий ручной свет ~50 сек' },
  { id: 'lantern',   name: 'Фонарь',          out: { lantern: 1 },   need: { metal: 2, cloth: 1, resin: 2 }, desc: 'Свет ~2 минуты, большой радиус' },
  { id: 'matchbox',  name: 'Запасной коробок', out: { matchbox: 1 }, need: { wood: 2, metal: 1 }, desc: '+5 к вместимости спичек' },
];

const UPGRADES = [
  { id: 'burn',   name: 'Ровное пламя',  desc: '+8 сек к времени горения спички',        max: 3 },
  { id: 'radius', name: 'Яркое горение', desc: '+18% к радиусу света',                   max: 3 },
  { id: 'hp',     name: 'Закалка',       desc: '+25 к максимальному здоровью',           max: 3 },
  { id: 'pack',   name: 'Большой рюкзак', desc: '+8 к вместимости ресурсов',             max: 3 },
  { id: 'gather', name: 'Собиратель',    desc: 'Шанс найти +1 ресурс при сборе',          max: 3 },
];

const ACH = {
  first_match: { name: 'Первая искра',     desc: 'Зажечь первую спичку' },
  first_stash:{ name: 'Кладоискатель',    desc: 'Найти первый тайник' },
  notes5:     { name: 'Читатель',         desc: 'Найти 5 записок' },
  notes10:    { name: 'Архивариус',       desc: 'Найти 10 записок' },
  nohit:      { name: 'Незаметный',       desc: 'Пройти главу без потери здоровья' },
  secret_all: { name: 'Всевидящий',       desc: 'Найти все тайники главы' },
  craft1:     { name: 'Мастеровой',       desc: 'Создать первый предмет' },
  lvl5:       { name: 'Выживший',         desc: 'Достичь 5 уровня' },
  endless250: { name: 'Странник тьмы',    desc: 'Пройти 250 м в Бесконечной ночи' },
  endless1000:{ name: 'Повелитель ночи',  desc: 'Пройти 1000 м в Бесконечной ночи' },
  ch1:        { name: 'Лес отпускает',    desc: 'Пройти первую главу' },
  end_light:  { name: 'Свет не гаснет',   desc: 'Достичь концовки «Свет»' },
  end_dark:   { name: 'Тьма приняла',     desc: 'Достичь концовки «Тьма»' },
  all_end:    { name: 'Все тайны',        desc: 'Увидеть обе концовки' },
};

const NOTES = [
  { id: 'n1', title: 'Обрывок страницы', text: 'День третий. Свет здесь гаснет быстрее, чем должен. Я считаю спички дважды в день. Если вы это читаете — не доверяйте дальнему свету. Он зовёт, но не ведёт.' },
  { id: 'n2', title: 'Записка лесника', text: 'Тени не выносят огня, но они терпеливы. Тушите спичку вовремя — догоревшая спичка ещё послужит. Лес уважает тех, кто не транжирит огонь.' },
  { id: 'n3', title: 'Дневник шахтёра', text: 'Пропитал спички смолой — горят вдвое дольше. Ключ от западной двери оставил в вагонетке у старого забоя. Кто найдёт — берите, мне уже не нужно.' },
  { id: 'n4', title: 'Страница дневника', text: 'Существо со светильником на груди ходит по кругу. Оно не быстрое. Засеки его маршрут и переходи дорогу за шаг до него.' },
  { id: 'n5', title: 'Письмо без адресата', text: 'Деревня опустела за одну ночь. Люди ушли на северный свет, тот, что пляшет над болотом. Я не пошёл. Свет, который ты не зажёг сам, не светит — он ловит.' },
  { id: 'n6', title: 'Дневник жителя', text: 'Колодец дал нам воду, но однажды из него вышло что-то холодное. Мы запечатали его камнями. Если найдёте нашу деревню — не смотрите в колодцы.' },
  { id: 'n7', title: 'Записка у механизма', text: 'Древний проход открывается только обоими рычагами. Один — западный, другой — восточный. Символы на стенах — предупреждение: свет там ведёт себя странно.' },
  { id: 'n8', title: 'Последняя запись', text: 'Я понял, что это за место. Оно питается огнём, но боится того, что мы делаем с огнём сами. Два алтаря ждут в конце. Выбор будет за тобой.' },
  { id: 'n9', title: 'Выцветшая страница', text: 'Считается, что артефакты — осколки первого огня. Они тёплые на ощупь даже в самой глубокой темноте. Носите их близко к сердцу.' },
  { id: 'n10', title: 'Предсмертная записка', text: 'Если огонь погаснет — не бегите. Встаньте спиной к стене и слушайте. Тени подходят только к тем, кто бежит.' },
  { id: 'n11', title: 'Стихотворение', text: 'Пять спичек в коробке — пять маленьких солнц.\nЧетыре сожгла тьма, одну спрятал в снег.\nКто прочтёт — зажги её. Не ради меня.\nПросто тьме не должно достаться последнее.' },
  { id: 'n12', title: 'Карта без названий', text: 'Лес → Шахты → Деревня → Подземелье → Последний Свет. Пять колец тьмы вокруг того, что спит в центре. Кто прошёл всё — тот знает правду.' },
];

/* ============================ ТЕМЫ ГЛАВ ============================ */
const THEMES = [
  { // 1 — лес
    floorA: '#101f0d', floorB: '#0c180a', stone: '#3c443a', wall: '#16281a',
    amb: 0.90, name: 'ГЛАВА 1. ЗАБЫТЫЙ ЛЕС',
    obj: 'Найдите выход из леса. Спички тратите экономно.'
  },
  { // 2 — шахты
    floorA: '#241c12', floorB: '#1c160e', stone: '#4a3c28', wall: '#141210',
    amb: 0.945, name: 'ГЛАВА 2. СТАРЫЕ ШАХТЫ',
    obj: 'Найдите старый ключ и пройдите через шахту.'
  },
  { // 3 — деревня
    floorA: '#1a1c14', floorB: '#14160f', stone: '#4c4c44', wall: '#20221a',
    amb: 0.92, name: 'ГЛАВА 3. МЁРТВАЯ ДЕРЕВНЯ',
    obj: 'Исследуйте дома, соберите дневники, найдите дорогу на север.'
  },
  { // 4 — подземелье
    floorA: '#20242c', floorB: '#181c22', stone: '#4a505a', wall: '#101318',
    amb: 0.955, name: 'ГЛАВА 4. ПОДЗЕМЕЛЬЕ',
    obj: 'Активируйте два механизма и откройте древний проход.'
  },
  { // 5 — последний свет
    floorA: '#241e26', floorB: '#1a161c', stone: '#565064', wall: '#141018',
    amb: 0.94, name: 'ГЛАВА 5. ПОСЛЕДНИЙ СВЕТ',
    obj: 'Дойдите до центра и сделайте выбор.'
  },
  { // 6 — бесконечная ночь
    floorA: '#0e1a0e', floorB: '#0a140a', stone: '#3c443a', wall: '#14200f',
    amb: 0.93, name: 'БЕСКОНЕЧНАЯ НОЧЬ',
    obj: 'Идите вперёд. Порталы ведут глубже. Выживите как можно дольше.'
  },
];

/* ============================ ГЕНЕРАЦИЯ МИРА ============================ */
function genWorld(ch, seed) {
  const R = mulberry32(seed);
  const W = 64, H = 64;
  const t = new Uint8Array(W * H); // 0 пол, 1 стена
  const objs = [];
  const enemies = [];
  const T = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 1 : t[y * W + x];
  const setT = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) t[y * W + x] = v; };
  const free = (x, y) => T(x, y) === 0;
  const scatterFree = n => { // найти n свободных клеток
    const out = [];
    let guard = 0;
    while (out.length < n && guard++ < 4000) {
      const x = 2 + (R() * (W - 4)) | 0, y = 2 + (R() * (H - 4)) | 0;
      if (free(x, y) && !objs.some(o => o.tx === x && o.ty === y)) out.push({ x, y });
    }
    return out;
  };
  const addObj = (type, x, y, data) => { const o = { type, x: x * TILE + 8, y: y * TILE + 8, tx: x, ty: y, data: data || {} }; objs.push(o); return o; };

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) t[y * W + x] = (x === 0 || y === 0 || x === W - 1 || y === H - 1) ? 1 : 0;

  let spawn = { x: W >> 1, y: H >> 1 };
  let exit = null;

  if (ch === 1 || ch === 6) { /* ЛЕС / БЕСКОНЕЧНАЯ НОЧЬ */
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const r = R();
      const n = hash2(x, y);
      if (r < 0.16 + n * 0.06) setT(x, y, 1); // густые деревья
    }
    // прогалина у спавна
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) setT(spawn.x + x, spawn.y + y, 0);
    // тропа от спавна до выхода
    let px = spawn.x, py = spawn.y;
    exit = { x: 6 + (R() * (W - 12)) | 0, y: R() < 0.5 ? 3 : H - 4 };
    let guard = 0;
    while ((px !== exit.x || py !== exit.y) && guard++ < 600) {
      if (px !== exit.x && (R() < 0.6 || py === exit.y)) px += Math.sign(exit.x - px);
      else if (py !== exit.y) py += Math.sign(exit.y - py);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) setT(px + ox, py + oy, 0);
    }
    const deco = scatterFree(26);
    deco.forEach((p, i) => {
      if (i % 5 === 0) addObj('rock', p.x, p.y);
      else if (i % 3 === 0) addObj('bush', p.x, p.y);
      else setT(p.x, p.y, 1); // деревья-стены
    });
    scatterFree(9).forEach((p, i) => addObj(i < 5 ? 'mushroom' : 'wood', p.x, p.y, { item: i < 5 ? null : 'wood' }));
    const spots = scatterFree(10);
    addObj('stash', spots[0].x, spots[0].y);
    addObj('stash', spots[1].x, spots[1].y, { hidden: true });
    addObj('campfire', spots[2].x, spots[2].y);
    addObj('note', spots[3].x, spots[3].y, { note: 'n1' });
    addObj('note', spots[4].x, spots[4].y, { note: 'n2' });
    addObj('hut', spots[5].x, spots[5].y);
    addObj('note', spots[6].x, spots[6].y, { note: 'n11' });
    addObj('mushroom', spots[7].x, spots[7].y);
    addObj('exit', exit.x, exit.y);
    const ne = ch === 6 ? Math.min(3 + G.depth, 9) : 2;
    for (let i = 0; i < ne; i++) {
      const p = scatterFree(1)[0];
      enemies.push({ type: i % 3 === 2 ? 'watcher' : 'shadow', x: p.x * TILE + 8, y: p.y * TILE + 8 });
    }
  }
  else if (ch === 2) { /* ШАХТЫ — коридоры */
    for (let i = 0; i < W * H; i++) t[i] = 1;
    // случайные блуждания, выкапывающие коридоры
    const dig = (x, y, n) => {
      let cx = x, cy = y, dir = R() * 4 | 0;
      for (let i = 0; i < n; i++) {
        setT(cx, cy, 0);
        if (R() < 0.25) dir = (dir + (R() < 0.5 ? 1 : 3)) % 4;
        const dx = [1, 0, -1, 0][dir], dy = [0, 1, 0, -1][dir];
        cx = clamp(cx + dx, 1, W - 2); cy = clamp(cy + dy, 1, H - 2);
      }
      return { x: cx, y: cy };
    };
    spawn = { x: W >> 1, y: H >> 1 };
    setT(spawn.x, spawn.y, 0);
    for (let i = 0; i < 26; i++) dig(spawn.x, spawn.y, 26 + R() * 40 | 0);
    exit = { x: 4 + R() * (W - 8) | 0, y: 4 + R() * (H - 8) | 0 };
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) setT(exit.x + ox, exit.y + oy, 0);
    const spots = scatterFree(16);
    spots.forEach((p, i) => {
      if (i < 6) addObj('support', p.x, p.y, { deco: true });
      else if (i < 10) addObj('cart', p.x, p.y, { loot: i === 9 ? 'key' : (i % 2 ? 'metal' : 'wood') });
      else if (i < 12) addObj('campfire', p.x, p.y);
      else if (i < 14) addObj('note', p.x, p.y, { note: i === 12 ? 'n3' : 'n4' });
      else addObj('stash', p.x, p.y);
    });
    addObj('door', exit.x, exit.y - 1, { locked: true, id: 'main' });
    addObj('exit', exit.x, exit.y);
    for (let i = 0; i < 4; i++) { const p = scatterFree(1)[0]; enemies.push({ type: i % 2 ? 'shadow' : 'watcher', x: p.x * TILE + 8, y: p.y * TILE + 8 }); }
  }
  else if (ch === 3) { /* ДЕРЕВНЯ */
    // дома-блоки
    const houses = [];
    for (let i = 0; i < 14; i++) {
      const hw = 5 + (R() * 3 | 0), hh = 4 + (R() * 3 | 0);
      const hx = 3 + (R() * (W - hw - 6)) | 0, hy = 3 + (R() * (H - hh - 6)) | 0;
      if (dist(hx, hy, spawn.x, spawn.y) < 9) continue;
      let bad = false;
      for (const h of houses) if (hx < h.x + h.w + 2 && hx + hw + 2 > h.x && hy < h.y + h.h + 2 && hy + hh + 2 > h.y) { bad = true; break; }
      if (bad) continue;
      houses.push({ x: hx, y: hy, w: hw, h: hh });
      for (let y = hy; y < hy + hh; y++) for (let x = hx; x < hx + hw; x++) setT(x, y, 1);
      // дверной проём
      const dx = hx + (hw >> 1), dy = R() < 0.5 ? hy - 1 : hy + hh;
      setT(dx, dy, 0);
    }
    // улицы (вертикальные и горизонтальные просеки)
    for (let i = 0; i < 4; i++) {
      const vy = 4 + (R() * (H - 8)) | 0;
      for (let x = 1; x < W - 1; x++) setT(x, vy, 0);
    }
    for (let i = 0; i < 4; i++) {
      const vx = 4 + (R() * (W - 8)) | 0;
      for (let y = 1; y < H - 1; y++) setT(vx, y, 0);
    }
    houses.forEach((h, i) => {
      const dx = h.x + (h.w >> 1), dy = R() < 0.5 ? h.y - 1 : h.y + h.h;
      const o = addObj('house', dx, clamp(dy, 1, H - 2));
      o.data.houseIdx = i;
    });
    exit = { x: W >> 1, y: 3 };
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) setT(exit.x + ox, exit.y + oy, 0);
    const spots = scatterFree(18);
    spots.forEach((p, i) => {
      if (i < 2) addObj('well', p.x, p.y);
      else if (i < 7) addObj('note', p.x, p.y, { note: ['n5', 'n6', 'n9', 'n10', 'n12'][i - 2] });
      else if (i < 11) addObj('stash', p.x, p.y, { hidden: i > 8 });
      else if (i < 14) addObj('campfire', p.x, p.y);
      else addObj('mushroom', p.x, p.y);
    });
    scatterFree(6).forEach(p => addObj('wood', p.x, p.y, { item: 'wood' }));
    addObj('exit', exit.x, exit.y);
    for (let i = 0; i < 4; i++) { const p = scatterFree(1)[0]; enemies.push({ type: i % 2 ? 'watcher' : 'shadow', x: p.x * TILE + 8, y: p.y * TILE + 8 }); }
  }
  else if (ch === 4) { /* ПОДЗЕМЕЛЬЕ — комнаты и коридоры */
    for (let i = 0; i < W * H; i++) t[i] = 1;
    const rooms = [];
    for (let i = 0; i < 12; i++) {
      const rw = 5 + (R() * 6 | 0), rh = 5 + (R() * 6 | 0);
      const rx = 2 + (R() * (W - rw - 4)) | 0, ry = 2 + (R() * (H - rh - 4)) | 0;
      let bad = false;
      for (const r of rooms) if (rx < r.x + r.w + 1 && rx + rw + 1 > r.x && ry < r.y + r.h + 1 && ry + rh + 1 > r.y) { bad = true; break; }
      if (bad) continue;
      rooms.push({ x: rx, y: ry, w: rw, h: rh });
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) setT(x, y, 0);
    }
    // соединить комнаты коридорами (цепочка + пара перемычек)
    const corridor = (a, b) => {
      let cx = a.x + (a.w >> 1), cy = a.y + (a.h >> 1);
      const ex = b.x + (b.w >> 1), ey = b.y + (b.h >> 1);
      let guard = 0;
      while ((cx !== ex || cy !== ey) && guard++ < 300) {
        if (cx !== ex && (R() < 0.5 || cy === ey)) cx += Math.sign(ex - cx);
        else if (cy !== ey) cy += Math.sign(ey - cy);
        for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) setT(cx + ox, cy + oy, 0);
      }
    };
    for (let i = 0; i < rooms.length - 1; i++) corridor(rooms[i], rooms[i + 1]);
    if (rooms.length > 3) { corridor(rooms[0], rooms[2]); corridor(rooms[1], rooms[3]); }
    const r0 = rooms[0];
    spawn = { x: r0.x + (r0.w >> 1), y: r0.y + (r0.h >> 1) };
    const rl = rooms[rooms.length - 1];
    exit = { x: rl.x + (rl.w >> 1), y: rl.y + (rl.h >> 1) };
    const spots = scatterFree(20);
    let li = 0;
    spots.forEach((p, i) => {
      if (i < 8) addObj('symbol', p.x, p.y, { deco: true });
      else if (i < 10 && li < 2) { addObj('lever', p.x, p.y, { id: 'lv' + li }); li++; }
      else if (i < 15) addObj('trap', p.x, p.y);
      else if (i < 17) addObj('campfire', p.x, p.y);
      else if (i < 19) addObj('note', p.x, p.y, { note: i === 17 ? 'n7' : 'n8' });
      else addObj('stash', p.x, p.y, { hidden: true });
    });
    scatterFree(4).forEach((p, i) => addObj(i % 2 ? 'resin' : 'metal', p.x, p.y, { item: i % 2 ? 'resin' : 'metal' }));
    addObj('door', exit.x, exit.y - 1, { locked: true, id: 'main', ancient: true });
    addObj('exit', exit.x, exit.y);
    for (let i = 0; i < 5; i++) { const p = scatterFree(1)[0]; enemies.push({ type: i % 2 ? 'watcher' : 'shadow', x: p.x * TILE + 8, y: p.y * TILE + 8 }); }
  }
  else if (ch === 5) { /* ПОСЛЕДНИЙ СВЕТ — арена-лабиринт */
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = dist(x, y, W / 2, H / 2);
      t[y * W + x] = d > 26 ? 1 : 0;
    }
    // кольцевые стены с проходами
    for (const r of [20, 13, 7]) {
      const gaps = 2 + (R() * 2 | 0);
      for (let a = 0; a < TAU * r; a += 0.045) {
        const x = Math.round(W / 2 + Math.cos(a) * r), y = Math.round(H / 2 + Math.sin(a) * r);
        let inGap = false;
        for (let gi = 0; gi < gaps; gi++) {
          const ga = (gi / gaps) * TAU + hash2(r, gi) * 1.5;
          let da = Math.atan2(Math.sin(a - ga), Math.cos(a - ga));
          if (Math.abs(da) < 0.22) inGap = true;
        }
        if (!inGap) setT(x, y, 1);
      }
    }
    spawn = { x: W >> 1, y: H - 6 };
    const spots = scatterFree(12);
    spots.forEach((p, i) => {
      if (i < 4) addObj('symbol', p.x, p.y, { deco: true });
      else if (i < 8) addObj('trap', p.x, p.y);
      else if (i < 10) addObj('campfire', p.x, p.y);
      else addObj('note', p.x, p.y, { note: 'n8' });
    });
    addObj('altarL', W >> 1, (H >> 1) - 3);
    addObj('altarD', W >> 1, (H >> 1) + 3);
    for (let i = 0; i < 6; i++) { const p = scatterFree(1)[0]; enemies.push({ type: i % 3 === 1 ? 'watcher' : 'shadow', x: p.x * TILE + 8, y: p.y * TILE + 8 }); }
  }

  /* количество тайников (для достижения) */
  const stashCount = objs.filter(o => o.type === 'stash').length;

  return {
    ch, W, H, tiles: t, objs, enemies,
    spawnX: spawn.x * TILE + 8, spawnY: spawn.y * TILE + 8,
    stashCount, theme: THEMES[ch - 1],
    campfires: [], // зажжённые костры (persist)
  };
}

/* ============================ ПОСТРОЕНИЕ КАРТИНЫ МИРА (один раз) ============================ */
const worldCanvases = {};
function buildWorldCanvas(world) {
  const key = world.ch + '_' + world.seed;
  if (worldCanvases[key]) return worldCanvases[key];
  const c = C(world.W * TILE, world.H * TILE);
  const g = c.getContext('2d');
  const th = world.theme;
  for (let y = 0; y < world.H; y++) for (let x = 0; x < world.W; x++) {
    const h = hash2(x, y);
    if (world.tiles[y * world.W + x] === 1) {
      g.fillStyle = h < 0.5 ? th.wall : shade(th.wall, -8);
      g.fillRect(x * TILE, y * TILE, TILE, TILE);
      g.fillStyle = shade(th.wall, 10);
      g.fillRect(x * TILE, y * TILE, TILE, 2);
      g.fillStyle = shade(th.wall, -16);
      g.fillRect(x * TILE, y * TILE + TILE - 2, TILE, 2);
    } else {
      g.fillStyle = h < 0.55 ? th.floorA : th.floorB;
      g.fillRect(x * TILE, y * TILE, TILE, TILE);
      if (h > 0.93) { g.fillStyle = shade(th.floorA, 8); g.fillRect(x * TILE + (h * 13 | 0) % 12, y * TILE + (h * 29 | 0) % 12, 2, 2); }
      if (h < 0.05) { g.fillStyle = th.stone; g.globalAlpha = 0.5; g.fillRect(x * TILE + 3, y * TILE + 5, 5, 4); g.globalAlpha = 1; }
    }
  }
  worldCanvases[key] = c;
  return c;
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/* ============================ GAME LOGIC ============================ */
function invNew() {
  return { match: 5, longmatch: 0, half: 0, torch: 0, lantern: 0, matchbox: 0, wood: 0, cloth: 0, metal: 0, resin: 0, artifact: 0, key: 0, notes: [] };
}
function matchCap() { return 10 + G.inv.matchbox * 5; }
function resCap() { return 20 + (G.upg.pack || 0) * 8; }
function resCount() { const i = G.inv; return i.wood + i.cloth + i.metal + i.resin + i.artifact; }
function burnTime(type) {
  const bonus = (G.upg.burn || 0) * 8;
  switch (type) {
    case 'longmatch': return 50 + bonus * 2;
    case 'torch': return 50 + bonus;
    case 'lantern': return 120 + bonus * 2;
    case 'half': return Math.max(6, (G.partial ? G.partial.t : 8));
    default: return 25 + bonus;
  }
}
function lightRadius(type) {
  const m = 1 + (G.upg.radius || 0) * 0.18;
  switch (type) {
    case 'longmatch': return 150 * m;
    case 'torch': return 165 * m;
    case 'lantern': return 205 * m;
    case 'campfire': return 175;
    case 'artifact': return 40;
    case 'altar': return 46;
    case 'exit': return 50;
    case 'decoy': return 130;
    default: return 120 * m;
  }
}

/* ---------- спички ---------- */
function strike() {
  if (G.match) { msg('Спичка уже горит'); return; }
  if (G.challengeNoMatch) { msg('Испытание: спички запрещены', 'warn'); return; }
  if (G.mode === 'challenge' && G.challenge === 0 && G.matchUsed >= 3) { msg('Лимит спичек исчерпан!', 'warn'); return; }
  let type = null;
  if (G.partial && G.partial.t > 2) { type = G.partial.type; G.match = { t: G.partial.t, max: G.partial.max, type }; G.partial = null; }
  else if (G.inv.match > 0) { type = 'match'; G.inv.match--; G.match = { t: burnTime('match'), max: burnTime('match'), type }; }
  else if (G.inv.longmatch > 0) { type = 'longmatch'; G.inv.longmatch--; G.match = { t: burnTime('longmatch'), max: burnTime('longmatch'), type }; }
  else if (G.inv.torch > 0) { type = 'torch'; G.inv.torch--; G.match = { t: burnTime('torch'), max: burnTime('torch'), type }; }
  else if (G.inv.lantern > 0) { type = 'lantern'; G.inv.lantern--; G.match = { t: burnTime('lantern'), max: burnTime('lantern'), type }; }
  if (!type) { msg('Спички кончились! Ищите огонь или тайники', 'warn'); AudioMan.play('event'); return; }
  G.matchUsed++; G.stats.lit++;
  AudioMan.play('strike'); vibrate(20);
  award('first_match');
  addParticles(G.player.x, G.player.y - 10, 'spark', 6);
}
function blowOut() {
  if (!G.match) return;
  if (G.match.t > 3) { G.partial = { t: G.match.t, max: G.match.max, type: G.match.type }; msg('Спичка потушена — остаток сохранён'); }
  else { G.partial = null; msg('Спичка слишком короткая — она догорела', 'warn'); }
  G.match = null;
  AudioMan.play('blow');
}
function updateMatch(dt) {
  AudioMan.crackle(dt, !!G.match);
  if (!G.match) return;
  G.match.t -= dt;
  const p = G.player;
  const hx = p.x + [2, -8, 8, 2][p.dir], hy = p.y - 12;
  if (Math.random() < dt * 8) addParticles(hx, hy, 'ember', 1);
  if (Math.random() < dt * 2.2) addParticles(hx, hy, 'smoke', 1);
  if (G.match.t <= 0) {
    G.match = null; G.partial = null;
    msg('Спичка догорела... Тьма смыкается', 'warn');
    AudioMan.play('blow'); vibrate(30);
  }
}

/* ---------- освещение ---------- */
function computeLights() {
  const L = [];
  const p = G.player;
  if (G.inv.artifact > 0) L.push({ x: p.x, y: p.y, r: lightRadius('artifact'), col: '120,180,255', s: 0.25, flick: false });
  if (G.match) {
    let f = 1;
    const k = G.match.t / G.match.max;
    if (k < 0.25) f = 0.6 + 0.4 * k * 4;
    f *= 1 + 0.045 * Math.sin(G.time * 13) + 0.03 * Math.sin(G.time * 29 + 1);
    if (k < 0.12 && Math.random() < 0.06) f *= 0.35; // мерцание перед концом
    L.push({ x: p.x, y: p.y - 10, r: lightRadius(G.match.type) * f, col: '255,170,80', s: 1, flick: true });
  }
  for (const o of G.world.objs) {
    if (o.data.lit) L.push({ x: o.x, y: o.y - 6, r: lightRadius('campfire') * (1 + 0.06 * Math.sin(G.time * 9 + o.tx)), col: '255,150,60', s: 0.95, flick: true });
    else if (o.type === 'altarL') L.push({ x: o.x, y: o.y - 8, r: lightRadius('altar'), col: '255,190,90', s: 0.5, flick: true });
    else if (o.type === 'altarD') L.push({ x: o.x, y: o.y - 8, r: lightRadius('altar'), col: '110,140,216', s: 0.5, flick: true });
    else if (o.type === 'exit') L.push({ x: o.x, y: o.y - 4, r: lightRadius('exit'), col: '90,160,220', s: 0.4, flick: false });
    else if (o.type === 'decoy' && !o.data.dead) L.push({ x: o.x, y: o.y, r: lightRadius('decoy') * (1 + 0.1 * Math.sin(G.time * 3)), col: '160,220,255', s: 0.8, flick: true });
  }
  return L;
}

/* ---------- частицы ---------- */
function addParticles(x, y, type, n) {
  const q = G.settings.quality === 0 ? 0.4 : G.settings.quality === 2 ? 1.6 : 1;
  n = Math.round(n * q);
  const cap = G.settings.quality === 0 ? 90 : 220;
  for (let i = 0; i < n; i++) {
    if (G.particles.length >= cap) return;
    const a = Math.random() * TAU, sp = 6 + Math.random() * 18;
    const pt = { x, y, vx: 0, vy: 0, life: 0, max: 1, type };
    if (type === 'ember') { pt.vx = Math.cos(a) * sp * 0.4; pt.vy = -14 - Math.random() * 16; pt.max = 0.5 + Math.random() * 0.5; pt.size = 1 + (Math.random() * 1.5 | 0); }
    else if (type === 'smoke') { pt.vy = -8 - Math.random() * 8; pt.vx = (Math.random() - 0.5) * 8; pt.max = 1.2 + Math.random(); pt.size = 2; }
    else if (type === 'spark') { pt.vx = Math.cos(a) * sp * 2; pt.vy = Math.sin(a) * sp * 2 - 8; pt.max = 0.3 + Math.random() * 0.3; pt.size = 1; }
    else if (type === 'puff') { pt.vx = (Math.random() - 0.5) * 12; pt.vy = -6 - Math.random() * 6; pt.max = 0.6; pt.size = 2; }
    pt.life = pt.max;
    G.particles.push(pt);
  }
}
function updateParticles(dt) {
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.type === 'ember') p.vy -= 6 * dt;
    if (p.life <= 0) G.particles.splice(i, 1);
  }
}

/* ---------- столкновения ---------- */
function tileSolid(wx, wy) {
  const w = G.world;
  const tx = (wx / TILE) | 0, ty = (wy / TILE) | 0;
  if (tx < 0 || ty < 0 || tx >= w.W || ty >= w.H) return true;
  return w.tiles[ty * w.W + tx] === 1;
}
function objBox(o) {
  switch (o.type) {
    case 'door': return o.data.open ? null : [o.x - 8, o.y - 10, 16, 20];
    case 'hut': return [o.x - 17, o.y - 12, 34, 14];
    case 'house': return null;
    case 'well': return [o.x - 9, o.y - 8, 18, 10];
    case 'rock': return [o.x - 6, o.y - 6, 12, 8];
    case 'cart': return [o.x - 9, o.y - 5, 18, 8];
    case 'altarL': case 'altarD': return [o.x - 9, o.y - 8, 18, 12];
    default: return null;
  }
}
function collideAt(wx, wy, r) {
  if (tileSolid(wx - r, wy - r) || tileSolid(wx + r, wy - r) || tileSolid(wx - r, wy + r) || tileSolid(wx + r, wy + r)) return true;
  if (tileSolid(wx, wy - r) || tileSolid(wx, wy + r) || tileSolid(wx - r, wy) || tileSolid(wx + r, wy)) return true;
  for (const o of G.world.objs) {
    if (o.data.taken) continue;
    const b = objBox(o);
    if (!b) continue;
    if (wx + r > b[0] && wx - r < b[0] + b[2] && wy + r > b[1] && wy - r < b[1] + b[3]) return true;
  }
  return false;
}

/* ---------- игрок ---------- */
function updatePlayer(dt) {
  const p = G.player;
  Input.update();
  const sp = 62;
  const vx = Input.mx * sp, vy = Input.my * sp;
  p.moving = !!(vx || vy);
  if (p.moving) {
    if (Math.abs(vx) > Math.abs(vy)) p.dir = vx > 0 ? 2 : 1;
    else p.dir = vy > 0 ? 0 : 3;
    p.animT += dt;
    p.stepT -= dt;
    if (p.stepT <= 0) { p.stepT = 0.34; AudioMan.play('step'); }
  }
  const nx = p.x + vx * dt, ny = p.y + vy * dt;
  if (!collideAt(nx, p.y, 5)) p.x = nx;
  if (!collideAt(p.x, ny, 5)) p.y = ny;
  if (p.hurtT > 0) p.hurtT -= dt;
  // камера
  const vw = canvas.width / zoom(), vh = canvas.height / zoom();
  G.camX = clamp(p.x - vw / 2, 0, G.world.W * TILE - vw);
  G.camY = clamp(p.y - vh / 2, 0, G.world.H * TILE - vh);
  if (G.world.W * TILE < vw) G.camX = (G.world.W * TILE - vw) / 2;
  if (G.world.H * TILE < vh) G.camY = (G.world.H * TILE - vh) / 2;
}

/* ---------- враги ---------- */
function spawnEnemies() {
  G.enemies = G.world.enemies.map(e => {
    const en = { type: e.type, x: e.x, y: e.y, homeX: e.x, homeY: e.y, cool: 0, animT: Math.random() * 10, tx: e.x, ty: e.y, repath: 0 };
    if (e.type === 'watcher') {
      en.wps = []; const R = mulberry32(e.x | 0);
      for (let i = 0; i < 4; i++) {
        const a = R() * TAU, d = 60 + R() * 110;
        en.wps.push({ x: clamp(e.x + Math.cos(a) * d, 24, G.world.W * TILE - 24), y: clamp(e.y + Math.sin(a) * d, 24, G.world.H * TILE - 24) });
      }
      en.wi = 0;
    }
    return en;
  });
}
function updateEnemies(dt, lights) {
  const p = G.player;
  const pLit = !!G.match;
  for (const e of G.enemies) {
    e.animT += dt;
    if (e.cool > 0) e.cool -= dt;
    let ax = 0, ay = 0;
    const dp = dist(e.x, e.y, p.x, p.y);
    if (e.type === 'shadow') {
      if (!pLit && dp < 320) { ax += (p.x - e.x) / dp; ay += (p.y - e.y) / dp; } // тьма — охота
      else if (pLit) { // свет — держаться на границе и обходить
        const lr = lightRadius(G.match ? G.match.type : 'match');
        if (dp < lr + 26) { ax -= (p.x - e.x) / dp * 1.4; ay -= (p.y - e.y) / dp * 1.4; }
        else { ax += Math.sin(e.animT * 0.7) * 0.5; ay += Math.cos(e.animT * 0.9) * 0.5; }
      } else { ax += Math.sin(e.animT * 0.6); ay += Math.cos(e.animT * 0.8); }
    } else { // странник — маршрут, охота рядом
      const wp = e.wps[e.wi];
      const dw = dist(e.x, e.y, wp.x, wp.y);
      if (dw < 12) e.wi = (e.wi + 1) % e.wps.length;
      if (dp < 120) { ax += (p.x - e.x) / dp; ay += (p.y - e.y) / dp; }
      else if (dw > 4) { ax += (wp.x - e.x) / dw; ay += (wp.y - e.y) / dw; }
    }
    // отталкивание от света
    for (const L of lights) {
      const dl = dist(e.x, e.y, L.x, L.y);
      if (dl < L.r && L.s > 0.5) { ax += (e.x - L.x) / (dl || 1) * 2.2; ay += (e.y - L.y) / (dl || 1) * 2.2; }
    }
    const al = Math.hypot(ax, ay);
    if (al > 0.01) {
      const sp = (e.type === 'shadow' ? (pLit ? 34 : 52) : 40) * (1 + (G.mode === 'endless' ? G.depth * 0.05 : 0));
      const nx = e.x + (ax / al) * sp * dt, ny = e.y + (ay / al) * sp * dt;
      if (!collideAt(nx, e.y, 6)) e.x = nx;
      if (!collideAt(e.x, ny, 6)) e.y = ny;
    }
    if (dp < 13 && e.cool <= 0) {
      e.cool = 1.3;
      hurt(e.type === 'shadow' ? 12 : 16, e.x, e.y);
      AudioMan.play('enemy');
    }
  }
}

/* ---------- ловушки и холод ---------- */
function updateTraps(dt) {
  const p = G.player;
  for (const o of G.world.objs) {
    if (o.type !== 'trap' || o.data.sprung) continue;
    if (dist(p.x, p.y, o.x, o.y) < 9) {
      o.data.sprung = true; G.dyn['tr_' + o.idx] = 1;
      hurt(16, o.x, o.y);
      AudioMan.play('trap');
      addParticles(o.x, o.y, 'spark', 8);
    }
  }
}
function updateCold(dt, lights) {
  const p = G.player;
  const litNow = lights.some(L => L.s > 0.4 && dist(p.x, p.y, L.x, L.y) < L.r * 0.8);
  if (!litNow) {
    G.coldT += dt;
    if (G.coldT > 20) {
      p.hp -= (G.challenge === 1 && G.mode === 'challenge' ? 0.8 : 1.6) * dt;
      if (p.hp <= 0) { p.hp = 0; die(); }
    }
    $('#vignette').classList.add('cold');
  } else {
    G.coldT = Math.max(0, G.coldT - dt * 3);
    $('#vignette').classList.remove('cold');
  }
}

/* ---------- урон и смерть ---------- */
function hurt(dmg, sx, sy) {
  const p = G.player;
  if (p.hurtT > 0 || G.state !== 'play') return;
  p.hp -= dmg; p.hurtT = 0.9; G.noHit = false;
  const d = Math.max(1, dist(p.x, p.y, sx, sy));
  p.x += (p.x - sx) / d * 14; p.y += (p.y - sy) / d * 14;
  AudioMan.play('hurt'); vibrate(60);
  const v = $('#vignette'); v.classList.add('hurt'); setTimeout(() => v.classList.remove('hurt'), 350);
  addParticles(p.x, p.y - 8, 'spark', 6);
  if (p.hp <= 0) { p.hp = 0; die(); }
}
function die() {
  if (G.state !== 'play') return;
  G.stats.deaths++;
  AudioMan.play('gameover'); vibrate([80, 60, 80]);
  if (G.mode === 'challenge') { UI.challengeEnd(false, 'Вы погибли'); return; }
  if (G.mode === 'endless' && G.distance > G.records.endless) { G.records.endless = G.distance; Save.set('records', G.records); }
  saveNow();
  UI.showGameOver();
}

/* ---------- взаимодействие ---------- */
const INTERACT = {
  mushroom: () => 'Сорвать гриб', wood: () => 'Подобрать древесину', resin: () => 'Собрать смолу', metal: () => 'Взять металл',
  stash: o => o.data.opened ? null : 'Открыть тайник',
  campfire: o => o.data.lit ? null : 'Разжечь костёр (2 древесины)',
  note: o => o.data.read ? 'Перечитать записку' : 'Прочитать записку',
  door: o => o.data.open ? null : (o.data.ancient ? 'Древняя дверь' : 'Открыть дверь'),
  lever: o => o.data.on ? null : 'Переключить механизм',
  exit: () => 'Выйти',
  altarL: () => 'Вложить огонь в Свет', altarD: () => 'Отдать огонь Тьме',
};
function scanInteract() {
  const p = G.player;
  let best = null, bd = 30 * 30;
  for (const o of G.world.objs) {
    if (o.data.taken) continue;
    const label = INTERACT[o.type] ? INTERACT[o.type](o) : null;
    if (!label) continue;
    const d = dist2(p.x, p.y, o.x, o.y);
    if (d < bd) { bd = d; best = { o, label }; }
  }
  G.prompt = best;
}
function doInteract(o) {
  const p = G.player;
  switch (o.type) {
    case 'mushroom': case 'wood': case 'resin': case 'metal': {
      o.data.taken = true; G.dyn['tk_' + o.idx] = 1;
      const it = o.type === 'mushroom' ? null : o.type;
      let qty = 1;
      if (it && G.upg.gather && Math.random() < 0.35 * G.upg.gather) qty++;
      if (o.type === 'mushroom') {
        if (G.mode === 'challenge' && G.challenge === 2) { G.chMush++; msg('Гриб собран: ' + G.chMush + '/' + G.chMushNeed, 'good'); }
        else msg('Съедобный гриб (+5 здоровья)', 'good');
        p.hp = Math.min(p.maxhp, p.hp + 5);
        gainXP(4);
      } else {
        if (resCount() + qty > resCap()) { o.data.taken = false; delete G.dyn['tk_' + o.idx]; msg('Рюкзак полон!', 'warn'); return; }
        G.inv[it] += qty; msg(ITEMS[it].name + ' ×' + qty, 'good'); gainXP(5);
      }
      AudioMan.play('pickup');
      addParticles(o.x, o.y, 'spark', 4);
      break;
    }
    case 'stash': {
      o.data.opened = true; G.dyn['st_' + o.idx] = 1;
      const R = Math.random;
      const loot = [];
      const m = 2 + (R() * 3 | 0);
      const addM = Math.min(m, matchCap() - G.inv.match);
      if (addM > 0) { G.inv.match += addM; loot.push('спички ×' + addM); }
      if (R() < 0.6) { const n = Math.min(2, resCap() - resCount()); if (n > 0) { G.inv.wood += n; loot.push('древесина ×' + n); } }
      if (R() < 0.4) { G.inv.cloth++; loot.push('ткань'); }
      if (R() < 0.35) { G.inv.resin++; loot.push('смола'); }
      if (R() < 0.18) { G.inv.artifact++; loot.push('артефакт!'); }
      msg('Тайник: ' + (loot.join(', ') || 'пусто'), 'good');
      AudioMan.play('pickup'); gainXP(20); award('first_stash');
      const all = G.world.objs.filter(s => s.type === 'stash');
      if (all.every(s => s.data.opened)) award('secret_all');
      break;
    }
    case 'campfire': {
      if (G.inv.wood < 2) { msg('Нужно 2 древесины', 'warn'); return; }
      G.inv.wood -= 2;
      o.data.lit = true; G.dyn['cf_' + o.idx] = 1;
      AudioMan.play('strike'); vibrate(20);
      msg('Костёр разведён. Тени отступят', 'good');
      addParticles(o.x, o.y - 6, 'ember', 12);
      gainXP(8);
      break;
    }
    case 'note': {
      o.data.read = true;
      if (!G.inv.notes.includes(o.data.note)) {
        G.inv.notes.push(o.data.note); G.stats.notes++;
        gainXP(15); AudioMan.play('note');
        if (G.inv.notes.length >= 5) award('notes5');
        if (G.inv.notes.length >= 10) award('notes10');
      }
      UI.showNote(o.data.note);
      break;
    }
    case 'door': {
      if (o.data.open) return;
      if (o.data.ancient) {
        const on = G.world.objs.filter(l => l.type === 'lever' && l.data.on).length;
        if (on >= 2) { o.data.open = true; G.dyn['dr_' + o.idx] = 1; AudioMan.play('door'); msg('Древний проход открыт!', 'good'); gainXP(30); }
        else msg('Дверь запечатана. Активировано механизмов: ' + on + '/2', 'warn');
      } else {
        if (G.inv.key > 0) { G.inv.key--; o.data.open = true; G.dyn['dr_' + o.idx] = 1; AudioMan.play('door'); msg('Дверь открыта старым ключом', 'good'); gainXP(25); }
        else msg('Заперто. Ключ оставили в вагонетке у старого забоя', 'warn');
      }
      break;
    }
    case 'lever': {
      o.data.on = true; G.dyn['lv_' + o.idx] = 1;
      AudioMan.play('lever'); vibrate(15);
      const on = G.world.objs.filter(l => l.type === 'lever' && l.data.on).length;
      msg('Механизм активирован: ' + on + '/2', 'good');
      gainXP(20);
      break;
    }
    case 'exit': {
      const door = G.world.objs.find(d => d.type === 'door' && d.data.id === 'main');
      if (door && !door.data.open) { msg('Путь преграждает запечатанная дверь', 'warn'); return; }
      completeChapter();
      break;
    }
    case 'altarL': doEnding('light'); break;
    case 'altarD': doEnding('dark'); break;
  }
}

/* ---------- главы, концовки, режимы ---------- */
function completeChapter() {
  if (G.state !== 'play') return;
  AudioMan.play('exit'); vibrate(30);
  if (G.mode === 'challenge') {
    if (G.challenge === 0 && G.matchUsed > 3) { UI.challengeEnd(false, 'Превышен лимит спичек'); return; }
    UI.challengeEnd(true);
    return;
  }
  if (G.mode === 'endless') {
    G.depth++;
    G.distance += 60 + G.depth * 12;
    if (G.distance >= 250) award('endless250');
    if (G.distance >= 1000) award('endless1000');
    if (G.distance > G.records.endless) G.records.endless = G.distance;
    Save.set('records', G.records);
    msg('Глубже... Глубина ' + G.depth + ' • Путь: ' + G.distance + ' м', 'good');
    gainXP(15 + G.depth * 5);
    G.dyn = {};
    G.seed = (Math.random() * 1e9) | 0;
    G.world = genWorld(6, G.seed);
    G.world.seed = G.seed;
    afterWorldGen(true);
    saveNow();
    return;
  }
  // кампания
  const done = G.chapter;
  if (done === 1) award('ch1');
  if (G.noHit) award('nohit');
  gainXP(100);
  G.stats.chapters++;
  G.unlocked = Math.max(G.unlocked, Math.min(5, done + 1));
  if (done >= 5) { doEnding('light'); return; }
  G.chapter = done + 1;
  UI.fadeBlink(() => {
    startChapter(G.chapter);
    UI.chapterIntro(G.chapter);
  });
}
function doEnding(kind) {
  if (G.state !== 'play') return;
  if (!G.endings.includes(kind)) G.endings.push(kind);
  award(kind === 'light' ? 'end_light' : 'end_dark');
  if (G.endings.length >= 2) award('all_end');
  G.unlocked = 5;
  if (G.noHit) award('nohit');
  gainXP(150);
  Save.set('achievements', { ach: G.ach, stats: G.stats });
  saveNow();
  AudioMan.play('exit');
  UI.showEnding(kind);
}

/* ---------- случайные события ---------- */
const EVENTS = [
  { w: 3, fn() { const n = Math.min(3, matchCap() - G.inv.match); if (n > 0) { G.inv.match += n; msg('Вы нашли чужой коробок: +' + n + ' спички', 'good'); } else return false; } },
  { w: 3, fn() { const a = Math.random() * TAU; const e = { type: 'shadow', x: G.player.x + Math.cos(a) * 200, y: G.player.y + Math.sin(a) * 200, homeX: 0, homeY: 0, cool: 0, animT: 0 }; e.homeX = e.x; e.homeY = e.y; G.enemies.push(e); msg('Вы слышите шаги в темноте...', 'warn'); AudioMan.play('enemy'); } },
  { w: 2, fn() { spawnNear('stash'); msg('Под сухими листьями вы замечаете тайник', 'good'); } },
  { w: 2, fn() { spawnNear('note'); msg('К камню прижата записка', 'good'); } },
  { w: 2, fn() { const a = Math.random() * TAU; const e = { type: 'watcher', x: G.player.x + Math.cos(a) * 260, y: G.player.y + Math.sin(a) * 260, homeX: 0, homeY: 0, cool: 0, animT: 0, wi: 0, wps: [{ x: G.player.x + Math.cos(a) * 260, y: G.player.y + Math.sin(a) * 260 }] }; e.homeX = e.x; e.homeY = e.y; G.enemies.push(e); msg('Вдали мелькает странная фигура', 'warn'); } },
  { w: 2, fn() { const a = Math.random() * TAU; const d = 150; const x = G.player.x + Math.cos(a) * d, y = G.player.y + Math.sin(a) * d; const o = { type: 'decoy', x, y, tx: (x / TILE) | 0, ty: (y / TILE) | 0, data: {} }; G.world.objs.push(o); msg('Вдалеке пляшет подозрительный свет...', 'warn'); AudioMan.play('event'); } },
  { w: 2, fn() { if (resCount() + 2 <= resCap()) { G.inv.metal++; G.inv.cloth++; msg('Сломанный фонарь: металл и ткань', 'good'); } else return false; } },
];
function spawnNear(type) {
  const p = G.player;
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * TAU, d = 60 + Math.random() * 70;
    const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
    if (!collideAt(x, y, 8) && !tileSolid(x, y)) {
      const o = { type, x, y, tx: (x / TILE) | 0, ty: (y / TILE) | 0, data: {} };
      if (type === 'note') o.data.note = 'n' + (1 + (Math.random() * 12 | 0));
      if (type === 'stash') o.data.hidden = true;
      o.idx = G.world.objs.length;
      G.world.objs.push(o);
      return;
    }
  }
}
function updateEvents(dt) {
  if (G.mode === 'challenge') return;
  G.eventT -= dt;
  if (G.eventT > 0) return;
  G.eventT = 35 + Math.random() * 25;
  if (G.state !== 'play') return;
  const total = EVENTS.reduce((s, e) => s + e.w, 0);
  let r = Math.random() * total;
  for (const e of EVENTS) {
    r -= e.w;
    if (r <= 0) { try { if (e.fn() === false) G.eventT = 12; } catch (err) { } break; }
  }
}

/* ---------- XP, уровни, достижения ---------- */
function gainXP(n) {
  G.xp += n;
  while (G.xp >= G.level * 100) {
    G.xp -= G.level * 100; G.level++; G.sp++;
    msg('Уровень ' + G.level + '! Очко улучшения (+)', 'good');
    AudioMan.play('levelup');
    if (G.level >= 5) award('lvl5');
  }
}
function award(id) {
  if (G.ach[id]) return;
  G.ach[id] = Date.now();
  const a = ACH[id];
  if (a) { msg('Достижение: ' + a.name, 'good'); AudioMan.play('achieve'); Save.set('achievements', { ach: G.ach, stats: G.stats }); }
}
function applyUpgrades() {
  const newMax = 100 + (G.upg.hp || 0) * 25;
  if (newMax !== G.player.maxhp) { G.player.hp += Math.max(0, newMax - G.player.maxhp); G.player.maxhp = newMax; }
  G.player.hp = clamp(G.player.hp, 0, G.player.maxhp);
}

/* ---------- сохранение ---------- */
function snapshot() {
  return {
    version: 1, mode: G.mode, chapter: G.chapter, seed: G.seed, dyn: G.dyn,
    x: G.player.x, y: G.player.y, hp: G.player.hp,
    inv: G.inv, xp: G.xp, level: G.level, sp: G.sp, upg: G.upg,
    partial: G.partial, match: null,
    stats: G.stats, unlocked: G.unlocked, endings: G.endings,
    challenge: G.challenge, depth: G.depth, distance: G.distance,
  };
}
function saveNow() {
  if (G.state === 'boot' || G.state === 'menu') return;
  const key = G.mode === 'endless' ? 'endless' : G.mode === 'campaign' ? 'campaign' : null;
  if (!key) return;
  try { Save.set(key, snapshot()); } catch (e) { }
}
async function loadSave(key) {
  const s = await Save.get(key);
  if (!s || s.version !== 1) return null;
  return s;
}

/* ---------- запуск главы/мира ---------- */
function startChapter(ch, keepInv) {
  G.chapter = ch;
  G.mode = 'campaign';
  G.seed = (Math.random() * 1e9) | 0;
  G.world = genWorld(ch, G.seed);
  G.world.seed = G.seed;
  if (!keepInv) {
    G.inv = invNew(); G.xp = 0; G.level = 1; G.sp = 0; G.upg = {};
    G.partial = null; G.match = null;
  }
  afterWorldGen(false);
}
function afterWorldGen(isEndless) {
  const w = G.world;
  w.objs.forEach((o, i) => { o.idx = i; });
  // восстановить динамическое состояние
  for (const k in G.dyn) {
    const [pref, idx] = k.split('_');
    const o = w.objs[+idx];
    if (!o) continue;
    if (pref === 'cf') o.data.lit = true;
    else if (pref === 'dr') o.data.open = true;
    else if (pref === 'lv') o.data.on = true;
    else if (pref === 'st') o.data.opened = true;
    else if (pref === 'tk') o.data.taken = true;
    else if (pref === 'tr') o.data.sprung = true;
  }
  G.player.x = w.spawnX; G.player.y = w.spawnY;
  G.player.hurtT = 0;
  G.match = null; G.coldT = 0; G.noHit = true; G.matchUsed = 0;
  G.eventT = 25; G.dyn = G.dyn || {};
  spawnEnemies();
  G.particles = [];
  buildWorldCanvas(w);
  applyUpgrades();
  G.state = 'play';
  UI.showHUD(true);
  updateHUD(true);
}
function newGame() {
  G.mode = 'campaign'; G.chapter = 1;
  G.dyn = {}; G.stats = { deaths: 0, lit: 0, kills: 0, crafted: 0, chapters: 0, notes: 0 };
  G.depth = 1; G.distance = 0;
  startChapter(1, false);
  Save.set('campaign', snapshot());
  UI.chapterIntro(1);
}
async function continueGame() {
  const s = await loadSave('campaign');
  if (!s) { msg('Сохранение не найдено', 'warn'); return; }
  restoreRun(s);
  UI.chapterIntro(G.chapter);
}
async function continueEndless() {
  const s = await loadSave('endless');
  if (!s) { msg('Сохранение не найдено', 'warn'); return; }
  restoreRun(s);
  msg('Бесконечная ночь • Глубина ' + G.depth + ' • ' + G.distance + ' м', 'good');
}
function restoreRun(s) {
  G.mode = s.mode; G.chapter = s.chapter; G.seed = s.seed; G.dyn = s.dyn || {};
  G.inv = s.inv; G.xp = s.xp; G.level = s.level; G.sp = s.sp; G.upg = s.upg || {};
  G.partial = s.partial; G.stats = s.stats; G.unlocked = s.unlocked; G.endings = s.endings || [];
  G.challenge = s.challenge || 0; G.depth = s.depth || 1; G.distance = s.distance || 0;
  G.player.hp = s.hp;
  G.world = genWorld(G.chapter, G.seed);
  G.world.seed = G.seed;
  afterWorldGen(G.mode === 'endless');
  G.player.x = s.x; G.player.y = s.y;
}

/* ---------- испытания ---------- */
const CHALLENGES = [
  { name: 'Эконом', desc: 'Дойдите до выхода леса, зажав не более 3 спичек. Костры в помощь.', reward: 75 },
  { name: 'Сквозь тьму', desc: 'Спички запрещены! Пройдите шахту, используя только костры.', reward: 100 },
  { name: 'Сборщик', desc: 'Соберите 6 грибов за 3 минуты. Спички — по желанию.', reward: 75 },
];
function startChallenge(i) {
  G.mode = 'challenge'; G.challenge = i;
  G.dyn = {}; G.matchUsed = 0;
  G.world = genWorld(i === 1 ? 2 : 1, (Math.random() * 1e9) | 0);
  G.world.seed = G.seed = (Math.random() * 1e9) | 0;
  G.inv = invNew(); G.xp = 0; G.level = 1; G.sp = 0; G.upg = {};
  G.partial = null; G.match = null;
  if (i === 0) G.inv.match = 3;
  if (i === 1) { G.inv.match = 0; G.challengeNoMatch = true; } else G.challengeNoMatch = false;
  if (i === 2) { G.chMush = 0; G.chMushNeed = 6; G.chTimer = 180; G.chTot = 6; } else { G.chTimer = 0; }
  afterWorldGen(false);
  UI.challengeIntro(i);
}
function startEndless(fresh) {
  G.mode = 'endless'; G.challengeNoMatch = false;
  if (fresh) {
    G.dyn = {}; G.depth = 1; G.distance = 0;
    G.inv = invNew(); G.inv.match = 6; G.xp = 0; G.level = 1; G.sp = 0; G.upg = {};
    G.partial = null; G.match = null;
  }
  if (fresh) G.dyn = {};
  G.seed = (Math.random() * 1e9) | 0;
  G.world = genWorld(6, G.seed);
  G.world.seed = G.seed;
  afterWorldGen(true);
  if (fresh) msg('Бесконечная ночь началась...', 'good');
  saveNow();
}

/* ---------- главный update ---------- */
function update(dt) {
  G.time += dt; G.chTime += dt;
  updatePlayer(dt);
  if (Input.takeStrike()) strike();
  if (Input.takeBlow()) blowOut();
  updateMatch(dt);
  const lights = computeLights();
  G.lights = lights;
  updateEnemies(dt, lights);
  updateTraps(dt);
  updateCold(dt, lights);
  updateEvents(dt);
  updateParticles(dt);
  scanInteract();
  if (Input.takeAct() && G.prompt) doInteract(G.prompt.o);
  if (G.chTimer > 0 && G.mode === 'challenge') {
    G.chTimer -= dt;
    if (G.chTimer <= 0) { UI.challengeEnd(false, 'Время вышло'); return; }
    if (G.challenge === 2 && G.chMush >= G.chMushNeed) { UI.challengeEnd(true); return; }
  }
  G.saveT += dt;
  if (G.saveT > 12) { G.saveT = 0; saveNow(); }
  G.hudT -= dt;
  if (G.hudT <= 0) { G.hudT = 0.12; updateHUD(); }
}
function msg(text, cls) { UI.toast(text, cls); }

/* ============================ RENDER ============================ */
const canvas = $('#game');
const ctx = canvas.getContext('2d');
const lightCv = C(8, 8);
const lctx = lightCv.getContext('2d');
let DPR = 1;

function resize() {
  DPR = G.settings.quality === 0 ? 1 : Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * DPR);
  canvas.height = Math.round(window.innerHeight * DPR);
  lightCv.width = canvas.width; lightCv.height = canvas.height;
}
function zoom() { return canvas.width / (21 * TILE); } // ~21 клетки по ширине

function render(dt) {
  const z = zoom();
  const cw = canvas.width, chh = canvas.height;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cw, chh);

  if (G.state === 'menu' || !G.world) { renderMenuBg(); return; }

  const camX = G.camX, camY = G.camY;
  // мир
  const wc = buildWorldCanvas(G.world);
  ctx.drawImage(wc, camX, camY, cw / z, chh / z, 0, 0, cw, chh);

  // объекты (отсортированные по y)
  const objs = G.world.objs.filter(o => {
    if (o.data.taken) return false;
    return o.x > camX - 60 && o.x < camX + cw / z + 60 && o.y > camY - 70 && o.y < camY + chh / z + 40;
  }).sort((a, b) => a.y - b.y);
  for (const o of objs) drawObj(o, camX, camY, z);

  // враги
  for (const e of G.enemies) {
    if (e.x < camX - 40 || e.x > camX + cw / z + 40 || e.y < camY - 40 || e.y > camY + chh / z + 40) continue;
    const sp = e.type === 'shadow' ? SPR.shadow : SPR.watcher;
    const bob = Math.sin(e.animT * 6) * 1.5;
    const dx = (e.x - camX) * z - sp.width * z / 2, dy = (e.y - camY) * z - sp.height * z + bob * z * 0.3;
    ctx.globalAlpha = e.type === 'shadow' ? 0.85 + 0.15 * Math.sin(e.animT * 4) : 1;
    ctx.drawImage(sp, dx, dy, sp.width * z, sp.height * z);
    ctx.globalAlpha = 1;
  }

  // игрок
  drawPlayerR(camX, camY, z);

  // частицы
  for (const p of G.particles) {
    const a = clamp(p.life / p.max, 0, 1);
    const sx = (p.x - camX) * z, sy = (p.y - camY) * z;
    if (p.type === 'ember') { ctx.globalAlpha = a; ctx.fillStyle = a > 0.5 ? '#ffcf6a' : '#ff8c2e'; }
    else if (p.type === 'smoke') { ctx.globalAlpha = a * 0.25; ctx.fillStyle = '#9a9a92'; }
    else { ctx.globalAlpha = a; ctx.fillStyle = '#ffe9a8'; }
    const s = Math.max(1, p.size * z * 0.7);
    ctx.fillRect(sx, sy, s, s);
    ctx.globalAlpha = 1;
  }

  // темнота + свет
  renderDarkness(camX, camY, z);

  // пламя спички поверх темноты
  if (G.match) drawFlame((G.player.x - camX) * z, (G.player.y - camY) * z - 12 * z, z, G.match.type);
}

function drawObj(o, camX, camY, z) {
  const sp = {
    rock: SPR.rock, bush: SPR.bush, hut: SPR.hut, house: SPR.house, well: SPR.well,
    cart: SPR.cart, support: SPR.support, symbol: SPR.symbol, mushroom: SPR.mushroom,
    collapse: SPR.collapse,
    stash: o.data.opened ? SPR.stashO : SPR.stash,
    campfire: o.data.lit ? SPR.campL : SPR.campU,
    door: o.data.open ? SPR.doorO : SPR.doorC,
    trap: o.data.sprung ? SPR.spikesS : SPR.spikesU,
    lever: o.data.on ? SPR.leverO : SPR.leverU,
    altarL: SPR.altarL, altarD: SPR.altarD,
  }[o.type];
  const dx = (o.x - camX) * z, dy = (o.y - camY) * z;
  const glow = G.prompt && G.prompt.o === o;
  if (o.type === 'treeA' || o.type === 'treeB') return; // деревья-стены в тайлах
  if (o.type === 'mushroom' || o.type === 'wood' || o.type === 'resin' || o.type === 'metal') {
    const bob = Math.sin(G.time * 3 + o.idx) * 1.2;
    const icon = { mushroom: SPR.mushroom, wood: SPR.icon.wood, resin: SPR.icon.resin, metal: SPR.icon.metal }[o.type];
    ctx.drawImage(icon, dx - icon.width * z / 2, dy - icon.height * z - bob * z, icon.width * z, icon.height * z);
  } else if (o.type === 'note') {
    ctx.drawImage(SPR.icon.note, dx - 8 * z, dy - 10 * z + Math.sin(G.time * 2 + o.idx) * z, 16 * z, 16 * z);
  } else if (o.type === 'exit') {
    ctx.drawImage(SPR.exit, dx - 14 * z, dy - 26 * z, 28 * z, 34 * z);
  } else if (sp) {
    ctx.drawImage(sp, dx - sp.width * z / 2, dy - sp.height * z, sp.width * z, sp.height * z);
  }
  if (o.data.lit && o.type === 'campfire') {
    drawFlame(dx, dy - 8 * z, z * 0.8, 'campfire');
  }
  if (glow) { // подсветка доступного действия
    ctx.strokeStyle = 'rgba(255,215,106,0.85)';
    ctx.lineWidth = Math.max(1.5, z);
    ctx.strokeRect(dx - 11 * z, dy - 22 * z, 22 * z, 26 * z);
  }
}

function drawPlayerR(camX, camY, z) {
  const p = G.player;
  const f = p.moving ? ((p.animT * 6 | 0) % 2) : 0;
  const sp = SPR.player[p.dir * 2 + f];
  const bob = p.moving ? Math.abs(Math.sin(p.animT * 12)) * 1.2 : 0;
  const dx = (p.x - camX) * z - sp.width * z / 2, dy = (p.y - camY) * z - sp.height * z - bob * z;
  ctx.drawImage(sp, dx, dy, sp.width * z, sp.height * z);
  if (p.hurtT > 0 && (p.hurtT * 12 | 0) % 2 === 0) {
    ctx.globalAlpha = 0.45; ctx.fillStyle = '#c03020';
    ctx.fillRect(dx, dy, sp.width * z, sp.height * z); ctx.globalAlpha = 1;
  }
}

function drawFlame(x, y, z, type) {
  const t = G.time;
  const w = (type === 'lantern' ? 6 : type === 'campfire' ? 9 : 5) * z;
  const h = (type === 'lantern' ? 7 : type === 'campfire' ? 13 : 10) * z;
  const wob = Math.sin(t * 11) * 0.12 + Math.sin(t * 23) * 0.07;
  ctx.drawImage(SPR.flameGlow, x - 16 * z, y - 16 * z, 32 * z, 32 * z);
  ctx.fillStyle = '#e8641e';
  ctx.beginPath(); ctx.ellipse(x, y - h * 0.35, w * (0.75 + wob), h * 0.55, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffab2e';
  ctx.beginPath(); ctx.ellipse(x, y - h * 0.42, w * (0.55 - wob), h * 0.4, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffe08a';
  ctx.beginPath(); ctx.ellipse(x, y - h * 0.45, w * 0.3, h * 0.24, 0, 0, TAU); ctx.fill();
}

function renderDarkness(camX, camY, z) {
  const w = G.world;
  const amb = w.theme.amb;
  lctx.globalCompositeOperation = 'source-over';
  lctx.clearRect(0, 0, lightCv.width, lightCv.height);
  lctx.fillStyle = 'rgba(4,7,12,' + amb + ')';
  lctx.fillRect(0, 0, lightCv.width, lightCv.height);
  lctx.globalCompositeOperation = 'destination-out';
  const base = G.match ? null : 30; // слабый собственный ореол, чтобы не слепнуть полностью
  for (const L of G.lights) {
    const x = (L.x - camX) * z, y = (L.y - camY) * z, r = L.r * z;
    if (x < -r || y < -r || x > lightCv.width + r || y > lightCv.height + r) continue;
    const g = lctx.createRadialGradient(x, y, r * 0.08, x, y, r);
    const a = clamp(L.s, 0, 1);
    g.addColorStop(0, 'rgba(255,255,255,' + a + ')');
    g.addColorStop(0.55, 'rgba(255,255,255,' + a * 0.75 + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    lctx.fillStyle = g;
    lctx.beginPath(); lctx.arc(x, y, r, 0, TAU); lctx.fill();
  }
  if (base) {
    const x = (G.player.x - camX) * z, y = (G.player.y - camY) * z;
    const g = lctx.createRadialGradient(x, y, 2, x, y, base * z);
    g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    lctx.fillStyle = g;
    lctx.beginPath(); lctx.arc(x, y, base * z, 0, TAU); lctx.fill();
  }
  ctx.drawImage(lightCv, 0, 0);
  // тёплый оттенок у источников света
  if (G.settings.quality > 0) {
    ctx.globalCompositeOperation = 'lighter';
    for (const L of G.lights) {
      if (L.s < 0.5) continue;
      const x = (L.x - camX) * z, y = (L.y - camY) * z, r = L.r * 0.5 * z;
      if (x < -r || y < -r || x > canvas.width + r || y > canvas.height + r) continue;
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(' + L.col + ',0.10)');
      g.addColorStop(1, 'rgba(' + L.col + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

let menuEmbers = [];
function renderMenuBg() {
  const cw = canvas.width, chh = canvas.height;
  const g = ctx.createLinearGradient(0, 0, 0, chh);
  g.addColorStop(0, '#050a06'); g.addColorStop(1, '#0c140c');
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, chh);
  if (Math.random() < 0.15 && menuEmbers.length < 40) {
    menuEmbers.push({ x: Math.random() * cw, y: chh + 8, vy: -(10 + Math.random() * 25), vx: (Math.random() - 0.5) * 8, s: 1 + Math.random() * 2, a: 0.3 + Math.random() * 0.5 });
  }
  ctx.fillStyle = '#ff9a2e';
  for (let i = menuEmbers.length - 1; i >= 0; i--) {
    const e = menuEmbers[i];
    e.y += e.vy / 60; e.x += e.vx / 60;
    ctx.globalAlpha = e.a * clamp(e.y / chh + 0.3, 0, 1);
    ctx.fillRect(e.x, e.y, e.s * DPR, e.s * DPR);
    if (e.y < -10) menuEmbers.splice(i, 1);
  }
  ctx.globalAlpha = 1;
}

/* ============================ HUD ============================ */
function updateHUD(force) {
  if (G.state === 'menu' || !G.inv) return;
  const p = G.player;
  $('#hp-fill').style.width = (p.hp / p.maxhp * 100) + '%';
  $('#hp-text').textContent = Math.ceil(p.hp) + ' / ' + p.maxhp;
  $('#xp-fill').style.width = (G.xp / (G.level * 100) * 100) + '%';
  $('#level-text').textContent = 'УР ' + G.level + (G.sp > 0 ? '  +' + G.sp : '');
  $('#match-count').textContent = '×' + G.inv.match;
  $('#inv-count').textContent = resCount();
  const mw = $('#match-wrap');
  if (G.match) {
    mw.classList.remove('hidden');
    const k = clamp(G.match.t / G.match.max, 0, 1);
    $('#match-fill').style.width = (k * 100) + '%';
    $('#match-fill').style.background = k < 0.25 ? '#c04020' : 'linear-gradient(90deg,#ff9a2e,#ffd76a)';
    $('#match-label').textContent = { match: 'Спичка', longmatch: 'Восковая', torch: 'Факел', lantern: 'Фонарь', half: 'Огарок' }[G.match.type] + '  ' + Math.ceil(G.match.t) + 'с';
    $('#btn-blow').classList.remove('hidden');
  } else {
    mw.classList.add('hidden');
    $('#btn-blow').classList.add('hidden');
  }
  const act = $('#btn-act');
  if (G.prompt && G.state === 'play') {
    act.classList.remove('hidden');
    $('#act-label').textContent = G.prompt.label;
  } else act.classList.add('hidden');
  $('#objective').textContent = objectiveText();
}
function objectiveText() {
  if (!G.world) return '';
  if (G.mode === 'challenge') {
    if (G.challenge === 0) return 'Испытание «Эконом» — спичек использовано: ' + G.matchUsed + '/3. Дойдите до выхода.';
    if (G.challenge === 1) return 'Испытание «Сквозь тьму» — спички запрещены. Найдите ключ и выход.';
    return 'Испытание «Сборщик» — грибы: ' + (G.chMush || 0) + '/' + G.chMushNeed + ' • Время: ' + Math.ceil(G.chTimer) + 'с';
  }
  if (G.mode === 'endless') return 'Глубина ' + G.depth + ' • Путь: ' + G.distance + ' м • Найдите портал';
  let o = G.world.theme.obj;
  if (G.chapter === 2) o = G.inv.key > 0 ? 'Ключ у вас! Откройте дверь у северного выхода' : G.world.theme.obj;
  if (G.chapter === 4) {
    const on = G.world.objs.filter(l => l.type === 'lever' && l.data.on).length;
    o = 'Механизмы: ' + on + '/2. Откройте древний проход';
  }
  if (G.chapter === 5) o = G.world.theme.obj;
  return o;
}

/* ============================ UI MANAGER ============================ */
const UI = {
  panelTab: 'inv', invSel: null, confirmCb: null,

  init() {
    // иконки кнопок из спрайтов
    $('#btn-strike img').src = SPR.icon.match.toDataURL();
    $('#btn-inv img').src = SPR.icon.matchbox.toDataURL();
    $('#btn-blow img').src = SPR.icon.cloth.toDataURL();
    $('#btn-act img').src = SPR.icon.spark.toDataURL();
    document.documentElement.style.setProperty('--ctrl', G.settings.ctrl);
    $('#screens').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      AudioMan.play('ui');
      this.action(b.dataset.act, b.dataset.arg);
    });
    $('#screens').addEventListener('input', e => {
      const t = e.target;
      if (t.id === 'set-music') { G.settings.music = +t.value; AudioMan.applyVol(); Save.set('settings', G.settings); }
      if (t.id === 'set-sfx') { G.settings.sfx = +t.value; AudioMan.applyVol(); Save.set('settings', G.settings); }
      if (t.id === 'set-quality') { G.settings.quality = +t.value; Save.set('settings', G.settings); resize(); }
      if (t.id === 'set-ctrl') { G.settings.ctrl = +t.value; document.documentElement.style.setProperty('--ctrl', G.settings.ctrl); Save.set('settings', G.settings); }
      if (t.id === 'set-vibrate') { G.settings.vibrate = t.checked; Save.set('settings', G.settings); }
    });
    $('#import-file').addEventListener('change', e => this.importSave(e));
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
    window.addEventListener('beforeunload', () => saveNow());
  },

  escPressed() {
    if (G.state === 'play') this.pause();
    else if (G.state === 'pause') this.resume();
    else if (G.state === 'panel' || G.state === 'note') this.closePanel();
  },

  showJoy(on, x, y) {
    const b = $('#joy-base');
    b.classList.toggle('hidden', !on);
    if (on) { b.style.left = x + 'px'; b.style.top = y + 'px'; this.moveJoy(0, 0); }
  },
  moveJoy(dx, dy) {
    const n = $('#joy-nub');
    n.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
  },

  fadeBlink(cb) {
    const f = $('#fade');
    f.classList.add('on');
    setTimeout(() => { if (cb) cb(); setTimeout(() => f.classList.remove('on'), 120); }, 520);
  },

  toast(text, cls) {
    const wrap = $('#toast-wrap');
    while (wrap.children.length >= 3) wrap.removeChild(wrap.firstChild);
    const t = el('<div class="toast ' + (cls || '') + '">' + text + '</div>');
    wrap.appendChild(t);
    setTimeout(() => t.classList.add('fadeout'), 2400);
    setTimeout(() => t.remove(), 3000);
  },

  showHUD(on) { $('#hud').classList.toggle('hidden', !on); if (on) updateHUD(true); },

  clear() { $('#screens').innerHTML = ''; },

  /* ---------- экраны ---------- */
  show(name) {
    G.state = 'menu';
    this.showHUD(false);
    const s = $('#screens');
    s.innerHTML = '';
    const scr = el('<div class="screen"></div>');
    s.appendChild(scr);
    if (name === 'menu') this.menuScreen(scr);
    else if (name === 'settings') this.settingsScreen(scr, 'menu');
    else if (name === 'ach') this.achScreen(scr);
    else if (name === 'about') this.aboutScreen(scr);
    else if (name === 'chapters') this.chaptersScreen(scr);
    else if (name === 'endless') this.endlessScreen(scr);
    else if (name === 'challenges') this.challengesScreen(scr);
  },

  menuScreen(sc) {
    const hasCamp = !!G._hasCamp, hasEnd = !!G._hasEnd;
    sc.innerHTML =
      '<div class="game-title">ПОСЛЕДНЯЯ СПИЧКА</div>' +
      '<div class="game-sub">THE LAST MATCH</div><div class="flame-divider"></div>' +
      '<div class="menu-col">' +
      '<button class="mbtn primary" data-act="continue" ' + (hasCamp ? '' : 'disabled') + '>Продолжить<small>кампания</small></button>' +
      '<button class="mbtn" data-act="new">Новая игра</button>' +
      '<button class="mbtn" data-act="chapters">Выбор главы</button>' +
      '<button class="mbtn" data-act="endless">Бесконечная ночь<small>рекорд: ' + (G.records.endless || 0) + ' м</small></button>' +
      '<button class="mbtn" data-act="challenges">Испытания</button>' +
      '<button class="mbtn" data-act="ach">Достижения</button>' +
      '<button class="mbtn" data-act="settings">Настройки</button>' +
      '<button class="mbtn" data-act="about">Об игре</button>' +
      '</div>' +
      '<div class="hint">Не позволяй огню погаснуть.<br>И никогда не иди на свет, который не создаёшь сам.</div>';
  },

  settingsScreen(sc, back) {
    sc.innerHTML = '<div class="panel"><h2>НАСТРОЙКИ</h2><div class="body">' +
      '<div class="set-row"><label>Музыка и ветер</label><input id="set-music" type="range" min="0" max="1" step="0.05" value="' + G.settings.music + '"></div>' +
      '<div class="set-row"><label>Звуковые эффекты</label><input id="set-sfx" type="range" min="0" max="1" step="0.05" value="' + G.settings.sfx + '"></div>' +
      '<div class="set-row"><label>Вибрация</label><input id="set-vibrate" type="checkbox" ' + (G.settings.vibrate ? 'checked' : '') + '></div>' +
      '<div class="set-row"><label>Качество эффектов</label><select id="set-quality">' +
      '<option value="0" ' + (G.settings.quality === 0 ? 'selected' : '') + '>Низкое</option>' +
      '<option value="1" ' + (G.settings.quality === 1 ? 'selected' : '') + '>Среднее</option>' +
      '<option value="2" ' + (G.settings.quality === 2 ? 'selected' : '') + '>Высокое</option></select></div>' +
      '<div class="set-row"><label>Размер кнопок</label><select id="set-ctrl">' +
      '<option value="0.85" ' + (G.settings.ctrl === 0.85 ? 'selected' : '') + '>Маленький</option>' +
      '<option value="1" ' + (G.settings.ctrl === 1 ? 'selected' : '') + '>Средний</option>' +
      '<option value="1.2" ' + (G.settings.ctrl === 1.2 ? 'selected' : '') + '>Крупный</option></select></div>' +
      '<div class="set-row"><label>Сохранение</label><span><button class="sbtn ghost" data-act="export">Экспорт</button> ' +
      '<button class="sbtn ghost" data-act="import">Импорт</button></span></div>' +
      '<div class="set-row"><label>Опасная зона</label><button class="sbtn warn" data-act="wipe">Сброс прогресса</button></div>' +
      '</div><div class="menu-col" style="margin-top:12px"><button class="mbtn" data-act="' + (back === 'pause' ? 'backpause' : 'tomenu') + '">Назад</button></div></div>';
  },

  achScreen(sc) {
    let rows = '';
    for (const id in ACH) {
      const got = !!G.ach[id];
      rows += '<div class="ach ' + (got ? 'got' : '') + '"><div class="dot"></div><div><div class="nm">' +
        ACH[id].name + '</div><div class="ds">' + ACH[id].desc + '</div></div></div>';
    }
    const got = Object.keys(G.ach).length;
    sc.innerHTML = '<div class="panel"><h2>ДОСТИЖЕНИЯ — ' + got + '/' + Object.keys(ACH).length + '</h2><div class="body">' +
      rows + '</div><div class="menu-col" style="margin-top:12px"><button class="mbtn" data-act="tomenu">Назад</button></div></div>';
  },

  aboutScreen(sc) {
    sc.innerHTML = '<div class="panel"><h2>ОБ ИГРЕ</h2><div class="body">' +
      '<div class="note-text">Вы очнулись в неизвестном лесу. Вокруг — абсолютная тьма, в кармане — коробок спичек и записка:<br><br>' +
      '<span class="lore-quote">«Не позволяй огню погаснуть. И никогда не иди на свет, который не создаёшь сам».</span></div>' +
      '<div class="stat-grid">' +
      '<span>Жанр</span><b>survival / puzzle</b>' +
      '<span>Глав</span><b>5 + концовки</b>' +
      '<span>Режимов</span><b>3</b>' +
      '<span>Графика</span><b>pixel art</b>' +
      '<span>Платформа</span><b>iOS / Android</b>' +
      '<span>Работает</span><b>offline (PWA)</b>' +
      '</div>' +
      '<div class="hint">Джойстик — движение • Спичка — свет • Потушить — сохранить остаток • Костёр — безопасная зона.<br>' +
      'Тени боятся света. Странники идут по маршруту и чуют добычу рядом. В полной темноте вы начнёте замерзать.</div>' +
      '</div><div class="menu-col" style="margin-top:12px"><button class="mbtn" data-act="tomenu">Назад</button></div></div>';
  },

  chaptersScreen(sc) {
    let rows = '';
    const names = ['Забытый лес', 'Старые шахты', 'Мёртвая деревня', 'Подземелье', 'Последний свет'];
    for (let i = 1; i <= 5; i++) {
      rows += '<button class="mbtn" data-act="chapter" data-arg="' + i + '" ' + (i <= G.unlocked ? '' : 'disabled') + '>Глава ' + i + '<small>' + names[i - 1] + (i <= G.unlocked ? '' : ' — заблокировано') + '</small></button>';
    }
    sc.innerHTML = '<div class="panel"><h2>ВЫБОР ГЛАВЫ</h2><div class="body"><div class="menu-col" style="width:100%">' +
      rows + '</div></div><div class="menu-col" style="margin-top:12px"><button class="mbtn" data-act="tomenu">Назад</button></div></div>';
  },

  endlessScreen(sc) {
    const r = G.records.endless || 0;
    sc.innerHTML = '<div class="panel"><h2>БЕСКОНЕЧНАЯ НОЧЬ</h2><div class="body">' +
      '<div class="note-text">Процедурная тьма без конца. Порталы ведут глубже — врагов больше, награды ценнее. ' +
      'Сколько метров вы пройдёте, прежде чем огонь погаснет?</div>' +
      '<div class="stat-grid"><span>Личный рекорд</span><b>' + r + ' м</b><span>Текущая глубина</span><b>' + (G._hasEnd ? 'есть сохранение' : '—') + '</b></div>' +
      '<div class="menu-col" style="width:100%">' +
      '<button class="mbtn primary" data-act="endless-new">Начать сначала</button>' +
      '<button class="mbtn" data-act="endless-cont" ' + (G._hasEnd ? '' : 'disabled') + '>Продолжить</button>' +
      '</div></div><div class="menu-col" style="margin-top:12px"><button class="mbtn" data-act="tomenu">Назад</button></div></div>';
  },

  challengesScreen(sc) {
    let rows = '';
    CHALLENGES.forEach((c, i) => {
      const best = G.records.ch[i];
      rows += '<button class="mbtn" data-act="challenge" data-arg="' + i + '">' + c.name + '<small>' + c.desc + (best ? ' • пройдено' : '') + '</small></button>';
    });
    sc.innerHTML = '<div class="panel"><h2>ИСПЫТАНИЯ</h2><div class="body"><div class="menu-col" style="width:100%">' +
      rows + '</div></div><div class="menu-col" style="margin-top:12px"><button class="mbtn" data-act="tomenu">Назад</button></div></div>';
  },

  /* --- внутриигровые экраны --- */
  pause() {
    if (G.state !== 'play') return;
    G.state = 'pause'; saveNow();
    const s = $('#screens');
    s.innerHTML = '';
    const scr = el('<div class="screen transparent"></div>');
    s.appendChild(scr);
    scr.innerHTML = '<div class="panel"><h2>ПАУЗА</h2>' +
      '<div class="menu-col" style="width:100%">' +
      '<button class="mbtn primary" data-act="resume">Продолжить</button>' +
      '<button class="mbtn" data-act="save">Сохранить</button>' +
      '<button class="mbtn" data-act="upgrades">Улучшения' + (G.sp > 0 ? ' (+' + G.sp + ')' : '') + '</button>' +
      '<button class="mbtn" data-act="settings-p">Настройки</button>' +
      '<button class="mbtn" data-act="quit">В главное меню</button>' +
      '</div></div>';
  },
  resume() { this.clear(); G.state = 'play'; },

  openPanel(tab) {
    if (G.state !== 'play') return;
    G.state = 'panel';
    this.panelTab = tab || 'inv';
    this.renderPanel();
  },
  closePanel() { this.clear(); G.state = 'play'; updateHUD(true); },
  renderPanel() {
    const s = $('#screens');
    s.innerHTML = '';
    const scr = el('<div class="screen transparent"></div>');
    s.appendChild(scr);
    const tabs = '<div class="tabs">' +
      '<button class="tab ' + (this.panelTab === 'inv' ? 'on' : '') + '" data-act="tab" data-arg="inv">Рюкзак</button>' +
      '<button class="tab ' + (this.panelTab === 'craft' ? 'on' : '') + '" data-act="tab" data-arg="craft">Мастерская</button>' +
      '<button class="tab ' + (this.panelTab === 'notes' ? 'on' : '') + '" data-act="tab" data-arg="notes">Записки (' + G.inv.notes.length + ')</button>' +
      '</div>';
    let body = '';
    if (this.panelTab === 'inv') body = this.invHTML();
    else if (this.panelTab === 'craft') body = this.craftHTML();
    else body = this.notesHTML();
    scr.innerHTML = '<div class="panel"><h2>ИНВЕНТАРЬ</h2>' + tabs + '<div class="body">' + body +
      '</div><div class="menu-col" style="margin-top:10px"><button class="mbtn" data-act="closepanel">Закрыть</button></div></div>';
  },
  invHTML() {
    const order = ['match', 'longmatch', 'half', 'torch', 'lantern', 'matchbox', 'key', 'wood', 'cloth', 'metal', 'resin', 'artifact'];
    let rows = '<div class="hint" style="margin:2px 0 8px">Спички: ' + G.inv.match + '/' + matchCap() + ' • Ресурсы: ' + resCount() + '/' + resCap() + '</div>';
    let any = false;
    for (const id of order) {
      const n = G.inv[id];
      if (!n) continue;
      any = true;
      const it = ITEMS[id];
      const usable = it.usable ? '<button class="sbtn act" data-act="use" data-arg="' + id + '">Использовать</button>' : '';
      rows += '<div class="row"><img class="ic-img" src="' + SPR.icon[id].toDataURL() + '"><div class="info"><div class="name">' +
        it.name + ' <span class="cnt">×' + n + '</span></div><div class="desc">' + it.desc + '</div></div><span class="act">' + usable + '</span></div>';
    }
    if (!any) rows += '<div class="hint">Пусто. Ищите предметы в мире.</div>';
    return rows;
  },
  craftHTML() {
    let rows = '';
    for (const r of RECIPES) {
      const can = Object.keys(r.need).every(k => G.inv[k] >= r.need[k]);
      let need = Object.keys(r.need).map(k => ITEMS[k].name + ' ×' + r.need[k] + ' (' + G.inv[k] + ')').join(', ');
      let outIcon = Object.keys(r.out)[0];
      rows += '<div class="row"><img class="ic-img" src="' + SPR.icon[outIcon].toDataURL() + '"><div class="info"><div class="name">' +
        r.name + '</div><div class="desc">' + r.desc + '<br>Нужно: ' + need + '</div></div><span class="act">' +
        '<button class="sbtn" data-act="craft" data-arg="' + r.id + '" ' + (can ? '' : 'disabled') + '>Создать</button></span></div>';
    }
    return rows || '<div class="hint">Нет рецептов</div>';
  },
  notesHTML() {
    if (!G.inv.notes.length) return '<div class="hint">Записок пока нет. Ищите бумагу в хижинах, шахтах и домах.</div>';
    let rows = '';
    for (const id of G.inv.notes) {
      const n = NOTES.find(x => x.id === id);
      if (!n) continue;
      rows += '<div class="row"><img class="ic-img" src="' + SPR.icon.note.toDataURL() + '"><div class="info"><div class="name">' +
        n.title + '</div></div><span class="act"><button class="sbtn ghost" data-act="readnote" data-arg="' + id + '">Читать</button></span></div>';
    }
    return rows;
  },

  showNote(id) {
    const n = NOTES.find(x => x.id === id);
    if (!n) return;
    G.state = 'note';
    const s = $('#screens');
    s.innerHTML = '';
    const scr = el('<div class="screen transparent"></div>');
    s.appendChild(scr);
    scr.innerHTML = '<div class="panel"><h2>ЗАПИСКА</h2><div class="note-text"><b>' + n.title + '</b><br><br>' + n.text + '</div>' +
      '<div class="menu-col"><button class="mbtn" data-act="closenote">Закрыть</button></div></div>';
  },

  upgrades() {
    G.state = 'panel';
    const s = $('#screens');
    s.innerHTML = '';
    const scr = el('<div class="screen transparent"></div>');
    s.appendChild(scr);
    let rows = '<div class="hint" style="margin-bottom:8px">Очков улучшений: ' + G.sp + '</div>';
    for (const u of UPGRADES) {
      const rank = G.upg[u.id] || 0;
      const maxed = rank >= u.max;
      rows += '<div class="row"><div class="info"><div class="name">' + u.name + ' <span class="cnt">' + rank + '/' + u.max + '</span></div>' +
        '<div class="desc">' + u.desc + '</div></div><span class="act">' +
        (maxed ? '<button class="sbtn" disabled>Макс</button>' : '<button class="sbtn" data-act="upg" data-arg="' + u.id + '" ' + (G.sp > 0 ? '' : 'disabled') + '>Улучшить</button>') + '</span></div>';
    }
    scr.innerHTML = '<div class="panel"><h2>УЛУЧШЕНИЯ</h2><div class="body">' + rows +
      '</div><div class="menu-col" style="margin-top:10px"><button class="mbtn" data-act="backpause">Назад</button></div></div>';
  },

  chapterIntro(ch) {
    G.state = 'panel';
    const t = THEMES[ch - 1];
    const s = $('#screens');
    s.innerHTML = '';
    const scr = el('<div class="screen"></div>');
    s.appendChild(scr);
    scr.innerHTML = '<div class="panel"><h2>' + t.name + '</h2><div class="note-text">' + t.obj + '</div>' +
      '<div class="stat-grid"><span>Здоровье</span><b>' + Math.ceil(G.player.hp) + '/' + G.player.maxhp + '</b>' +
      '<span>Спички</span><b>' + G.inv.match + '/' + matchCap() + '</b>' +
      '<span>Уровень</span><b>' + G.level + '</b></div>' +
      '<div class="menu-col"><button class="mbtn primary" data-act="startplay">Идти вперёд</button></div></div>';
  },
  challengeIntro(i) {
    G.state = 'panel';
    const c = CHALLENGES[i];
    const s = $('#screens');
    s.innerHTML = '';
    const scr = el('<div class="screen"></div>');
    s.appendChild(scr);
    scr.innerHTML = '<div class="panel"><h2>ИСПЫТАНИЕ: ' + c.name.toUpperCase() + '</h2><div class="note-text">' + c.desc + '</div>' +
      '<div class="menu-col"><button class="mbtn primary" data-act="startplay">Начать</button>' +
      '<button class="mbtn" data-act="quit">Отказаться</button></div></div>';
  },

  showGameOver() {
    G.state = 'over';
    saveNow();
    const s = $('#screens');
    s.innerHTML = '';
    const scr = el('<div class="screen"></div>');
    s.appendChild(scr);
    scr.innerHTML = '<div class="panel"><h2 style="color:#c05040">ТЬМА ЗАБРАЛА ВАС</h2>' +
      '<div class="note-text">Но пока в коробке остаётся хоть одна спичка — надежда жива.<br><br>' +
      '<span class="lore-quote">«Пропитал спички смолой — горят вдвое дольше».</span></div>' +
      '<div class="stat-grid"><span>Смертей</span><b>' + G.stats.deaths + '</b><span>Зажжено спичек</span><b>' + G.stats.lit + '</b></div>' +
      '<div class="menu-col">' +
      (G.mode === 'endless'
        ? '<button class="mbtn primary" data-act="endresults">Итоги</button>'
        : '<button class="mbtn primary" data-act="respawn">Очнуться у костра</button>') +
      '<button class="mbtn" data-act="quit">В главное меню</button></div></div>';
  },

  challengeEnd(win, why) {
    G.state = 'over';
    const c = CHALLENGES[G.challenge];
    if (win) {
      gainXP(c.reward);
      if (!G.records.ch[G.challenge]) { G.records.ch[G.challenge] = 1; Save.set('records', G.records); }
      AudioMan.play('exit');
    } else AudioMan.play('gameover');
    const s = $('#screens');
    s.innerHTML = '';
    const scr = el('<div class="screen"></div>');
    s.appendChild(scr);
    scr.innerHTML = '<div class="panel"><h2 style="color:' + (win ? '#ffd76a' : '#c05040') + '">' +
      (win ? 'ИСПЫТАНИЕ ПРОЙДЕНО' : 'ИСПЫТАНИЕ ПРОВАЛЕНО') + '</h2>' +
      '<div class="note-text">' + c.name + '<br>' + (why || (win ? 'Награда: +' + c.reward + ' опыта' : c.desc)) + '</div>' +
      '<div class="menu-col"><button class="mbtn primary" data-act="challenge" data-arg="' + G.challenge + '">Ещё раз</button>' +
      '<button class="mbtn" data-act="quit">К испытаниям</button></div></div>';
  },

  endresults() {
    const d = G.distance;
    if (d > G.records.endless) { G.records.endless = d; Save.set('records', G.records); }
    const s = $('#screens');
    s.innerHTML = '';
    const scr = el('<div class="screen"></div>');
    s.appendChild(scr);
    scr.innerHTML = '<div class="panel"><h2>ИТОГИ НОЧИ</h2>' +
      '<div class="stat-grid"><span>Пройдено</span><b>' + d + ' м</b><span>Глубина</span><b>' + G.depth + '</b>' +
      '<span>Рекорд</span><b>' + G.records.endless + ' м</b><span>Спичек зажжено</span><b>' + G.stats.lit + '</b></div>' +
      (d >= 250 ? '<div class="hint">Достижение «Странник тьмы» — получено при 250 м.</div>' : '') +
      '<div class="menu-col"><button class="mbtn primary" data-act="endless-new">Новая попытка</button>' +
      '<button class="mbtn" data-act="quit">В главное меню</button></div></div>';
  },

  showEnding(kind) {
    G.state = 'ending';
    const light = kind === 'light';
    const s = $('#screens');
    s.innerHTML = '';
    const scr = el('<div class="screen"></div>');
    s.appendChild(scr);
    scr.innerHTML = '<div class="panel"><div class="ending-title ' + kind + '">' +
      (light ? 'СВЕТ НЕ ГАСНЕТ' : 'ТЬМА ПРИНЯЛА') + '</div>' +
      '<div class="note-text">' + (light ?
        'Вы вложили последнюю спичку в алтарь Света. Пламя вспыхнуло нежарко, но уверенно — и пошло по миру, от кольца к кольцу. Тьма отступала не со стоном, а с облегчением: она устала быть тьмой. Лес, шахты, деревня — всё это было чьей-то забытой ночью, и вы вернули ей утро.<br><br><span class="lore-quote">«Не позволяй огню погаснуть». Вы не позволили. Даже одна спичка — это уже победа.</span>' :
        'Вы отдали огонь Тьме, и она погасла сама — ей было нужно не пожрать свет, а услышать, что кто-то наконец остановился и не побежал. Тени сложились у ваших ног, как уставшие собаки. Мир не исчез. Он просто научился дышать в темноте — и вы научились вместе с ним.<br><br><span class="lore-quote">«Никогда не иди на свет, который не создаёшь сам». Вы создали его сами — и сумели отпустить.</span>') +
      '</div><div class="hint">' + (G.endings.length < 2 ? 'Существует вторая концовка. Выбор меняет всё.' : 'Обе концовки открыты. Все тайны мира — ваши.') + '</div>' +
      '<div class="menu-col" style="margin-top:10px"><button class="mbtn primary" data-act="quit">В главное меню</button></div></div>';
  },

  confirm(text, cb) {
    this.confirmCb = cb;
    const s = $('#screens');
    const scr = el('<div class="screen transparent" style="z-index:70"></div>');
    s.appendChild(scr);
    scr.innerHTML = '<div class="panel confirm-box"><h2>ПОДТВЕРДИТЕ</h2><p>' + text + '</p>' +
      '<div class="menu-col"><button class="mbtn danger" data-act="confirm-yes">Да, я уверен</button>' +
      '<button class="mbtn" data-act="confirm-no">Отмена</button></div></div>';
  },

  /* ---------- действия кнопок ---------- */
  action(act, arg) {
    switch (act) {
      case 'tomenu': this.show('menu'); break;
      case 'menu': this.show('menu'); break;
      case 'continue': continueGame(); break;
      case 'new': this.confirm('Начать новую игру? Текущий прогресс кампании будет перезаписан.', () => { this.clear(); newGame(); }); break;
      case 'chapters': this.show('chapters'); break;
      case 'chapter': this.clear(); G.dyn = {}; startChapter(+arg, false); Save.set('campaign', snapshot()); this.chapterIntro(+arg); break;
      case 'endless': this.show('endless'); break;
      case 'endless-new': this.confirm('Начать бесконечную ночь сначала? Старое сохранение режима будет стёрто.', () => { this.clear(); startEndless(true); }); break;
      case 'endless-cont': continueEndless(); break;
      case 'challenges': this.show('challenges'); break;
      case 'challenge': this.clear(); startChallenge(+arg); break;
      case 'ach': this.show('ach'); break;
      case 'settings': this.show('settings'); break;
      case 'about': this.show('about'); break;
      case 'settings-p': { const scr = $('#screens .screen'); this.settingsScreen(scr, 'pause'); break; }
      case 'backpause': this.pause(); break;
      case 'resume': this.resume(); break;
      case 'save': saveNow(); msg('Сохранено', 'good'); break;
      case 'upgrades': this.upgrades(); break;
      case 'upg': {
        if (G.sp > 0 && (G.upg[arg] || 0) < UPGRADES.find(u => u.id === arg).max) {
          G.upg[arg] = (G.upg[arg] || 0) + 1; G.sp--;
          applyUpgrades(); saveNow(); AudioMan.play('craft');
          this.upgrades();
        }
        break;
      }
      case 'quit':
        saveNow();
        this.fadeBlink(() => { G.world = null; G.enemies = []; G.match = null; this.show('menu'); });
        break;
      case 'tab': this.panelTab = arg; this.renderPanel(); break;
      case 'closepanel': this.closePanel(); break;
      case 'closenote': this.clear(); G.state = 'play'; break;
      case 'readnote': this.showNote(arg); break;
      case 'use': this.useItem(arg); break;
      case 'craft': this.craft(arg); break;
      case 'respawn': {
        this.clear();
        const p = G.player;
        p.x = G.world.spawnX; p.y = G.world.spawnY; p.hp = p.maxhp; p.hurtT = 0;
        G.inv.match = Math.max(2, Math.ceil(G.inv.match / 2));
        G.match = null; G.partial = null; G.coldT = 0; G.noHit = true;
        spawnEnemies();
        G.state = 'play'; saveNow();
        msg('Вы очнулись у тропы. Спичек осталось мало...', 'warn');
        break;
      }
      case 'endresults': this.endresults(); break;
      case 'startplay': this.clear(); G.state = 'play'; updateHUD(true); break;
      case 'export': this.exportSave(); break;
      case 'import': $('#import-file').click(); break;
      case 'wipe': this.confirm('Стереть ВЕСЬ прогресс: кампанию, рекорды, достижения? Это необратимо.', () => {
        try {
          ['campaign', 'endless', 'records', 'achievements', 'settings'].forEach(k => { localStorage.removeItem('lm_' + k); if (Save.useIDB && Save.db) try { Save.db.transaction('kv', 'readwrite').objectStore('kv').delete(k); } catch (e) { } });
        } catch (e) { }
        location.reload();
      }); break;
      case 'confirm-yes': { const cb = this.confirmCb; this.confirmCb = null; const ov = document.querySelector('#screens .screen.transparent[style*="z-index:70"], #screens > .screen:last-child'); if (ov && ov.querySelector('.confirm-box')) ov.remove(); if (cb) cb(); break; }
      case 'confirm-no': { const ov = document.querySelector('#screens .screen:last-child'); if (ov && ov.querySelector('.confirm-box')) ov.remove(); this.confirmCb = null; break; }
    }
  },

  useItem(id) {
    if (!ITEMS[id] || !ITEMS[id].usable) return;
    if (id === 'matchbox') { G.inv.matchbox++; G.inv.match += 5; if (G.inv.match > matchCap()) G.inv.match = matchCap(); }
    else if (id === 'half') { G.inv.half--; G.partial = { t: 10 + Math.random() * 6, max: 16, type: 'match' }; }
    else { // longmatch / torch / lantern — поджечь сразу
      if (G.match) { msg('Сначала потушите текущий огонь', 'warn'); return; }
      G.inv[id]--;
      G.match = { t: burnTime(id), max: burnTime(id), type: id };
      G.stats.lit++; AudioMan.play('strike'); award('first_match');
    }
    saveNow(); this.renderPanel(); updateHUD(true);
  },
  craft(rid) {
    const r = RECIPES.find(x => x.id === rid);
    if (!r) return;
    if (!Object.keys(r.need).every(k => G.inv[k] >= r.need[k])) return;
    for (const k in r.need) G.inv[k] -= r.need[k];
    for (const k in r.out) G.inv[k] = (G.inv[k] || 0) + r.out[k];
    G.stats.crafted++; award('craft1');
    AudioMan.play('craft');
    msg('Создано: ' + r.name, 'good');
    saveNow(); this.renderPanel();
  },

  exportSave() {
    Promise.all([Save.get('campaign'), Save.get('endless'), Save.get('records'), Save.get('achievements')]).then(([c, e, r, a]) => {
      const data = { version: 1, exported: Date.now(), campaign: c, endless: e, records: r || G.records, achievements: a || { ach: G.ach, stats: G.stats }, settings: G.settings };
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'last-match-save.json';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      msg('Сохранение экспортировано', 'good');
    });
  },
  importSave(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (d.version !== 1) throw new Error('bad version');
        if (d.campaign) Save.set('campaign', d.campaign);
        if (d.endless) Save.set('endless', d.endless);
        if (d.records) Save.set('records', d.records);
        if (d.achievements) Save.set('achievements', d.achievements);
        if (d.settings) Save.set('settings', d.settings);
        msg('Сохранение импортировано. Перезагрузка...', 'good');
        setTimeout(() => location.reload(), 900);
      } catch (e) { msg('Файл повреждён или не является сохранением', 'warn'); }
    };
    reader.readAsText(file);
    ev.target.value = '';
  },
};

/* ============================ BOOT & GAME LOOP ============================ */
let last = 0, acc = 0;
const STEP = 1 / 60;
function loop(ts) {
  requestAnimationFrame(loop);
  let dt = (ts - last) / 1000; last = ts;
  if (dt > 0.1) dt = 0.1;
  if (G.state === 'play') {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n++ < 4) { update(STEP); acc -= STEP; }
  }
  render(dt);
}

window.addEventListener('load', async () => {
  buildSprites();
  resize();
  const [settings, ach, records, camp, endl] = await Promise.all([
    Save.init().then(() => Promise.all([Save.get('settings'), Save.get('achievements'), Save.get('records'), Save.get('campaign'), Save.get('endless')])).then(a => a)
  ]).then(a => a[0]);
  if (settings) Object.assign(G.settings, settings);
  if (ach) { G.ach = ach.ach || {}; G.stats = ach.stats || G.stats; }
  if (records) G.records = records;
  G._hasCamp = !!(camp && camp.version === 1);
  G._hasEnd = !!(endl && endl.version === 1);
  if (camp && camp.unlocked) G.unlocked = camp.unlocked;
  if (camp && camp.endings) G.endings = camp.endings;
  UI.init();
  Input.init(canvas);
  AudioMan.applyVol();
  UI.show('menu');
  requestAnimationFrame(loop);
  // PWA
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    try { navigator.serviceWorker.register('sw.js'); } catch (e) { }
  }
});
