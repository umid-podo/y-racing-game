'use strict';

// 밸런스 초깃값. planning/02-game-design.md와 03-shared-track-revision.md의 제안값이며 플레이테스트로 조정한다.
const CONFIG = {
  raceLength: 1000, // m
  baseSpeed: 20, // m/s
  boostMul: 1.6,
  boostTime: 2,
  slowMul: 0.6,
  slowTime: 3,
  protectTime: 1,
  warnTime: 1.0, // 공격 예고 후 도착까지
  winShowTime: 3,
  viewMeters: 36, // 주행 화면 너비에 보이는 거리
  accel: 2.4, // 속도 배율 변화율(/초). 부스터·감속이 약 0.25초에 걸쳐 반영된다
  offMin: 0.12, // 전후 오프셋 off가 차지하는 화면 가로 구간
  offMax: 0.55,
  offSpeed: 10, // 전후 이동 속도 (m/s)
  kartSpeed: 0.9, // 좌우 이동 속도 (주행 영역 너비/초)
  catchStep: 25, // 선두와의 거리 이만큼마다(m)
  catchGain: 0.02, // 속도 보정을 더하고
  catchMax: 0.1, // 여기까지만 올린다
  camLag: 0.25, // 기본 속도 초과분 1m/s당 카메라가 뒤처지는 거리 (m)
  boostZoom: 0.08, // 부스터 때 줌아웃 비율
};
const OFF_MAX = (CONFIG.offMax - CONFIG.offMin) * CONFIG.viewMeters;
const LAG_MAX = (CONFIG.boostMul - 1) * CONFIG.baseSpeed * CONFIG.camLag;

const PLAYERS = [
  { name: 'Blue', color: '#2f7be0' },
  { name: 'Red', color: '#e8433a' },
  { name: 'Yellow', color: '#f2b91f' },
  { name: 'Green', color: '#3fae5a' },
  { name: 'Purple', color: '#8e5bd0' },
  { name: 'Orange', color: '#f08a2e' },
];

const INK = '#2b2622';
const PAPER = '#fbf6e9';
const SKY = '#fffdf5';
const ROAD = '#efe8d8';
const FONT = "'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
let W = 0;
let H = 0;

const game = {
  state: 'title', // title | select | ready | countdown | race | paused | win | result
  selected: 2,
  count: 2,
  players: [],
  items: [],
  shots: [],
  fx: [],
  dust: [],
  contacts: new Set(), // 맞닿아 있는 카트 쌍
  wins: [],
  winners: [],
  time: 0,
  countdown: 0,
  goFlash: 0,
  winTimer: 0,
  pointers: new Map(), // pointerId -> { player, kind: 'steer' | 'attack' }
  layout: null,
};
window.game = game;

// ---------- 공통 도우미 ----------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hit = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
// 배경 요소의 모양을 번호마다 다르게 하되 프레임마다 같게 유지한다.
const rnd = (k) => {
  const v = Math.sin(k * 127.1 + 3.7) * 43758.5453;
  return v - Math.floor(v);
};

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function line(x0, y0, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function spiky(x, y, rOut, rIn, n, rot = 0) {
  ctx.beginPath();
  for (let k = 0; k < n * 2; k++) {
    const a = rot + (k * Math.PI) / n;
    const r = k % 2 ? rIn : rOut;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

function text(str, x, y, size, color = INK, align = 'center', outline) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (outline) {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = outline;
    ctx.lineWidth = size * 0.22;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

// ---------- 레이아웃 ----------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  computeLayout();
}

function computeLayout() {
  const n = game.count;
  const barH = clamp(H * 0.08, 32, 48);
  let cols = n === 2 || n === 4 ? 2 : 3;
  let rows = n <= 3 ? 1 : 2;
  if (H > W) [cols, rows] = [rows, cols];
  const cw = W / cols;
  const ch = (H - barH) / rows;
  const m = 4;
  const inner = 5;
  const panels = [];
  for (let k = 0; k < cols * rows; k++) {
    const x = (k % cols) * cw + m;
    const y = barH + Math.floor(k / cols) * ch + m;
    const w = cw - m * 2;
    const h = ch - m * 2;
    const ix = x + inner;
    const iw = w - inner * 2;
    const driveH = (h - inner * 2) * 0.5;
    const btnH = clamp(h * 0.13, 40, 64);
    const padY = y + inner + driveH + btnH + 8;
    panels.push({
      x, y, w, h,
      drive: { x: ix, y: y + inner, w: iw, h: driveH },
      btns: { x: ix, y: y + inner + driveH + 4, w: iw, h: btnH },
      pad: { x: ix, y: padY, w: iw, h: y + h - inner - padY },
    });
  }
  game.layout = { barH, panels, pauseBtn: { x: W - barH - 4, y: 3, w: barH, h: barH - 6 } };
}

// 카트 그림은 바퀴 바닥 중앙이 원점이고 너비 약 116, 높이 약 136 단위다.
// 앞코는 원점에서 NOSE만큼 앞이고, 출발선·결승선은 앞코가 닿는 자리에 그린다.
const NOSE = 56;
function kartScale(d) {
  return Math.min((d.h * 0.44) / 136, (d.w * 0.22) / 116);
}

// 패널 i의 주행 화면 기하. 같은 경기의 패널은 크기가 같으므로 판정에는 패널 0을 쓴다.
// y0~y1은 lat 0~1에 대응하는 카트 원점의 세로 범위다. 위는 머리 위 번호 표식, 아래는 전경만큼 비운다.
function view(i = 0) {
  const d = game.layout.panels[i].drive;
  const s = kartScale(d);
  const y0 = d.y + 166 * s;
  const y1 = d.y + d.h - 16 * s;
  return { d, s, y0, y1, rh: y1 - y0, ppm: d.w / CONFIG.viewMeters, anchor: d.x + d.w * CONFIG.offMin };
}

// 보는 사람(viewer)의 화면에서 대상(target) 카트의 위치. 카메라는 viewer의 base를 따라간다.
function kartPx(viewer, target) {
  const v = view(viewer.i);
  return { ...v, x: v.anchor + (target.wx - viewer.base + viewer.lag) * v.ppm, y: v.y0 + target.lat * v.rh };
}

function padInner(pad) {
  const m = Math.min(pad.w, pad.h) * 0.15;
  return { x: pad.x + m, y: pad.y + m, w: pad.w - m * 2, h: pad.h - m * 2 };
}

function attackButtons(pan, i) {
  const b = pan.btns;
  const n = game.count - 1;
  const iconW = b.h * 1.1;
  const gap = 6;
  const w = (b.w - iconW) / n - gap;
  const out = [];
  for (let t = 0; t < game.count; t++) {
    if (t === i) continue;
    out.push({ target: t, x: b.x + iconW + gap + out.length * (w + gap), y: b.y, w, h: b.h });
  }
  return out;
}

// ---------- 경기 상태 ----------

function newRace() {
  game.players = Array.from({ length: game.count }, (_, i) => {
    const lat = (i + 0.5) / game.count;
    return {
      i, base: 0, off: 0, lat, tOff: 0, tLat: lat,
      // 트랙 위의 실제 위치. 순위·결승·아이템·공격 판정은 모두 이 값을 쓴다.
      get wx() { return this.base + this.off; },
      mul: 0, lag: 0, spin: 0, dustT: 0, row: -2, // row: 마지막으로 아이템을 얻은 줄
      boost: 0, slow: 0, protect: 0, hitFx: 0, attack: false, touch: null,
    };
  });
  game.items = makeItems(game.count);
  game.shots = [];
  game.fx = [];
  game.dust = [];
  game.contacts.clear();
  game.winners = [];
  game.pointers.clear();
  computeLayout();
}

// 아이템은 월드에 하나씩만 있고 먼저 닿은 카트가 가져간다.
// 선두가 독차지하지 않도록 한 지점에 가로로 나란한 줄을 놓는다.
function makeItems(n) {
  const items = [];
  const cells = n <= 3 ? 2 : 3;
  let wx = 105 + Math.random() * 20;
  for (let row = 0; wx <= CONFIG.raceLength - 100; row++) {
    // 줄마다 부스터와 공격이 적어도 하나씩 섞인다.
    const types = ['boost', 'attack'];
    while (types.length < cells) types.push(Math.random() < 0.5 ? 'boost' : 'attack');
    types.sort(() => Math.random() - 0.5);
    types.forEach((type, c) => {
      items.push({ wx, lat: (c + 0.5 + (Math.random() - 0.5) * 0.4) / cells, type, row, takenBy: null });
    });
    wx += 45 + Math.random() * 30;
  }
  return items;
}

function startCountdown() {
  game.state = 'countdown';
  game.countdown = 3;
  show(null);
}

function releaseInput() {
  game.pointers.clear();
  for (const p of game.players) p.touch = null;
}

function pause() {
  if (game.state !== 'race' && game.state !== 'countdown') return;
  game.state = 'paused';
  releaseInput();
  show('pause');
}

function rankOf(p) {
  return 1 + game.players.filter((q) => q.wx > p.wx).length;
}

function update(dt) {
  game.time += dt;
  if (game.state === 'countdown') {
    // 카운트다운 중에는 좌우로만 움직인다. 전후 목표는 출발 뒤에 반영된다.
    moveKarts(dt, false);
    game.countdown -= dt;
    if (game.countdown <= 0) {
      game.state = 'race';
      game.goFlash = 0.7;
      launch();
    }
  } else if (game.state === 'race') {
    updateRace(dt);
  } else if (game.state === 'win') {
    game.winTimer -= dt;
    if (game.winTimer <= 0) showResult();
  }
}

// 출발 연출: 멈춘 상태에서 짧게 가속하고 바퀴 연기를 남긴다.
function launch() {
  const v = view();
  for (const p of game.players) {
    p.mul = 0;
    for (let k = 0; k < 5; k++) {
      game.dust.push({ wx: p.wx - ((30 + k * 14) * v.s) / v.ppm, lat: p.lat, t: 0, life: 0.7 + k * 0.06, size: 1.8 });
    }
  }
}

// 전후(off)와 좌우(lat)를 따로 움직인다. 전후는 터치만으로 순간 가속하지 못하게 더 느리다.
function moveKarts(dt, fwd) {
  const v = view();
  const offStep = CONFIG.offSpeed * dt;
  const latStep = ((CONFIG.kartSpeed * v.d.w) / v.rh) * dt;
  for (const p of game.players) {
    if (fwd) p.off += clamp(p.tOff - p.off, -offStep, offStep);
    p.lat += clamp(p.tLat - p.lat, -latStep, latStep);
  }
  bumpKarts(v);
}

// 카트끼리 부딪히면 좌우로 밀려난다. 전진은 막지 않으므로 길막기로 순위가 굳지 않는다.
// 접촉 범위는 타원이라서 뒤에서 다가오면 서서히 옆으로 비켜난다.
function bumpKarts(v) {
  const lenX = (104 * v.s) / v.ppm;
  const lenLat = (18 * v.s) / v.rh;
  const ps = game.players;
  for (let a = 0; a < ps.length; a++) {
    for (let b = a + 1; b < ps.length; b++) {
      const A = ps[a];
      const B = ps[b];
      const key = a * 8 + b;
      const nx = (A.wx - B.wx) / lenX;
      const need = Math.abs(nx) < 1 ? lenLat * Math.sqrt(1 - nx * nx) : 0;
      const dl = A.lat - B.lat;
      if (Math.abs(dl) > need * 1.2 + 0.01) game.contacts.delete(key);
      const gap = need - Math.abs(dl);
      if (gap <= 0) continue;
      if (!game.contacts.has(key)) {
        game.contacts.add(key);
        game.fx.push({ kind: 'bump', to: a, u: (A.wx + B.wx) / 2 - A.base, lat: (A.lat + B.lat) / 2, t: 0 });
      }
      // 반씩 밀려나고, 도로 가장자리에 막힌 만큼은 상대가 더 밀려난다.
      const dir = dl >= 0 ? 1 : -1;
      const la = A.lat + (dir * gap) / 2;
      const lb = B.lat - (dir * gap) / 2;
      const ca = clamp(la, 0, 1);
      const cb = clamp(lb, 0, 1);
      A.lat = clamp(ca - (lb - cb), 0, 1);
      B.lat = clamp(cb - (la - ca), 0, 1);
    }
  }
}

function updateRace(dt) {
  game.goFlash = Math.max(0, game.goFlash - dt);
  moveKarts(dt, true);

  const v = view();
  const lead = Math.max(...game.players.map((p) => p.wx));
  for (const p of game.players) {
    // 따라잡기 보정: 선두와 멀수록 조금 빨라진다.
    const catchUp = Math.min(CONFIG.catchMax, Math.floor((lead - p.wx) / CONFIG.catchStep) * CONFIG.catchGain);
    const target = (p.boost > 0 ? CONFIG.boostMul : 1) * (p.slow > 0 ? CONFIG.slowMul : 1) * (1 + catchUp);
    p.mul += clamp(target - p.mul, -CONFIG.accel * dt, CONFIG.accel * dt);
    p.base += CONFIG.baseSpeed * p.mul * dt;
    // 빨라지면 카메라가 늦게 따라와 카트가 화면 앞쪽으로 튀어나간다.
    p.lag += (Math.max(0, p.mul - 1) * CONFIG.baseSpeed * CONFIG.camLag - p.lag) * Math.min(1, dt * 4);
    p.spin += p.mul * 22 * dt;
    p.boost = Math.max(0, p.boost - dt);
    p.slow = Math.max(0, p.slow - dt);
    p.protect = Math.max(0, p.protect - dt);
    p.hitFx = Math.max(0, p.hitFx - dt);

    p.dustT -= p.mul * dt;
    if (p.dustT <= 0) {
      p.dustT = 0.06;
      game.dust.push({ wx: p.wx - (44 * v.s) / v.ppm, lat: p.lat, t: 0, life: 0.45, size: 1 });
    }
  }
  takeItems(v);

  for (const s of game.shots) s.t += dt;
  for (const s of game.shots.filter((s) => s.t >= CONFIG.warnTime)) resolveShot(s);
  game.shots = game.shots.filter((s) => s.t < CONFIG.warnTime);

  for (const f of game.fx) f.t += dt;
  game.fx = game.fx.filter((f) => f.t < 0.5);
  for (const m of game.dust) m.t += dt;
  game.dust = game.dust.filter((m) => m.t < m.life);

  const winners = game.players.filter((p) => p.wx >= CONFIG.raceLength);
  if (winners.length) finish(winners);
}

// 앞선 카트들이 매 줄을 쓸어가면 뒤쪽은 빈 줄만 만난다. 그래서 아이템을 얻은 카트는
// 그 줄의 다른 칸과 바로 다음 줄을 얻지 못한다. 공격을 이미 가진 카트는 공격 칸을 소비하지 않고 지나간다.
function canTake(p, item) {
  return item.row > p.row + 1 && !(item.type === 'attack' && p.attack);
}

// 같은 프레임에 여러 카트가 닿으면 칸 중심에 가까운 카트, 그래도 같으면 앞선 카트가 가져간다.
function takeItems(v) {
  const pickX = (74 * v.s) / v.ppm;
  const pickLat = (24 * v.s) / v.rh;
  for (const item of game.items) {
    if (item.takenBy !== null) continue;
    let best = null;
    let bestD = Infinity;
    for (const p of game.players) {
      if (!canTake(p, item)) continue;
      const dx = Math.abs(item.wx - p.wx) / pickX;
      const dy = Math.abs(item.lat - p.lat) / pickLat;
      if (dx > 1 || dy > 1) continue;
      const dist = Math.hypot(dx, dy);
      if (dist < bestD || (dist === bestD && p.wx > best.wx)) {
        best = p;
        bestD = dist;
      }
    }
    if (!best) continue;
    item.takenBy = best.i;
    best.row = item.row;
    if (item.type === 'boost') best.boost = CONFIG.boostTime;
    else best.attack = true;
    game.fx.push({ kind: 'pick', wx: item.wx, lat: item.lat, by: best.i, t: 0 });
  }
}

// 비추적 공격. 대상이 계속 전진하므로 예상 위치는 대상의 base에 상대적인 값(off, lat)으로 기록한다.
function fire(p, target) {
  if (!p.attack) return;
  p.attack = false;
  const t = game.players[target];
  game.shots.push({ from: p.i, to: target, u: t.off, v: t.lat, t: 0 });
}

// 투사체의 출발점. 공격자가 대상 화면 밖이면 공격자가 있는 쪽 가장자리에서 들어온다.
function shotStart(s) {
  const from = game.players[s.from];
  const base = game.players[s.to].base;
  const lo = base - CONFIG.viewMeters * CONFIG.offMin - 3;
  const hi = base + CONFIG.viewMeters * (1 - CONFIG.offMin) + 3;
  return { wx: clamp(from.wx, lo, hi), lat: from.lat };
}

function resolveShot(s) {
  const p = game.players[s.to];
  const v = view();
  const onTarget = Math.abs(s.u - p.off) < (60 * v.s) / v.ppm && Math.abs(s.v - p.lat) < (26 * v.s) / v.rh;
  const hitNow = onTarget && p.protect <= 0;
  if (hitNow) {
    p.slow = CONFIG.slowTime;
    p.protect = CONFIG.protectTime;
    p.hitFx = 0.6;
  }
  game.fx.push({ kind: hitNow ? 'hit' : 'miss', to: s.to, u: s.u, lat: s.v, t: 0 });
}

function finish(winners) {
  game.state = 'win';
  game.winTimer = CONFIG.winShowTime;
  game.winners = winners.map((p) => p.i);
  for (const p of winners) game.wins[p.i]++;
  game.shots = [];
  releaseInput();
}

// ---------- 화면 전환 ----------

const SCREENS = ['title', 'select', 'ready', 'pause', 'result', 'confirm'];
let confirmBack = null;

function show(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
}

function tap(id, fn) {
  $(id).addEventListener('pointerdown', (e) => {
    e.preventDefault();
    fn();
  });
}

function updateSelect() {
  for (const b of $('counts').children) b.classList.toggle('on', Number(b.dataset.n) === game.selected);
  const small = Math.min(window.innerWidth, window.innerHeight) < 500;
  $('phoneNote').classList.toggle('hidden', !(small && game.selected >= 3));
}

function showResult() {
  game.state = 'result';
  const names = game.winners.map((i) => PLAYERS[i].name);
  $('resultTitle').textContent = names.join(' · ') + (names.length > 1 ? ' 공동 Win!' : ' Win!');
  $('resultTitle').style.color = PLAYERS[game.winners[0]].color;
  const sorted = [...game.players].sort((a, b) => b.wx - a.wx);
  $('resultList').innerHTML = sorted
    .map((p) => {
      const P = PLAYERS[p.i];
      const rec = p.wx >= CONFIG.raceLength ? '완주' : `미완주 · ${Math.floor(p.wx)}m`;
      return `<li><span>${rankOf(p)}위</span><span class="badge" style="background:${P.color}">${p.i + 1}</span>` +
        `<span>${P.name}</span><span class="rec">${rec}</span><span class="wins">${game.wins[p.i]} Win</span></li>`;
    })
    .join('');
  show('result');
}

function askTitle(from) {
  confirmBack = from;
  show('confirm');
}

tap('btnStart', () => {
  if (game.state !== 'title') return;
  game.state = 'select';
  updateSelect();
  show('select');
});

for (const b of $('counts').children) {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    game.selected = Number(b.dataset.n);
    updateSelect();
  });
}

tap('btnSelect', () => {
  if (game.state !== 'select') return;
  game.count = game.selected;
  game.wins = Array(game.count).fill(0);
  newRace();
  game.state = 'ready';
  show('ready');
});

tap('btnGo', () => {
  if (game.state === 'ready') startCountdown();
});

// 복귀 시에는 항상 전체 재개 카운트다운을 거친다.
tap('btnResume', () => {
  if (game.state === 'paused') startCountdown();
});

// 여러 명이 동시에 눌러도 상태 확인으로 한 번만 처리된다.
tap('btnAgain', () => {
  if (game.state !== 'result') return;
  newRace();
  startCountdown();
});

tap('btnPauseTitle', () => askTitle('pause'));
tap('btnResultTitle', () => askTitle('result'));
tap('btnConfirmNo', () => show(confirmBack));
tap('btnConfirmYes', () => {
  game.state = 'title';
  game.wins = [];
  releaseInput();
  show('title');
});

// ---------- 입력 ----------

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function steer(p, pad, x, y) {
  const inr = padInner(pad);
  p.tOff = clamp((x - inr.x) / inr.w, 0, 1) * OFF_MAX;
  p.tLat = clamp((y - inr.y) / inr.h, 0, 1);
  p.touch = { u: clamp((x - pad.x) / pad.w, 0, 1), v: clamp((y - pad.y) / pad.h, 0, 1) };
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (game.state !== 'race' && game.state !== 'countdown') return;
  const { x, y } = pointerPos(e);
  if (hit(game.layout.pauseBtn, x, y)) return pause();

  // 터치는 처음 닿은 패널에 귀속되고, 조향인지 공격인지도 이때 정해진다.
  const pi = game.layout.panels.findIndex((pan, i) => i < game.count && hit(pan, x, y));
  if (pi < 0) return;
  const pan = game.layout.panels[pi];
  const p = game.players[pi];
  const btn = attackButtons(pan, pi).find((b) => hit(b, x, y));
  if (btn) {
    if (game.state === 'race') fire(p, btn.target);
    game.pointers.set(e.pointerId, { player: pi, kind: 'attack' });
  } else if (hit(pan.pad, x, y)) {
    for (const [id, ptr] of game.pointers) {
      if (ptr.player === pi && ptr.kind === 'steer') game.pointers.delete(id);
    }
    game.pointers.set(e.pointerId, { player: pi, kind: 'steer' });
    steer(p, pan.pad, x, y);
  }
});

canvas.addEventListener('pointermove', (e) => {
  const ptr = game.pointers.get(e.pointerId);
  if (!ptr || ptr.kind !== 'steer') return;
  const { x, y } = pointerPos(e);
  steer(game.players[ptr.player], game.layout.panels[ptr.player].pad, x, y);
});

function pointerEnd(e) {
  const ptr = game.pointers.get(e.pointerId);
  if (!ptr) return;
  game.pointers.delete(e.pointerId);
  // 손을 떼도 마지막 목표 위치와 자동 전진은 유지한다.
  if (ptr.kind === 'steer') game.players[ptr.player].touch = null;
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
for (const type of ['touchmove', 'gesturestart', 'contextmenu', 'dblclick']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}
window.addEventListener('resize', resize);

// ---------- 그리기: 캐릭터 ----------

function wheel(x, y, r, spin) {
  ctx.fillStyle = '#2f2f2f';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#bdbdbd';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.lineWidth = 1.5;
  line(x, y, x + Math.cos(spin) * r * 0.4, y + Math.sin(spin) * r * 0.4);
  ctx.restore();
}

function hand(x, y, r) {
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// pose: 'drive' | 'win' | 'lose'. 원점은 바퀴 바닥 중앙, 오른쪽을 향한다.
// o.mul은 속도 배율이며 속도선·기울기에 쓰인다. o.tag는 머리 위 번호, o.me는 자기 카트 표식(▼)이다.
function drawKart(x, y, s, color, pose, o = {}) {
  const t = game.time;
  const moving = pose === 'drive';
  const mul = o.mul ?? 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // 부스터 때 앞으로 기울고 감속 때 뒤로 처진다.
  if (moving) ctx.rotate(clamp((mul - 1) * 0.12, -0.06, 0.08));
  if (o.wobble) ctx.rotate(Math.sin(t * 30) * 0.14 * o.wobble);
  if (o.blink) ctx.globalAlpha = 0.65 + 0.35 * Math.sin(t * 40);
  ctx.lineWidth = 3;
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.strokeStyle = INK;

  ctx.fillStyle = 'rgba(43,38,34,.12)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 58, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  if (moving) {
    ctx.save();
    ctx.globalAlpha *= 0.35;
    ctx.lineWidth = 2.5;
    // 속도선의 개수와 길이는 속도 배율에 비례한다.
    for (let k = 0; k < Math.round(3 * mul); k++) {
      const off = ((t * 140 * mul + k * 17) % 30) - 15;
      const ly = -16 - (k % 3) * 13 - (k > 2 ? 6 : 0);
      line(-66 - off - k * 4, ly, -66 - off - k * 4 - 22 * mul, ly);
    }
    ctx.restore();
  }
  if (o.boost) {
    const f = Math.sin(t * 45) * 7;
    ctx.fillStyle = '#f6a21e';
    ctx.beginPath();
    ctx.moveTo(-50, -38);
    ctx.lineTo(-92 - f, -27);
    ctx.lineTo(-50, -15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.moveTo(-50, -33);
    ctx.lineTo(-74 - f * 0.6, -27);
    ctx.lineTo(-50, -20);
    ctx.closePath();
    ctx.fill();
  }

  const spin = moving ? o.spin ?? t * 16 : 0;
  wheel(-20, -17, 11, spin);
  wheel(42, -17, 11, spin);

  ctx.translate(0, moving ? Math.sin(t * 20) * 1.2 : 0);
  const bounce = pose === 'win' ? Math.abs(Math.sin(t * 7)) * 5 : 0;
  const hx = pose === 'lose' ? 2 : -8;
  const hy = pose === 'lose' ? -92 : -100 - bounce;

  // 몸통
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-27, -40);
  ctx.quadraticCurveTo(-24, -72, hx - 7, hy + 24);
  ctx.lineTo(hx + 8, hy + 24);
  ctx.quadraticCurveTo(10, -66, 9, -40);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 운전대
  ctx.save();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 4;
  line(31, -42, 27, -56);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(25, -60, 5, 13, 0.35, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 카트 몸체
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-54, -18);
  ctx.lineTo(-46, -44);
  ctx.lineTo(28, -42);
  ctx.lineTo(56, -24);
  ctx.lineTo(54, -13);
  ctx.lineTo(-52, -12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.45)';
  line(-40, -37, 24, -35);
  ctx.restore();

  wheel(-30, -13, 13, spin);
  wheel(32, -13, 13, spin);

  // 머리
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.arc(hx, hy, 27, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 얼굴: ∧ ∧ 눈과 ω 입
  const fx = hx + 5;
  ctx.lineWidth = 2.5;
  for (const ex of [fx - 8, fx + 10]) {
    ctx.beginPath();
    ctx.moveTo(ex - 5, hy + 1);
    ctx.lineTo(ex, hy - 9);
    ctx.lineTo(ex + 5, hy + 1);
    ctx.stroke();
  }
  if (pose === 'lose') {
    ctx.beginPath();
    ctx.moveTo(fx - 4, hy + 13);
    ctx.quadraticCurveTo(fx - 1, hy + 8, fx + 2, hy + 12);
    ctx.quadraticCurveTo(fx + 5, hy + 15, fx + 8, hy + 11);
    ctx.stroke();
    ctx.fillStyle = '#4aa3f0';
    for (const [tx, ty] of [[fx - 9, hy + 8], [fx + 12, hy + 9]]) {
      ctx.beginPath();
      ctx.ellipse(tx, ty + Math.abs(Math.sin(t * 3)) * 3, 2.6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    for (const mx of [fx - 3.5, fx + 5.5]) {
      ctx.beginPath();
      ctx.arc(mx, hy + 8, 4.5, 0, Math.PI);
      ctx.stroke();
    }
  }

  // 팔과 손
  ctx.lineWidth = 3;
  if (pose === 'win') {
    const hb = -bounce;
    for (const [sx, ex] of [[-20, -46], [4, 32]]) {
      ctx.beginPath();
      ctx.moveTo(sx, -70);
      ctx.quadraticCurveTo((sx + ex) / 2 + (ex < 0 ? -8 : 8), -92, ex, -116 + hb);
      ctx.stroke();
      hand(ex, -122 + hb, 9);
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(-8, -68);
    ctx.quadraticCurveTo(4, -50, 20, -58);
    ctx.stroke();
    hand(33, -57, 7);
    hand(22, -61, 8);
  }

  if (o.tag) {
    let ty = hy - 38;
    if (o.me) {
      ty = hy - 51 - Math.abs(Math.sin(t * 5)) * 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(hx - 8, ty + 11);
      ctx.lineTo(hx + 8, ty + 11);
      ctx.lineTo(hx, ty + 21);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(hx, ty, o.me ? 11 : 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    text(String(o.tag), hx, ty + 1, o.me ? 16 : 13, '#fff', 'center', INK);
    ctx.strokeStyle = INK;
  }

  if (o.slow) {
    ctx.fillStyle = '#ffd84a';
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      const a = t * 5 + (k * Math.PI * 2) / 3;
      spiky(hx + Math.cos(a) * 24, hy - 30 + Math.sin(a) * 6, 7, 3, 5, a);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------- 그리기: 코스 ----------

function drawSign(x, roadTop, s, label, fill = SKY) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, 2.5 * s);
  line(x, roadTop, x, roadTop - 22 * s);
  rr(x - 32 * s, roadTop - 50 * s, 64 * s, 28 * s, 5 * s);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
  text(label, x, roadTop - 35 * s, 17 * s);
}

// 시차 배율로 흐르는 층에 gap 간격으로 놓인 요소를 그린다. 줌아웃 때 드러나는 가장자리까지 덮는다.
function eachTile(d, scroll, gap, fn) {
  const m = gap + d.w * 0.1;
  for (let k = Math.floor((scroll - m) / gap); k * gap - scroll < d.w + m; k++) fn(d.x + k * gap - scroll, k);
}

// 하늘(구름 ×0.1, 언덕·나무 ×0.5)과 도로(×1). cam은 카메라의 트랙 위 위치(m)다.
function drawRoad(d, s, roadTop, ppm, cam) {
  const x0 = d.x - d.w * 0.1;
  const x1 = d.x + d.w * 1.1;
  const bottom = d.y + d.h;
  const px = cam * ppm;
  ctx.fillStyle = SKY;
  ctx.fillRect(x0, d.y - d.h * 0.1, x1 - x0, d.h * 1.1);

  ctx.strokeStyle = 'rgba(43,38,34,.3)';
  ctx.lineWidth = Math.max(1, 2 * s);
  eachTile(d, px * 0.1, 210 * s, (cx, k) => {
    const cy = d.y + (20 + rnd(k) * 34) * s;
    ctx.beginPath();
    ctx.arc(cx - 14 * s, cy, 10 * s, Math.PI * 0.9, Math.PI * 1.9);
    ctx.arc(cx, cy - 6 * s, 13 * s, Math.PI * 1.1, Math.PI * 1.95);
    ctx.arc(cx + 16 * s, cy, 10 * s, Math.PI * 1.2, Math.PI * 0.1);
    ctx.closePath();
    ctx.stroke();
  });

  ctx.strokeStyle = 'rgba(43,38,34,.45)';
  ctx.fillStyle = '#e9f0d8';
  eachTile(d, px * 0.5, 240 * s, (x, k) => {
    ctx.beginPath();
    ctx.ellipse(x, roadTop, (120 + rnd(k) * 70) * s, (24 + rnd(k + 0.5) * 22) * s, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.fillStyle = '#d3e6b8';
  eachTile(d, px * 0.5, 150 * s, (x, k) => {
    if (rnd(k * 1.7) < 0.35) return;
    const h = (24 + rnd(k * 2.3) * 14) * s;
    line(x, roadTop, x, roadTop - h);
    ctx.beginPath();
    ctx.arc(x, roadTop - h - 10 * s, 14 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  ctx.fillStyle = ROAD;
  ctx.fillRect(x0, roadTop, x1 - x0, bottom - roadTop);

  // 연석: 빨강·흰색 줄무늬가 속도를 가장 잘 보여준다.
  const curb = 9 * s;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x0, roadTop, x1 - x0, curb);
  ctx.fillStyle = '#e8433a';
  eachTile(d, px, 4 * ppm, (x) => ctx.fillRect(x, roadTop, 2 * ppm, curb));
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, 2.5 * s);
  line(x0, roadTop, x1, roadTop);
  line(x0, roadTop + curb, x1, roadTop + curb);

  ctx.strokeStyle = 'rgba(43,38,34,.5)';
  ctx.lineWidth = Math.max(1.5, 3 * s);
  ctx.setLineDash([2 * ppm, 2 * ppm]);
  ctx.lineDashOffset = (px - d.w * 0.1) % (4 * ppm);
  for (let k = 1; k <= 2; k++) {
    const y = roadTop + curb + ((bottom - roadTop - curb) * k) / 3;
    line(x0, y, x1, y);
  }
  ctx.setLineDash([]);
}

// 화면 맨 아래를 스치는 전경(×1.6): 울타리와 풀
function drawForeground(d, s, ppm, cam) {
  const bottom = d.y + d.h;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, 2.5 * s);
  line(d.x - d.w * 0.1, bottom - 7 * s, d.x + d.w * 1.1, bottom - 7 * s);
  eachTile(d, cam * ppm * 1.6, 150 * s, (x) => {
    ctx.fillStyle = '#e6d5ac';
    ctx.fillRect(x - 4 * s, bottom - 15 * s, 8 * s, 17 * s);
    ctx.strokeRect(x - 4 * s, bottom - 15 * s, 8 * s, 17 * s);
    ctx.strokeStyle = '#5e9c43';
    const gx = x + 75 * s;
    for (const a of [-6, 0, 6]) line(gx, bottom, gx + a * s, bottom - (a ? 10 : 14) * s);
    ctx.strokeStyle = INK;
  });
}

function drawItem(type, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s * 0.55); // 바닥에 놓인 칸처럼 납작하게
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  rr(-26, -26, 52, 52, 8);
  ctx.fillStyle = type === 'boost' ? '#ffe9a3' : '#ffc9c2';
  ctx.fill();
  ctx.stroke();
  if (type === 'boost') {
    ctx.strokeStyle = '#e8801a';
    ctx.lineWidth = 5;
    for (const ax of [-14, -2, 10]) {
      ctx.beginPath();
      ctx.moveTo(ax, -14);
      ctx.lineTo(ax + 10, 0);
      ctx.lineTo(ax, 14);
      ctx.stroke();
    }
  } else {
    spiky(0, 0, 20, 10, 8, game.time * 2);
    ctx.fillStyle = '#e8433a';
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawProjectile(x, y, s, color) {
  ctx.lineWidth = Math.max(1.5, 2.5 * s);
  ctx.strokeStyle = INK;
  ctx.fillStyle = color;
  spiky(x, y, 15 * s, 8 * s, 8, game.time * 12);
  ctx.fill();
  ctx.stroke();
}

// 패널은 자기 카트(me)를 따라가는 카메라이고, 시야 안의 월드를 모두 그린다.
function drawDrive(d, me) {
  const P = PLAYERS[me.i];
  const v = view(me.i);
  const { s, ppm, rh } = v;
  const cam = me.base - me.lag;
  const bottom = d.y + d.h;
  const roadTop = v.y0 - 40 * s;
  const xOf = (m) => v.anchor + (m - cam) * ppm;
  const yOf = (lat) => v.y0 + lat * rh;
  // 부스터 때 도로 아래쪽을 기준으로 살짝 줌아웃한다. zx는 줌이 적용된 화면 x다.
  const rush = clamp(me.lag / LAG_MAX, 0, 1);
  const z = 1 - CONFIG.boostZoom * rush;
  const pivotX = d.x + d.w * 0.35;
  const zx = (x) => pivotX + (x - pivotX) * z;
  const onScreen = (x) => zx(x) > d.x - 80 * s && zx(x) < d.x + d.w + 80 * s;
  const ended = game.state === 'win' || game.state === 'result';
  const fs = clamp(d.h * 0.09, 12, 24);

  ctx.save();
  ctx.beginPath();
  ctx.rect(d.x, d.y, d.w, d.h);
  ctx.clip();
  ctx.lineJoin = ctx.lineCap = 'round';

  ctx.save();
  ctx.translate(pivotX, bottom);
  ctx.scale(z, z);
  ctx.translate(-pivotX, -bottom);

  drawRoad(d, s, roadTop, ppm, cam);

  // 출발선, 거리 표지판, 결승선. 선은 카트 앞코가 닿는 자리에 있다.
  const sx = xOf(0) + NOSE * s;
  if (onScreen(sx)) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3 * s;
    line(sx, roadTop, sx, bottom);
  }
  for (let m = 100; m < CONFIG.raceLength; m += 100) {
    if (onScreen(xOf(m))) drawSign(xOf(m), roadTop, s, `${m}m`);
  }
  const gx = xOf(CONFIG.raceLength) + NOSE * s;
  if (onScreen(gx)) {
    const q = 9 * s;
    for (let row = 0; roadTop + row * q < bottom; row++) {
      for (let col = 0; col < 2; col++) {
        ctx.fillStyle = (row + col) % 2 ? INK : '#fff';
        ctx.fillRect(gx + col * q, roadTop + row * q, q, q);
      }
    }
    drawSign(gx + q, roadTop, s, 'GOAL', '#ffe27a');
  }

  for (const item of game.items) {
    if (item.takenBy !== null) continue;
    const ix = xOf(item.wx);
    if (!onScreen(ix)) continue;
    // 내가 얻을 수 없는 칸은 흐리게 보인다.
    ctx.globalAlpha = canTake(me, item) ? 1 : 0.3;
    drawItem(item.type, ix, yOf(item.lat), s);
    ctx.globalAlpha = 1;
  }

  // 조향 목표 위치
  if (me.touch) {
    ctx.strokeStyle = P.color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.ellipse(xOf(me.base + me.tOff), yOf(me.tLat), 30 * s, 9 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 날아가는 공격의 충돌 예상 위치. 누구를 노린 것이든 시야에 들어오면 보인다.
  for (const sh of game.shots) {
    const ix = xOf(game.players[sh.to].base + sh.u);
    if (!onScreen(ix)) continue;
    const q = sh.t / CONFIG.warnTime;
    ctx.strokeStyle = PLAYERS[sh.from].color;
    ctx.fillStyle = 'rgba(232,67,58,.18)';
    ctx.lineWidth = 3 * s;
    ctx.setLineDash([8 * s, 6 * s]);
    ctx.beginPath();
    ctx.ellipse(ix, yOf(sh.v), (95 - 35 * q) * s, (34 - 8 * q) * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 바퀴 뒤 먼지. 트랙에 남으므로 속도만큼 빠르게 뒤로 흐른다.
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#fff';
  ctx.lineWidth = Math.max(1, 1.5 * s);
  for (const m of game.dust) {
    const x = xOf(m.wx);
    if (!onScreen(x)) continue;
    const q = m.t / m.life;
    ctx.globalAlpha = 0.5 * (1 - q);
    ctx.beginPath();
    ctx.arc(x, yOf(m.lat) - (6 + q * 10) * s, (4 + q * 9) * m.size * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 모든 카트를 같은 크기로, 도로 위쪽(lat이 작은 쪽)부터 그린다.
  for (const q of [...game.players].sort((a, b) => a.lat - b.lat)) {
    const k = kartPx(me, q);
    if (!onScreen(k.x)) continue;
    const pose = ended ? (game.winners.includes(q.i) ? 'win' : 'lose') : 'drive';
    drawKart(k.x, k.y, s, PLAYERS[q.i].color, pose, {
      boost: q.boost > 0, slow: q.slow > 0, wobble: q.hitFx / 0.6, blink: q.protect > 0,
      mul: q.mul, spin: q.spin, tag: q.i + 1, me: q === me,
    });
  }

  for (const sh of game.shots) {
    const from = shotStart(sh);
    const q = (sh.t / CONFIG.warnTime) ** 2;
    const x = xOf(from.wx + (game.players[sh.to].base + sh.u - from.wx) * q);
    const y = yOf(from.lat + (sh.v - from.lat) * q) - 30 * s;
    if (onScreen(x)) drawProjectile(x, y, s, PLAYERS[sh.from].color);
  }

  for (const f of game.fx) {
    const ix = xOf(f.to === undefined ? f.wx : game.players[f.to].base + f.u);
    if (!onScreen(ix)) continue;
    const iy = yOf(f.lat) - 30 * s;
    ctx.globalAlpha = 1 - f.t / 0.5;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3 * s;
    if (f.kind === 'hit') {
      spiky(ix, iy, (40 + f.t * 60) * s, (22 + f.t * 30) * s, 10, 0.3);
      ctx.fillStyle = '#ffd84a';
      ctx.fill();
      ctx.stroke();
      text('쾅!', ix, iy, 28 * s, '#e8433a');
    } else if (f.kind === 'miss') {
      text('휙~', ix, iy - f.t * 40 * s, 24 * s, 'rgba(43,38,34,.7)');
    } else if (f.kind === 'pick') {
      // 가져간 카트의 색으로 퍼지는 고리
      ctx.strokeStyle = PLAYERS[f.by].color;
      ctx.lineWidth = 6 * s;
      ctx.beginPath();
      ctx.ellipse(ix, yOf(f.lat), (30 + f.t * 110) * s, (16 + f.t * 60) * s, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      spiky(ix, iy + 10 * s, (14 + f.t * 30) * s, (7 + f.t * 14) * s, 6, 0.2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.stroke();
      text('툭', ix, iy - 14 * s, 20 * s, INK, 'center', SKY);
    }
    ctx.globalAlpha = 1;
  }

  drawForeground(d, s, ppm, cam);
  ctx.restore();

  // 부스터 때 화면 위아래 가장자리를 스치는 가로 줄무늬
  if (rush > 0.05 && !ended) {
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.3 * rush;
    ctx.lineWidth = 2.5 * s;
    for (let k = 0; k < 8; k++) {
      const x = d.x + d.w * 1.3 - ((game.time * d.w * 2.2 + rnd(k) * d.w * 1.6) % (d.w * 1.6));
      const y = k < 4 ? d.y + (8 + k * 11) * s : bottom - (8 + (k - 4) * 11) * s;
      line(x, y, x + d.w * 0.28 * rush, y);
    }
    ctx.globalAlpha = 1;
  }

  const es = clamp(d.h * 0.075, 10, 20);
  const meX = zx(kartPx(me, me).x);
  for (const sh of game.shots) {
    const from = game.players[sh.from];
    const to = game.players[sh.to];
    if (sh.to === me.i && Math.sin(game.time * 25) > -0.3) {
      // 경고는 공격자가 있는 쪽(뒤면 왼쪽, 앞이면 오른쪽)에 띄운다.
      const wx = from.wx < me.wx ? d.x + es * 6 + 24 * s : d.x + d.w - es * 6 - 24 * s;
      const wy = clamp(yOf(from.lat) - 40 * s, d.y + fs * 2 + 22 * s, bottom - 24 * s);
      spiky(wx, wy, 20 * s, 13 * s, 8);
      ctx.fillStyle = '#ffe27a';
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.5, 2.5 * s);
      ctx.stroke();
      text('!', wx, wy + s, 24 * s, '#e8433a');
    }
    // 대상이 시야 밖이면 내 화면에서는 대상 쪽 가장자리로 날아가는 모습만 보인다.
    if (sh.from === me.i && sh.t <= 0.35 && !onScreen(xOf(to.wx))) {
      const q = sh.t / 0.35;
      const y0 = yOf(me.lat) - 60 * s;
      const x1 = to.wx > me.wx ? d.x + d.w + 30 * s : d.x - 30 * s;
      drawProjectile(meX + (x1 - meX) * q, y0 + (yOf(to.lat) - 30 * s - y0) * q, s, P.color);
    }
  }

  // 시야 밖 상대: 있는 쪽 가장자리에 번호와 거리 차를 보여준다.
  const lastY = { '-1': 0, 1: 0 };
  for (const q of [...game.players].sort((a, b) => a.lat - b.lat)) {
    const kx = zx(kartPx(me, q).x);
    const side = kx < d.x - 62 * s * z ? -1 : kx > d.x + d.w + 62 * s * z ? 1 : 0;
    if (!side) continue;
    const y = Math.max(clamp(yOf(q.lat) - 30 * s, d.y + fs * 2.4, bottom - es), lastY[side] + es * 1.5);
    lastY[side] = y;
    const ex = side < 0 ? d.x + 4 : d.x + d.w - 4;
    const align = side < 0 ? 'left' : 'right';
    text(side < 0 ? '◀' : '▶', ex, y, es * 0.9, INK, align, SKY);
    ctx.fillStyle = PLAYERS[q.i].color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ex - side * es * 1.7, y, es * 0.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    text(String(q.i + 1), ex - side * es * 1.7, y + 1, es * 0.9, '#fff', 'center', INK);
    text(`${Math.round(Math.abs(q.wx - me.wx))}m`, ex - side * es * 2.6, y, es, INK, align, SKY);
  }

  // 패널 HUD
  const hudX = d.x + 6;
  ctx.fillStyle = P.color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(hudX + fs * 0.7, d.y + fs * 0.9, fs * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  text(String(me.i + 1), hudX + fs * 0.7, d.y + fs * 0.95, fs, '#fff', 'center', INK);
  text(`${P.name} ${rankOf(me)}위`, hudX + fs * 1.7, d.y + fs * 0.95, fs, INK, 'left', SKY);
  text(`${Math.floor(Math.min(me.wx, CONFIG.raceLength))}m`, d.x + d.w - 6, d.y + fs * 0.95, fs, INK, 'right', SKY);
  if (me.boost > 0) text('부스터!', d.x + d.w - 6, d.y + fs * 2.1, fs * 0.9, '#e8801a', 'right', SKY);
  if (me.slow > 0) text(`감속 ${me.slow.toFixed(1)}s`, d.x + d.w - 6, d.y + fs * (me.boost > 0 ? 3.2 : 2.1), fs * 0.9, '#2f7be0', 'right', SKY);

  if (ended) {
    const won = game.winners.includes(me.i);
    text(`${P.name} ${won ? 'Win!' : 'Lose…'}`, d.x + d.w / 2, d.y + d.h * 0.17,
      clamp(Math.min(d.h * 0.2, d.w * 0.085), 16, 64), won ? P.color : '#8a8378', 'center', SKY);
  }
  ctx.restore();
}

// ---------- 그리기: 조작 공간 ----------

function drawButtons(pan, p) {
  const b = pan.btns;
  const armed = p.attack && game.state === 'race';
  const cx = b.x + b.h * 0.55;
  const cy = b.y + b.h / 2;
  ctx.lineWidth = 2;
  ctx.strokeStyle = p.attack ? INK : 'rgba(43,38,34,.3)';
  spiky(cx, cy, b.h * 0.42, b.h * 0.22, 8, p.attack ? game.time * 2 : 0);
  ctx.fillStyle = p.attack ? '#e8433a' : 'rgba(43,38,34,.06)';
  ctx.fill();
  ctx.stroke();

  for (const btn of attackButtons(pan, p.i)) {
    const pulse = armed ? 1.5 + Math.sin(game.time * 10) * 1.5 : 0;
    rr(btn.x, btn.y + 2, btn.w, btn.h - 4, 10);
    ctx.globalAlpha = armed ? 1 : 0.25;
    ctx.fillStyle = PLAYERS[btn.target].color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = armed ? INK : 'rgba(43,38,34,.3)';
    ctx.lineWidth = 2 + pulse;
    ctx.stroke();
    const fs = Math.min(btn.h * 0.55, btn.w * 0.5);
    text(String(btn.target + 1), btn.x + btn.w / 2, btn.y + btn.h / 2 + 1, fs,
      armed ? '#fff' : 'rgba(43,38,34,.45)', 'center', armed ? INK : undefined);
  }
}

function drawPad(pan, p) {
  const pad = pan.pad;
  const P = PLAYERS[p.i];
  rr(pad.x, pad.y, pad.w, pad.h, 12);
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = P.color;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = P.color;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([10, 7]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = 0.45;
  text(`${P.name} 터치 화면`, pad.x + pad.w / 2, pad.y + pad.h / 2, clamp(pad.h * 0.16, 12, 30), P.color);
  ctx.globalAlpha = 1;

  // 주행 영역 속 카트 위치를 조작 공간에 대응시켜 보여준다.
  const inr = padInner(pad);
  ctx.fillStyle = P.color;
  ctx.beginPath();
  ctx.arc(inr.x + (p.off / OFF_MAX) * inr.w, inr.y + p.lat * inr.h, 5, 0, Math.PI * 2);
  ctx.fill();

  if (p.touch) {
    const tx = pad.x + p.touch.u * pad.w;
    const ty = pad.y + p.touch.v * pad.h;
    const rad = clamp(pad.h * 0.2, 18, 40);
    ctx.beginPath();
    ctx.arc(tx, ty, rad, 0, Math.PI * 2);
    ctx.globalAlpha = 0.2;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = P.color;
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

function drawHelpCell(pan) {
  rr(pan.x, pan.y, pan.w, pan.h, 12);
  ctx.strokeStyle = 'rgba(43,38,34,.35)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
  const lines = ['조작 안내', '터치 화면에 손가락 → 카트 이동', '≫ 부스터: 빨라져요', '✸ 공격 칸 → 상대 번호 터치', '아이템은 먼저 밟은 사람 것!', '날아오는 공격은 피하기!'];
  const fs = clamp(Math.min(pan.h * 0.075, pan.w * 0.055), 11, 24);
  lines.forEach((ln, k) => {
    text(ln, pan.x + pan.w / 2, pan.y + pan.h / 2 + (k - 2.5) * fs * 1.7, k ? fs : fs * 1.3, k ? 'rgba(43,38,34,.75)' : INK);
  });
}

// ---------- 그리기: 공통 ----------

function drawBar() {
  const { barH, pauseBtn } = game.layout;
  const x0 = 40;
  const x1 = pauseBtn.x - 84;
  const y = barH / 2;
  const fs = barH * 0.36;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  line(x0, y, x1, y);
  ctx.lineWidth = 1.5;
  for (let m = 0; m <= 10; m++) {
    const x = x0 + ((x1 - x0) * m) / 10;
    line(x, y - 5, x, y + 5);
  }
  text('0m', x0 - 20, y, fs);
  text('1000m', x1 + 48, y, fs);

  const order = [...game.players].sort((a, b) => a.wx - b.wx);
  for (const p of order) {
    const x = x0 + (x1 - x0) * clamp(p.wx / CONFIG.raceLength, 0, 1);
    ctx.fillStyle = PLAYERS[p.i].color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, barH * 0.33, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    text(String(p.i + 1), x, y + 1, barH * 0.42, '#fff', 'center', INK);
  }

  if (game.state === 'race' || game.state === 'countdown') {
    rr(pauseBtn.x, pauseBtn.y, pauseBtn.w, pauseBtn.h, 8);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 4;
    const cx = pauseBtn.x + pauseBtn.w / 2;
    const cy = pauseBtn.y + pauseBtn.h / 2;
    line(cx - 5, cy - 7, cx - 5, cy + 7);
    line(cx + 5, cy - 7, cx + 5, cy + 7);
  }
}

function drawCenterCall(label) {
  const r = Math.min(W, H) * 0.13;
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  text(label, W / 2, H / 2 + r * 0.05, label.length > 1 ? r * 0.7 : r * 1.3, '#e8433a');
}

function drawRaceScreen() {
  drawBar();
  game.layout.panels.forEach((pan, i) => {
    if (i >= game.count) return drawHelpCell(pan);
    const p = game.players[i];
    rr(pan.x, pan.y, pan.w, pan.h, 12);
    ctx.fillStyle = SKY;
    ctx.fill();
    drawDrive(pan.drive, p);
    drawButtons(pan, p);
    drawPad(pan, p);
    rr(pan.x, pan.y, pan.w, pan.h, 12);
    ctx.strokeStyle = PLAYERS[i].color;
    ctx.lineWidth = 3;
    ctx.stroke();
  });
  if (game.state === 'countdown') drawCenterCall(String(Math.ceil(game.countdown)));
  else if (game.state === 'race' && game.goFlash > 0) drawCenterCall('출발!');
}

function drawTitleScene() {
  const s = Math.min((H * 0.42) / 136, (W * 0.25) / 116);
  const roadTop = H * 0.9 - 70 * s;
  ctx.lineJoin = ctx.lineCap = 'round';
  drawRoad({ x: 0, y: 0, w: W, h: H }, s, roadTop, W / CONFIG.viewMeters, 0);
  drawSign(W * 0.8, roadTop, s * 1.4, 'Goal');
  drawKart(W * 0.38, H * 0.9, s, PLAYERS[0].color, 'drive');
}

function render() {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  if (game.state === 'title' || game.state === 'select') drawTitleScene();
  else drawRaceScreen();
}

// ---------- 시작 ----------

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

resize();
requestAnimationFrame(frame);
