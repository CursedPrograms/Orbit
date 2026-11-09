// ORBIT - an Arcade Phantasm game by Cursed Entertainment.
// A tiny spacecraft caught between gravitational fields. Every planet pulls (inverse square, the faint rings show its
// well); your thrust is weak and your fuel short, so gravity is how you really move: fall round a planet, slingshot to
// the next, grab the energy orbs. The ghosts that hunt you pull too. And the planets don't last: one cracks, glows,
// counts down, and goes, with a shockwave and debris, and its well is gone. The dotted line shows where you'll fall.
// Physics runs on a fixed 120 Hz step.
(function () {
  "use strict";
  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var splash = document.getElementById("splash");
  var hud = {
    score: document.getElementById("hud-score"), wave: document.getElementById("hud-wave"), orbs: document.getElementById("hud-orbs"),
    lives: document.getElementById("hud-lives"), best: document.getElementById("hud-best")
  };
  var hash = location.hash;
  var shotMode = hash.indexOf("#shot") === 0;

  var C = { navy: "#001725", deep: "#005184", blue: "#007ab7", sky: "#34a9e3", pink: "#f088e9", green: "#39ff6a", black: "#020611" };
  var TAU = Math.PI * 2;

  // physics
  var DT = 1 / 120, G_K = 1500, SOFT = 12, THRUST = 115, ROT = 4.2, FUEL_USE = 20, FUEL_REGEN = 1.6, MAX_V = 650;
  var SHIP_R = 6, PREDICT_T = 2.4, WARN_T = 5, INVULN = 2.5;

  var seed = 1;
  function rnd() {
    seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  function rr(a, b) { return a + (b - a) * rnd(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  var W = 0, H = 0, DPR = 1, WW = 1600, WH = 1000, VS = 1, VX = 0, VY = 0;
  var ship, planets, enemies, orbs, debris, waves, particles, stars, popups;
  var state = "attract", paused = false, started = false, time = 0, acc = 0;
  var wave, lives, score, orbsGot, orbsNeed, combo, comboT, spawnT, orbT, bannerT, bannerText, bannerSub, shakeT, flashT, flashCol;
  var overT = 0, clearT = 0, thrusting = false;
  var keys = { left: false, right: false, up: false, down: false };
  var touch = { on: false, id: null, x0: 0, y0: 0, x: 0, y: 0 }, brakeBtn = false;
  var best = parseInt(localStorage.getItem("orbitBest") || "0", 10);
  var lastHud = "";

  // ---- the world ------------------------------------------------------------------------------------------------
  function worldSize() {
    if (W >= H) { WH = 1000; WW = clamp(1000 * W / H, 1100, 1900); }
    else { WW = 1000; WH = clamp(1000 * H / W, 1100, 1900); }
  }
  function view() {
    VS = Math.min(W / WW, H / WH);
    VX = (W - WW * VS) / 2; VY = (H - WH * VS) / 2;
  }

  function makePlanet(x, y, r) {
    var cracks = [];
    for (var i = 0; i < 7; i++) {                        // the cracks that open up before it blows
      var a = rnd() * TAU, pts = [[0, 0]], d = 0;
      while (d < 1) { d += rr(0.15, 0.35); a += rr(-0.6, 0.6); pts.push([Math.cos(a) * Math.min(d, 1), Math.sin(a) * Math.min(d, 1)]); }
      cracks.push(pts);
    }
    return { x: x, y: y, r: r, gm: G_K * r * r, form: 0, timer: 0, warn: -1, lastTick: 0, cracks: cracks,
             hue: rnd() < 0.5 ? 0 : 1, rot: rnd() * TAU, bands: 2 + Math.floor(rnd() * 3), dead: false };
  }

  function freeSpot(r, gap) {
    for (var tries = 0; tries < 200; tries++) {
      var x = rr(r + 110, WW - r - 110), y = rr(r + 110, WH - r - 110), ok = true;
      for (var i = 0; i < planets.length; i++) {
        var p = planets[i];
        if (Math.hypot(p.x - x, p.y - y) < p.r + r + gap) { ok = false; break; }
      }
      if (ok && ship && Math.hypot(ship.x - x, ship.y - y) < r + 120) ok = false;
      if (ok) return [x, y];
    }
    return null;
  }

  function explodeDelay() { return Math.max(6, rr(16, 26) - wave * 1.6); }

  function layout() {
    planets = []; enemies = []; orbs = []; debris = []; waves = []; reformT = [];
    var n = Math.min(6, 1 + Math.ceil(wave * 0.75) + (wave === 1 ? 1 : 0));
    for (var i = 0; i < n; i++) {
      var r = rr(34, 66), spot = freeSpot(r, 230);
      if (!spot) spot = freeSpot(r, 150);
      if (!spot) continue;
      var p = makePlanet(spot[0], spot[1], r);
      p.form = 1;
      p.timer = explodeDelay() + i * rr(4, 8) + (wave === 1 ? 8 : 0);
      planets.push(p);
    }
  }

  // put the ship into a circular orbit round the planet that's furthest from trouble
  function placeShip() {
    var bestP = null, bestD = -1;
    for (var i = 0; i < planets.length; i++) {
      var p = planets[i];
      if (p.dead || p.warn >= 0 || p.form < 1) continue;
      var dmin = 1e9;
      for (var j = 0; j < enemies.length; j++) dmin = Math.min(dmin, Math.hypot(enemies[j].x - p.x, enemies[j].y - p.y));
      if (dmin > bestD) { bestD = dmin; bestP = p; }
    }
    var a = rnd() * TAU;
    if (!bestP) { ship.x = WW / 2; ship.y = WH / 2; ship.vx = ship.vy = 0; return; }
    var R = bestP.r * 2.4, v = Math.sqrt(bestP.gm / Math.sqrt(R * R + SOFT * SOFT));
    ship.x = bestP.x + Math.cos(a) * R; ship.y = bestP.y + Math.sin(a) * R;
    ship.vx = -Math.sin(a) * v; ship.vy = Math.cos(a) * v;
    ship.ang = Math.atan2(ship.vy, ship.vx);
    ship.trail = [];
  }

  function enemyTarget() { return 1 + Math.floor(wave / 2) + (wave >= 3 ? 1 + Math.floor((wave - 3) / 3) : 0) + (wave >= 4 ? Math.floor((wave - 2) / 2) : 0); }

  function spawnEnemy(type) {
    if (!type) {
      var r = rnd();
      type = wave >= 4 && r < 0.3 ? "darter" : wave >= 3 && r < 0.5 && countType("maw") < 1 + Math.floor((wave - 3) / 3) ? "maw" : "wisp";
    }
    var side = Math.floor(rnd() * 4), x, y;
    if (side === 0) { x = rr(60, WW - 60); y = 40; } else if (side === 1) { x = WW - 40; y = rr(60, WH - 60); }
    else if (side === 2) { x = rr(60, WW - 60); y = WH - 40; } else { x = 40; y = rr(60, WH - 60); }
    if (ship && Math.hypot(ship.x - x, ship.y - y) < 300) { x = WW - x; y = WH - y; }
    var e = { type: type, x: x, y: y, vx: 0, vy: 0, in: 1.4, ph: rnd() * TAU, dash: rr(2, 4) };
    if (type === "wisp") { e.r = 11; e.gm = 2.6e5; e.acc = 75; e.max = 175; }
    else if (type === "maw") { e.r = 20; e.gm = 1.3e6; e.acc = 22; e.max = 65; }
    else { e.r = 8; e.gm = 1.6e5; e.acc = 150; e.max = 320; }
    enemies.push(e);
    if (!shotMode && state === "play") Sfx.spawn();
  }
  function countType(t) { var n = 0; for (var i = 0; i < enemies.length; i++) if (enemies[i].type === t) n++; return n; }

  function spawnOrb() {
    var live = planets.filter(function (p) { return !p.dead && p.warn < 0 && p.form >= 1; });
    if (live.length && rnd() < 0.7) {                    // most orbs ride an orbit round a planet: match it to catch one
      var p = live[Math.floor(rnd() * live.length)], R = p.r * rr(1.8, 3.4), v = Math.sqrt(p.gm / Math.sqrt(R * R + SOFT * SOFT));
      orbs.push({ p: p, R: R, w: (rnd() < 0.5 ? -1 : 1) * v / R, a: rnd() * TAU, x: 0, y: 0, vx: 0, vy: 0, in: 0 });
    } else {
      for (var t = 0; t < 30; t++) {
        var x = rr(80, WW - 80), y = rr(80, WH - 80), ok = true;
        for (var i = 0; i < planets.length; i++) if (Math.hypot(planets[i].x - x, planets[i].y - y) < planets[i].r + 50) ok = false;
        if (ok) { orbs.push({ p: null, x: x, y: y, vx: rr(-15, 15), vy: rr(-15, 15), in: 0 }); return; }
      }
    }
  }

  // ---- gravity --------------------------------------------------------------------------------------------------
  var AX = 0, AY = 0;
  function gravity(x, y, withEnemies, skip) {
    AX = 0; AY = 0;
    for (var i = 0; i < planets.length; i++) {
      var p = planets[i];
      if (p.dead) continue;
      var dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy + SOFT * SOFT, d = Math.sqrt(d2), a = p.gm * p.form / d2;
      AX += a * dx / d; AY += a * dy / d;
    }
    if (withEnemies) {
      for (i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (e === skip || e.in > 0) continue;
        dx = e.x - x; dy = e.y - y; d2 = dx * dx + dy * dy + 900; d = Math.sqrt(d2); a = e.gm / d2;
        AX += a * dx / d; AY += a * dy / d;
      }
    }
  }

  // ---- the game -------------------------------------------------------------------------------------------------
  function newGame(firstWave) {
    wave = firstWave || 1; lives = 3; score = 0;
    ship = { x: 0, y: 0, vx: 0, vy: 0, ang: 0, fuel: 100, invuln: 0, trail: [], dead: false };
    particles = []; popups = [];
    startWave(true);
    state = "play";
    if (!shotMode) { Sfx.start(); Sfx.music(true, wave); }
  }

  function startWave(first) {
    orbsGot = 0; orbsNeed = 5 + 2 * wave; combo = 0; comboT = 0;
    seed = seed + wave * 7919;
    layout();
    for (var i = 0; i < enemyTarget(); i++) spawnEnemy(i === 0 ? "wisp" : null);
    for (i = 0; i < enemies.length; i++) enemies[i].in = 1.4 + i * 0.6;
    placeShip();
    ship.fuel = 100; ship.invuln = INVULN; ship.dead = false;
    for (i = 0; i < 3 + Math.min(wave, 3); i++) spawnOrb();
    spawnT = 9; orbT = 2;
    banner("WAVE " + wave, wave === 1 ? "Fall round the planets. Thrust is weak, gravity is strong." :
           wave === 2 ? "Planets don't last. Get clear when the countdown starts." :
           wave === 3 ? "The maw: a ghost with a deep well of its own" : wave === 4 ? "Darters: fast and hungry" : "Faster, fiercer, more");
    updateHud();
  }

  function banner(t, sub) { bannerText = t; bannerSub = sub || ""; bannerT = 3.2; }
  function flash(c, t) { flashCol = c; flashT = t; }

  function updateHud() {
    var s = "Score " + score + "|Wave " + wave + "|Orbs " + Math.min(orbsGot, orbsNeed) + "/" + orbsNeed + "|Lives " + Math.max(0, lives) + "|Best " + best + (Sfx.isMuted() ? "  (muted)" : "");
    if (s === lastHud) return;
    lastHud = s;
    var p = s.split("|");
    hud.score.textContent = p[0]; hud.wave.textContent = p[1]; hud.orbs.textContent = p[2]; hud.lives.textContent = p[3]; hud.best.textContent = p[4];
  }

  function burst(x, y, n, speed, cols, size, life) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU, v = speed * (0.15 + Math.random() * 0.85), l = (life || 0.8) * (0.5 + Math.random() * 0.8);
      particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: l, max: l,
                       c: cols[Math.floor(Math.random() * cols.length)], s: size * (0.5 + Math.random()) });
    }
  }

  function popup(x, y, text, col) { popups.push({ x: x, y: y, t: text, c: col, life: 1.2 }); }

  function killShip() {
    if (ship.dead) return;
    ship.dead = true;
    burst(ship.x, ship.y, 80, 320, ["#ffffff", C.sky, C.pink], 3, 1.2);
    burst(ship.x, ship.y, 20, 120, ["#ffffff"], 5, 0.6);
    Sfx.crash(); Sfx.thrust(false);
    shakeT = 0.6; flash("#ffffff", 0.3);
    lives--;
    combo = 0;
    if (lives <= 0) {
      state = "over"; overT = time;
      Sfx.music(false); Sfx.over();
      if (score > best && !shotMode) { best = score; localStorage.setItem("orbitBest", String(best)); }
    } else {
      respawnT = 1.4;
    }
    updateHud();
  }
  var respawnT = 0;

  function killEnemy(e, why) {
    var i = enemies.indexOf(e);
    if (i < 0) return;
    enemies.splice(i, 1);
    burst(e.x, e.y, 40, 240, [C.green, "#ffffff", C.pink], 3, 0.9);
    if (state === "play" && !shotMode) {
      var pts = (e.type === "maw" ? 400 : e.type === "darter" ? 250 : 150) * wave;
      score += pts; popup(e.x, e.y - 20, "+" + pts + " " + why, C.green);
      Sfx.pop();
    }
  }

  function explode(p) {
    p.dead = true;
    var near = clamp(1 - Math.hypot(ship.x - p.x, ship.y - p.y) / 900, 0, 1);
    waves.push({ x: p.x, y: p.y, r: p.r, max: 260 + p.r * 3.2, sp: 560, hit: [] });
    for (var i = 0; i < 12 + Math.floor(p.r / 5); i++) {
      var a = Math.random() * TAU, v = rr(140, 360);
      debris.push({ x: p.x + Math.cos(a) * p.r * 0.7, y: p.y + Math.sin(a) * p.r * 0.7, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                    r: rr(4, 9), rot: Math.random() * TAU, vr: rr(-6, 6), life: rr(4, 6), sides: 3 + Math.floor(Math.random() * 3) });
    }
    burst(p.x, p.y, 160, 520, ["#ffffff", C.pink, C.pink, C.sky, "#ffd0f8"], 4, 1.4);
    burst(p.x, p.y, 40, 160, ["#ffffff"], 8, 0.5);
    // anything too close is caught in the blast
    if (!ship.dead && ship.invuln <= 0 && Math.hypot(ship.x - p.x, ship.y - p.y) < p.r + 45 && state === "play") killShip();
    for (i = enemies.length - 1; i >= 0; i--) if (Math.hypot(enemies[i].x - p.x, enemies[i].y - p.y) < p.r + 45) killEnemy(enemies[i], "blast");
    // orbs riding its orbit fly off on their own
    for (i = 0; i < orbs.length; i++) {
      var o = orbs[i];
      if (o.p !== p) continue;
      o.vx = -Math.sin(o.a) * o.w * o.R; o.vy = Math.cos(o.a) * o.w * o.R;
      var sp = Math.hypot(o.vx, o.vy), k = Math.min(1, 90 / sp);
      o.vx *= k; o.vy *= k; o.p = null;
    }
    if (!shotMode) Sfx.boom(near);
    shakeT = 0.4 + near * 0.6; flash(C.pink, 0.2 + near * 0.3);
    reformT.push(rr(5, 8));
  }
  var reformT = [];

  function step(dt) {
    time += dt;
    var playing = state === "play";

    // the planets: count down, crack, blow; new ones form
    for (var i = planets.length - 1; i >= 0; i--) {
      var p = planets[i];
      p.rot += dt * 0.15;
      if (p.form < 1) { p.form = Math.min(1, p.form + dt / 2.2); continue; }
      if (p.warn < 0) {
        p.timer -= dt;
        if (p.timer <= 0) { p.warn = Math.max(3.4, WARN_T - wave * 0.15); p.warnMax = p.warn; p.lastTick = Math.ceil(p.warn); }
      } else {
        p.warn -= dt;
        if (Math.ceil(p.warn) < p.lastTick) { p.lastTick = Math.ceil(p.warn); if (playing && !shotMode) Sfx.tick(p.lastTick); }
        if (p.warn <= 0) { explode(p); planets.splice(i, 1); }
      }
    }
    for (i = reformT.length - 1; i >= 0; i--) {
      reformT[i] -= dt;
      if (reformT[i] <= 0) {
        reformT.splice(i, 1);
        var r = rr(34, 62), spot = freeSpot(r, 200);
        if (spot) { var np = makePlanet(spot[0], spot[1], r); np.timer = explodeDelay() + rr(2, 8); planets.push(np); }
      }
    }

    // the ship
    if (!ship.dead) {
      var turn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), thr = keys.up, brk = keys.down || brakeBtn;
      if (touch.on) {
        var dx = touch.x - touch.x0, dy = touch.y - touch.y0, m = Math.hypot(dx, dy);
        if (m > 14) {
          var want = Math.atan2(dy, dx), diff = Math.atan2(Math.sin(want - ship.ang), Math.cos(want - ship.ang));
          turn = Math.abs(diff) < 0.05 ? 0 : clamp(diff * 6, -1, 1);
          thr = m > 34 && Math.abs(diff) < 0.7;
        }
      }
      if (state === "attract") { turn = 0; thr = false; brk = false; }
      ship.ang += turn * ROT * dt;
      gravity(ship.x, ship.y, true);
      var ax = AX, ay = AY, burning = false;
      if (thr && ship.fuel > 0) { ax += Math.cos(ship.ang) * THRUST; ay += Math.sin(ship.ang) * THRUST; burning = true; }
      if (brk && ship.fuel > 0) {
        var sp = Math.hypot(ship.vx, ship.vy);
        if (sp > 5) { ax -= ship.vx / sp * THRUST; ay -= ship.vy / sp * THRUST; burning = true; }
      }
      if (burning) {
        ship.fuel = Math.max(0, ship.fuel - FUEL_USE * dt);
        if (Math.random() < 0.6) {
          var ba = thr ? ship.ang + Math.PI : Math.atan2(ship.vy, ship.vx) + (Math.random() - 0.5);
          particles.push({ x: ship.x + Math.cos(ba) * 8, y: ship.y + Math.sin(ba) * 8, vx: Math.cos(ba + (Math.random() - 0.5) * 0.5) * 140 + ship.vx,
                           vy: Math.sin(ba + (Math.random() - 0.5) * 0.5) * 140 + ship.vy, life: 0.35, max: 0.35, c: Math.random() < 0.5 ? C.pink : "#ffffff", s: 2 });
        }
      } else ship.fuel = Math.min(100, ship.fuel + FUEL_REGEN * dt);
      if (burning !== thrusting) { thrusting = burning; if (!shotMode && state === "play") Sfx.thrust(burning); }
      ship.vx += ax * dt; ship.vy += ay * dt;
      var v = Math.hypot(ship.vx, ship.vy);
      if (v > MAX_V) { ship.vx *= MAX_V / v; ship.vy *= MAX_V / v; }
      ship.x += ship.vx * dt; ship.y += ship.vy * dt;
      ship.invuln = Math.max(0, ship.invuln - dt);
      // the edge of the arena gives you a jolt and sends you back
      if (ship.x < 8 || ship.x > WW - 8) { ship.vx = -ship.vx * 0.55; ship.x = clamp(ship.x, 8, WW - 8); edgeHit(); }
      if (ship.y < 8 || ship.y > WH - 8) { ship.vy = -ship.vy * 0.55; ship.y = clamp(ship.y, 8, WH - 8); edgeHit(); }
      // crashing into a planet
      for (i = 0; i < planets.length; i++) {
        p = planets[i];
        var d = Math.hypot(ship.x - p.x, ship.y - p.y);
        if (d < p.r * p.form + SHIP_R) {
          if (ship.invuln > 0 || state !== "play") {       // bounce off while you're still blinking
            var nx = (ship.x - p.x) / d, ny = (ship.y - p.y) / d, vn = ship.vx * nx + ship.vy * ny;
            ship.x = p.x + nx * (p.r * p.form + SHIP_R + 1); ship.y = p.y + ny * (p.r * p.form + SHIP_R + 1);
            if (vn < 0) { ship.vx -= 1.6 * vn * nx; ship.vy -= 1.6 * vn * ny; }
          } else { killShip(); break; }
        }
      }
      if (time - (ship.lastTrail || 0) > 0.03) { ship.trail.push(ship.x, ship.y); ship.lastTrail = time; if (ship.trail.length > 120) ship.trail.splice(0, 2); }
    } else if (state === "play") {
      respawnT -= dt;
      if (respawnT <= 0) { ship.dead = false; ship.fuel = 100; ship.invuln = INVULN; placeShip(); }
    }

    // the ghosts: they hunt you, fall like you do, and pull you towards them
    for (i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      if (e.in > 0) { e.in -= dt; continue; }
      var tx = ship.dead ? WW / 2 : ship.x, ty = ship.dead ? WH / 2 : ship.y;
      dx = tx - e.x; dy = ty - e.y; d = Math.hypot(dx, dy) || 1;
      var eax = dx / d * e.acc, eay = dy / d * e.acc;
      if (e.type === "darter") {
        e.dash -= dt;
        if (e.dash <= 0) { e.dash = rr(2.5, 4.5); e.vx += dx / d * 260; e.vy += dy / d * 260; burst(e.x, e.y, 8, 80, [C.green], 2, 0.4); }
      }
      if (e.type !== "maw") {                           // they keep clear of the planets, mostly
        gravity(e.x, e.y, false);
        eax += AX * 0.6; eay += AY * 0.6;
        for (var j = 0; j < planets.length; j++) {
          var pp = planets[j], pdx = e.x - pp.x, pdy = e.y - pp.y, pd = Math.hypot(pdx, pdy);
          if (pd < pp.r + 70) { eax += pdx / pd * 260; eay += pdy / pd * 260; }
        }
      }
      e.vx += eax * dt; e.vy += eay * dt;
      var ev = Math.hypot(e.vx, e.vy), emax = e.max * (1 + wave * 0.04);
      if (ev > emax) { e.vx *= emax / ev; e.vy *= emax / ev; }
      e.x = clamp(e.x + e.vx * dt, 10, WW - 10); e.y = clamp(e.y + e.vy * dt, 10, WH - 10);
      var dead = false;
      for (j = 0; j < planets.length && !dead; j++) {
        if (Math.hypot(e.x - planets[j].x, e.y - planets[j].y) < planets[j].r * planets[j].form + e.r * 0.6) { killEnemy(e, "crashed"); dead = true; }
      }
      if (dead) continue;
      if (!ship.dead && ship.invuln <= 0 && state === "play" && Math.hypot(e.x - ship.x, e.y - ship.y) < e.r + SHIP_R - 2) killShip();
    }

    // the shockwaves push everything outwards and smash ghosts
    for (i = waves.length - 1; i >= 0; i--) {
      var w = waves[i];
      w.r += w.sp * dt;
      if (w.r > w.max) { waves.splice(i, 1); continue; }
      var k = 1 - w.r / w.max;
      if (!ship.dead && w.hit.indexOf(ship) < 0) {
        d = Math.hypot(ship.x - w.x, ship.y - w.y);
        if (Math.abs(d - w.r) < 24) { w.hit.push(ship); ship.vx += (ship.x - w.x) / d * (80 + 320 * k); ship.vy += (ship.y - w.y) / d * (80 + 320 * k); shakeT = Math.max(shakeT, 0.3); }
      }
      for (j = enemies.length - 1; j >= 0; j--) {
        e = enemies[j];
        if (e.in > 0 || w.hit.indexOf(e) >= 0) continue;
        d = Math.hypot(e.x - w.x, e.y - w.y);
        if (Math.abs(d - w.r) < 24) { w.hit.push(e); if (k > 0.45 && e.type !== "maw") killEnemy(e, "blast"); else { e.vx += (e.x - w.x) / d * 260 * k; e.vy += (e.y - w.y) / d * 260 * k; } }
      }
    }

    // debris: falls through the wells, kills what it hits
    for (i = debris.length - 1; i >= 0; i--) {
      var b = debris[i];
      b.life -= dt;
      gravity(b.x, b.y, false);
      b.vx += AX * dt; b.vy += AY * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt;
      var gone = b.life <= 0 || b.x < -50 || b.x > WW + 50 || b.y < -50 || b.y > WH + 50;
      for (j = 0; j < planets.length && !gone; j++) if (Math.hypot(b.x - planets[j].x, b.y - planets[j].y) < planets[j].r * planets[j].form) { gone = true; burst(b.x, b.y, 8, 90, [C.pink, "#ffffff"], 2, 0.5); }
      if (!gone && !ship.dead && ship.invuln <= 0 && state === "play" && Math.hypot(b.x - ship.x, b.y - ship.y) < b.r + SHIP_R - 1) { killShip(); gone = true; }
      for (j = enemies.length - 1; j >= 0 && !gone; j--) {
        if (enemies[j].in <= 0 && Math.hypot(b.x - enemies[j].x, b.y - enemies[j].y) < b.r + enemies[j].r) { killEnemy(enemies[j], "smashed"); gone = true; }
      }
      if (gone) debris.splice(i, 1);
    }

    // the orbs
    for (i = orbs.length - 1; i >= 0; i--) {
      var o = orbs[i];
      o.in = Math.min(1, o.in + dt * 1.5);
      if (o.p) { o.a += o.w * dt; o.x = o.p.x + Math.cos(o.a) * o.R; o.y = o.p.y + Math.sin(o.a) * o.R; }
      else {
        o.x += o.vx * dt; o.y += o.vy * dt; o.vx *= 1 - 0.3 * dt; o.vy *= 1 - 0.3 * dt;
        if (o.x < 20 || o.x > WW - 20) o.vx = -o.vx;
        if (o.y < 20 || o.y > WH - 20) o.vy = -o.vy;
      }
      if (!ship.dead && state === "play" && Math.hypot(o.x - ship.x, o.y - ship.y) < 16 + SHIP_R) {
        orbs.splice(i, 1);
        orbsGot++;
        combo = comboT > 0 ? combo + 1 : 0; comboT = 3;
        var pts = 100 * wave * (1 + combo);
        score += pts; ship.fuel = Math.min(100, ship.fuel + 22);
        popup(o.x, o.y - 18, "+" + pts, C.sky);
        burst(o.x, o.y, 30, 200, [C.sky, "#ffffff", C.green], 2.5, 0.7);
        if (!shotMode) Sfx.orb(combo);
        if (orbsGot >= orbsNeed) waveClear();
      }
    }
    comboT = Math.max(0, comboT - dt);

    if (playing) {
      orbT -= dt;
      if (orbT <= 0 && orbs.length < 3 + Math.min(wave, 3)) { spawnOrb(); orbT = rr(1.5, 3.5); }
      spawnT -= dt;
      if (spawnT <= 0) { if (enemies.length < enemyTarget()) spawnEnemy(); spawnT = Math.max(4, 10 - wave); }
    }
    if (state === "clear") {
      clearT -= dt;
      if (clearT <= 0) { wave++; state = "play"; startWave(); Sfx.music(false); Sfx.music(true, wave); }
    }
    if (state === "attract" && enemies.length < 3 && Math.random() < dt) spawnEnemy("wisp");
    if (state === "attract" && orbs.length < 5 && Math.random() < dt) spawnOrb();
    if (state === "attract" && planets.length < 3 && reformT.length === 0) reformT.push(2);
  }

  function edgeHit() {
    burst(ship.x, ship.y, 10, 120, [C.sky, "#ffffff"], 2, 0.4);
    if (state === "play" && !shotMode) Sfx.bump();
  }

  function waveClear() {
    var bonus = 1000 * wave + Math.floor(ship.fuel) * 10;
    score += bonus;
    banner("WAVE " + wave + " CLEAR", "Bonus " + bonus + " (fuel left counts)");
    if (!shotMode) Sfx.clear();
    flash(C.sky, 0.3);
    state = "clear"; clearT = 2.8;
    ship.invuln = 3.5;
    if (wave % 2 === 0 && lives < 5) { lives++; popup(ship.x, ship.y - 30, "+1 life", C.green); }
    updateHud();
  }

  // ---- drawing --------------------------------------------------------------------------------------------------
  function sx(x) { return VX + x * VS; }
  function sy(y) { return VY + y * VS; }

  function makeStars() {
    stars = [];
    var n = Math.floor(W * H / 2600);
    for (var i = 0; i < n; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.4 + 0.2, t: Math.random() * TAU, s: 0.4 + Math.random() * 2 });
  }

  function drawBackground() {
    ctx.fillStyle = C.black;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      ctx.globalAlpha = 0.25 + 0.6 * Math.abs(Math.sin(s.t + time * s.s));
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.deep; ctx.lineWidth = 2;                 // the arena's edge
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(sx(0), sy(0), WW * VS, WH * VS);
    ctx.setLineDash([]);
  }

  function drawWells() {
    // the gravity wells: faint rings where the pull is 400, 200, 100, 50 and 25, drifting slowly inwards
    ctx.lineWidth = 1;
    var levels = [420, 200, 100, 50, 25];
    for (var i = 0; i < planets.length; i++) {
      var p = planets[i];
      for (var j = 0; j < levels.length; j++) {
        var R = Math.sqrt(p.gm * p.form / levels[j]);
        if (R < p.r + 6) continue;
        var drift = (time * 12) % 20;
        ctx.strokeStyle = p.warn >= 0 ? C.pink : C.sky;
        ctx.globalAlpha = (0.42 - j * 0.06) * p.form;
        ctx.setLineDash([4, 10]); ctx.lineDashOffset = drift;
        ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), (R - (time * 6 + j * 3) % 6) * VS, 0, TAU); ctx.stroke();
      }
    }
    for (i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.in > 0) continue;
      for (j = 2; j < 5; j++) {
        R = Math.sqrt(e.gm / levels[j]);
        ctx.strokeStyle = C.green; ctx.globalAlpha = 0.3 - (j - 2) * 0.07;
        ctx.setLineDash([3, 8]); ctx.lineDashOffset = -time * 20;
        ctx.beginPath(); ctx.arc(sx(e.x), sy(e.y), R * VS, 0, TAU); ctx.stroke();
      }
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  function drawPlanet(p) {
    var x = sx(p.x), y = sy(p.y), r = p.r * VS * p.form;
    var heat = p.warn >= 0 ? 1 - p.warn / p.warnMax : 0;
    if (heat > 0) { x += (Math.random() - 0.5) * heat * 6; y += (Math.random() - 0.5) * heat * 6; }
    var rim = p.hue ? C.pink : C.sky;
    ctx.shadowColor = heat > 0 ? C.pink : rim; ctx.shadowBlur = 20 + heat * 40;
    ctx.fillStyle = heat > 0.6 && Math.random() < heat * 0.4 ? "#3a0f38" : C.navy;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    // bands across it, turning slowly
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
    ctx.strokeStyle = p.hue ? "#5a2a5a" : C.deep; ctx.lineWidth = r * 0.16;
    for (var i = 0; i < p.bands; i++) {
      var yy = y - r + (i + 1) * 2 * r / (p.bands + 1) + Math.sin(p.rot + i) * r * 0.1;
      ctx.beginPath(); ctx.moveTo(x - r, yy); ctx.quadraticCurveTo(x, yy + Math.sin(p.rot * 2 + i) * r * 0.3, x + r, yy); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = rim; ctx.lineWidth = 2.5;
    ctx.shadowColor = rim; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.shadowBlur = 0;
    if (p.form < 1) {                                   // a new planet pulling itself together
      ctx.strokeStyle = "#ffffff"; ctx.globalAlpha = 1 - p.form;
      ctx.beginPath(); ctx.arc(x, y, p.r * VS * (2 - p.form), 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      if (Math.random() < 0.5) { var a = Math.random() * TAU, d = p.r * 2.5; particles.push({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, vx: -Math.cos(a) * d * 1.2, vy: -Math.sin(a) * d * 1.2, life: 0.7, max: 0.7, c: rim, s: 2 }); }
    }
    if (heat > 0) {
      // the cracks glow brighter as it runs out
      ctx.strokeStyle = heat > 0.7 && Math.floor(time * 20) % 2 ? "#ffffff" : C.pink;
      ctx.shadowColor = C.pink; ctx.shadowBlur = 10 + heat * 20;
      ctx.lineWidth = 1 + heat * 3;
      var reach = Math.min(1, 0.3 + heat);
      for (i = 0; i < p.cracks.length; i++) {
        var c = p.cracks[i];
        ctx.beginPath(); ctx.moveTo(x, y);
        for (var k = 1; k < c.length; k++) {
          var f = Math.min(1, reach);
          ctx.lineTo(x + c[k][0] * r * f, y + c[k][1] * r * f);
        }
        ctx.stroke();
      }
      // the countdown ring and number
      var left = p.warn / p.warnMax;
      ctx.lineWidth = 4; ctx.strokeStyle = C.pink;
      ctx.beginPath(); ctx.arc(x, y, r + 16 * VS + 6, -Math.PI / 2, -Math.PI / 2 + TAU * left); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "bold " + Math.max(16, r * 0.9) + "px 'Arial Black', Arial, sans-serif";
      ctx.fillText(String(Math.ceil(p.warn)), x, y);
    }
  }

  function drawEnemy(e) {
    var x = sx(e.x), y = sy(e.y), r = e.r * VS;
    if (e.in > 0) {                                     // a rift opening where it comes through
      ctx.strokeStyle = C.green; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 20);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r * (1 + e.in * 2), 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.save(); ctx.translate(x, y);
    ctx.shadowColor = C.green; ctx.shadowBlur = 18;
    if (e.type === "maw") {                              // a black mouth with a green rim
      ctx.fillStyle = C.black; ctx.strokeStyle = C.green; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.rotate(time * 1.5);
      for (var i = 0; i < 8; i++) { ctx.rotate(TAU / 8); ctx.beginPath(); ctx.moveTo(r * 0.55, 0); ctx.lineTo(r, -r * 0.15); ctx.lineTo(r, r * 0.15); ctx.closePath(); ctx.fillStyle = C.green; ctx.fill(); }
    } else {                                             // a ghost with a wavy hem, looking at you
      var a = Math.atan2(e.vy, e.vx), sq = e.type === "darter" ? 0.7 : 1;
      ctx.fillStyle = e.type === "darter" ? C.green : "#c8ffd8";
      ctx.beginPath();
      ctx.arc(0, -r * 0.2, r * sq, Math.PI, 0);
      for (var k = 0; k <= 6; k++) ctx.lineTo(r * sq - k * (2 * r * sq / 6), r * 0.8 + Math.sin(time * 10 + k + e.ph) * r * 0.2 * (k % 2 ? 1 : -1));
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = C.black;
      var ex = Math.cos(a) * r * 0.2, ey = Math.sin(a) * r * 0.2;
      ctx.beginPath(); ctx.arc(-r * 0.35 * sq + ex, -r * 0.3 + ey, r * 0.18, 0, TAU); ctx.arc(r * 0.35 * sq + ex, -r * 0.3 + ey, r * 0.18, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawPrediction() {
    if (ship.dead || state === "attract") return;
    // a copy of the ship falls ahead through the wells: where you'll be over the next couple of seconds
    var x = ship.x, y = ship.y, vx = ship.vx, vy = ship.vy, h = 1 / 60, n = Math.round(PREDICT_T / h);
    ctx.fillStyle = "#ffffff";
    for (var i = 1; i <= n; i++) {
      gravity(x, y, true);
      vx += AX * h; vy += AY * h;
      var v = Math.hypot(vx, vy); if (v > MAX_V) { vx *= MAX_V / v; vy *= MAX_V / v; }
      x += vx * h; y += vy * h;
      var hit = false;
      for (var j = 0; j < planets.length; j++) if (Math.hypot(x - planets[j].x, y - planets[j].y) < planets[j].r * planets[j].form + SHIP_R) hit = true;
      if (hit) {
        ctx.globalAlpha = 0.9; ctx.strokeStyle = C.pink; ctx.lineWidth = 2.5;
        var X = sx(x), Y = sy(y);
        ctx.beginPath(); ctx.moveTo(X - 6, Y - 6); ctx.lineTo(X + 6, Y + 6); ctx.moveTo(X + 6, Y - 6); ctx.lineTo(X - 6, Y + 6); ctx.stroke();
        break;
      }
      if (x < 0 || x > WW || y < 0 || y > WH) break;
      if (i % 4 === 0) {
        ctx.globalAlpha = 0.85 * (1 - i / n);
        ctx.fillRect(sx(x) - 1.5, sy(y) - 1.5, 3, 3);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawShip() {
    var t = ship.trail;
    if (t.length > 4) {                                  // the trail
      ctx.lineWidth = 2; ctx.strokeStyle = C.sky;
      for (var i = 2; i < t.length; i += 2) {
        ctx.globalAlpha = (i / t.length) * 0.6;
        ctx.beginPath(); ctx.moveTo(sx(t[i - 2]), sy(t[i - 1])); ctx.lineTo(sx(t[i]), sy(t[i + 1])); ctx.stroke();
      }
      if (!ship.dead) { ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(sx(t[t.length - 2]), sy(t[t.length - 1])); ctx.lineTo(sx(ship.x), sy(ship.y)); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    if (ship.dead || state === "attract") return;
    if (ship.invuln > 0 && Math.floor(time * 12) % 2) return;
    var s = Math.max(1, VS) * 1.1;
    ctx.save(); ctx.translate(sx(ship.x), sy(ship.y)); ctx.rotate(ship.ang); ctx.scale(s, s);
    if (thrusting && keys.up || (thrusting && touch.on)) {
      ctx.fillStyle = C.pink; ctx.shadowColor = C.pink; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.moveTo(-7, -3.5); ctx.lineTo(-13 - Math.random() * 8, 0); ctx.lineTo(-7, 3.5); ctx.closePath(); ctx.fill();
    }
    ctx.shadowColor = C.sky; ctx.shadowBlur = 16;
    ctx.fillStyle = C.navy; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.8; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, -7); ctx.lineTo(-4, 0); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = C.sky;
    ctx.beginPath(); ctx.arc(2, 0, 2, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawOrbs() {
    for (var i = 0; i < orbs.length; i++) {
      var o = orbs[i], x = sx(o.x), y = sy(o.y), r = (6 + Math.sin(time * 5 + i) * 1.5) * VS * o.in;
      ctx.shadowColor = C.sky; ctx.shadowBlur = 18;
      ctx.fillStyle = C.sky; ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, TAU); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      if (o.p) {                                         // a faint arc showing the orbit it rides
        ctx.strokeStyle = C.sky; ctx.globalAlpha = 0.18; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx(o.p.x), sy(o.p.y), o.R * VS, o.a - 0.5 * Math.sign(o.w), o.a, o.w < 0); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawDebrisAndWaves() {
    for (var i = 0; i < waves.length; i++) {
      var w = waves[i], k = 1 - w.r / w.max;
      ctx.strokeStyle = "#ffffff"; ctx.shadowColor = C.pink; ctx.shadowBlur = 25;
      ctx.globalAlpha = k; ctx.lineWidth = 2 + 8 * k;
      ctx.beginPath(); ctx.arc(sx(w.x), sy(w.y), w.r * VS, 0, TAU); ctx.stroke();
      ctx.strokeStyle = C.pink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx(w.x), sy(w.y), w.r * VS * 0.85, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (i = 0; i < debris.length; i++) {
      var b = debris[i];
      ctx.save(); ctx.translate(sx(b.x), sy(b.y)); ctx.rotate(b.rot);
      ctx.fillStyle = "#3a0f38"; ctx.strokeStyle = C.pink; ctx.shadowColor = C.pink; ctx.shadowBlur = 10; ctx.lineWidth = 1.5;
      ctx.globalAlpha = Math.min(1, b.life);
      ctx.beginPath();
      for (var k2 = 0; k2 < b.sides; k2++) { var a = k2 / b.sides * TAU, rr2 = b.r * VS * (k2 % 2 ? 0.7 : 1); ctx[k2 ? "lineTo" : "moveTo"](Math.cos(a) * rr2, Math.sin(a) * rr2); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }

  function drawParticles(dt) {
    var drag = Math.exp(-1.8 * dt);
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= drag; p.vy *= drag;
      var k = p.life / p.max;
      ctx.globalAlpha = k; ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), (0.5 + p.s * k) * Math.max(0.7, VS), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "bold 16px Arial, sans-serif";
    for (i = popups.length - 1; i >= 0; i--) {
      var q = popups[i];
      q.life -= dt; q.y -= 30 * dt;
      if (q.life <= 0) { popups.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, q.life * 2); ctx.fillStyle = q.c;
      ctx.fillText(q.t, sx(q.x), sy(q.y));
    }
    ctx.globalAlpha = 1;
  }

  function centreText(t, y, size, col, glow) {
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold " + size + "px 'Arial Black', Arial, sans-serif";
    ctx.shadowColor = col; ctx.shadowBlur = glow ? 22 : 0;
    ctx.fillStyle = col; ctx.fillText(t, W / 2, y);
    ctx.shadowBlur = 0;
  }

  function drawHudCanvas() {
    if (state === "attract") return;
    // fuel
    var bw = Math.min(260, W * 0.4), x = 14, y = H - 30;
    ctx.fillStyle = "#c2c2c2"; ctx.font = "bold 13px Arial, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText("FUEL", x, y - 14);
    ctx.fillStyle = C.navy; ctx.fillRect(x, y, bw, 10);
    ctx.fillStyle = ship.fuel < 25 && Math.floor(time * 4) % 2 ? C.pink : C.green;
    ctx.fillRect(x, y, bw * ship.fuel / 100, 10);
    ctx.strokeStyle = C.deep; ctx.lineWidth = 1; ctx.strokeRect(x, y, bw, 10);
    if (touch.on) {                                     // the touch stick
      ctx.strokeStyle = C.sky; ctx.globalAlpha = 0.5; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(touch.x0, touch.y0, 50, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(touch.x0 + clamp(touch.x - touch.x0, -50, 50), touch.y0 + clamp(touch.y - touch.y0, -50, 50), 18, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawOverlays() {
    if (flashT > 0) { ctx.globalAlpha = Math.min(0.5, flashT * 1.5); ctx.fillStyle = flashCol; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    if (bannerT > 0 && state !== "attract") {
      ctx.globalAlpha = Math.min(1, bannerT * 1.5);
      centreText(bannerText, H * 0.3, Math.min(72, W / 10), C.pink, true);
      centreText(bannerSub, H * 0.3 + Math.min(54, W / 13), Math.min(22, W / 26), C.sky, false);
      ctx.globalAlpha = 1;
    }
    if (paused || state === "over") {
      ctx.fillStyle = "rgba(2, 6, 17, 0.65)"; ctx.fillRect(0, 0, W, H);
      centreText(paused ? "PAUSED" : "GAME OVER", H / 2 - 30, Math.min(84, W / 8), C.pink, true);
      ctx.font = "20px Arial, sans-serif"; ctx.fillStyle = "#ffffff";
      ctx.fillText(paused ? "P to carry on" : "Score " + score + "  ·  Wave " + wave, W / 2, H / 2 + 28);
      if (!paused) {
        var nb = score >= best && score > 0;
        ctx.fillStyle = nb ? C.green : C.sky; ctx.fillText(nb ? "A new best!" : "Best " + best, W / 2, H / 2 + 60);
        ctx.fillStyle = "#c2c2c2"; ctx.fillText("Space, Enter or tap to fly again", W / 2, H / 2 + 96);
      }
    }
  }

  function draw(dt) {
    ctx.save();
    if (shakeT > 0) ctx.translate((Math.random() - 0.5) * shakeT * 16, (Math.random() - 0.5) * shakeT * 16);
    drawBackground();
    drawWells();
    drawPrediction();
    drawOrbs();
    for (var i = 0; i < planets.length; i++) drawPlanet(planets[i]);
    drawDebrisAndWaves();
    for (i = 0; i < enemies.length; i++) drawEnemy(enemies[i]);
    drawShip();
    drawParticles(dt);
    ctx.restore();
    drawHudCanvas();
    drawOverlays();
  }

  // ---- the loop -------------------------------------------------------------------------------------------------
  var last = 0;
  function loop(now) {
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    if (!paused && state !== "over") {
      acc += dt;
      while (acc >= DT) { step(DT); acc -= DT; }
    } else if (state === "over") { time += dt; }
    bannerT = Math.max(0, bannerT - (paused ? 0 : dt));
    flashT = Math.max(0, flashT - dt);
    shakeT = Math.max(0, shakeT - dt);
    draw(paused ? 0 : dt);
    if (state === "play" || state === "clear") updateHud();
    requestAnimationFrame(loop);
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!started) worldSize();
    view();
    makeStars();
  }

  function start() {
    if (started) return;
    started = true;
    splash.classList.add("gone");
    document.body.classList.add("playing");
    worldSize(); view();
    newGame(1);
  }
  function togglePause() {
    if (state === "over" || !started) return;
    paused = !paused;
    Sfx.music(!paused, wave);
    if (paused) Sfx.thrust(false);
  }
  function restart() { if (state === "over" && time - overT > 0.8) newGame(1); }

  function keyName(e) { return e.key.length === 1 ? e.key.toLowerCase() : e.key; }
  var MAP = { ArrowLeft: "left", a: "left", ArrowRight: "right", d: "right", ArrowUp: "up", w: "up", ArrowDown: "down", s: "down" };
  document.addEventListener("keydown", function (e) {
    var k = keyName(e);
    if (!started) { start(); e.preventDefault(); return; }
    if (k === "m") { Sfx.toggleMute(); lastHud = ""; updateHud(); }
    else if (k === "p" || k === "Escape") togglePause();
    else if (state === "over" && (k === " " || k === "Enter" || k === "r")) restart();
    else if (MAP[k]) keys[MAP[k]] = true;
    else if (k !== " ") return;
    e.preventDefault();
  });
  document.addEventListener("keyup", function (e) { var k = MAP[keyName(e)]; if (k) keys[k] = false; });
  window.addEventListener("blur", function () { keys.left = keys.right = keys.up = keys.down = false; touch.on = false; if (state === "play" && !paused) togglePause(); });

  splash.addEventListener("pointerdown", function (e) { e.preventDefault(); start(); });
  canvas.addEventListener("pointerdown", function (e) {
    if (state === "over") { restart(); return; }
    if (e.pointerType === "mouse" || touch.on) return;
    touch = { on: true, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("pointermove", function (e) { if (touch.on && e.pointerId === touch.id) { touch.x = e.clientX; touch.y = e.clientY; } });
  ["pointerup", "pointercancel"].forEach(function (ev) { canvas.addEventListener(ev, function (e) { if (e.pointerId === touch.id) touch.on = false; }); });
  function hold(id, on, off) {
    var b = document.getElementById(id);
    b.addEventListener("pointerdown", function (e) { e.preventDefault(); e.stopPropagation(); b.classList.add("down"); on(); });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) { b.addEventListener(ev, function () { b.classList.remove("down"); if (off) off(); }); });
  }
  hold("t-brake", function () { brakeBtn = true; }, function () { brakeBtn = false; });
  hold("t-pause", togglePause);
  window.addEventListener("resize", resize);

  // a peek for the tests
  window.orbitDebug = {
    get: function () {
      return { state: state, wave: wave, lives: lives, score: score, orbs: orbsGot + "/" + orbsNeed, fuel: Math.round(ship.fuel),
               planets: planets.length, enemies: enemies.length, warn: planets.filter(function (p) { return p.warn >= 0; }).length, paused: paused,
               ship: [Math.round(ship.x), Math.round(ship.y), Math.round(Math.hypot(ship.vx, ship.vy))] };
    },
    blowNext: function () { if (planets[0]) planets[0].timer = 0; },
    clearWave: function () { if (state === "play") waveClear(); },
    invuln: function (t) { ship.invuln = t; }
  };

  resize();
  seed = 4242;
  wave = 2; lives = 3; score = 0;
  ship = { x: 0, y: 0, vx: 0, vy: 0, ang: 0, fuel: 100, invuln: 1e9, trail: [], dead: false };
  particles = []; popups = [];
  startWave();
  state = "attract"; bannerT = 0;

  if (shotMode) {
    // for README screenshots: wave 3, one planet just blown, another counting down, ghosts closing in
    splash.style.display = "none";
    started = true;
    document.body.classList.add("playing");
    seed = 3131;
    newGame(3);
    planets.sort(function (a, b) { return a.x - b.x; });
    planets[0].timer = 0.6;
    planets[planets.length - 1].timer = 2.5;
    for (var i = 0; i < enemies.length; i++) enemies[i].in = 0;
    for (var t = 0; t < 5.6; t += DT) {
      ship.invuln = 10;
      keys.up = t > 5.2;
      step(DT);
      if (Math.round(t / DT) % 2 === 0) draw(DT * 2);
    }
    ship.invuln = 0; bannerT = 0; flashT = 0; shakeT = 0;
    score = 4850; orbsGot = 6; ship.fuel = 64;
    draw(1 / 60);
    keys.up = false;
    lastHud = ""; updateHud();
    return;
  }
  requestAnimationFrame(loop);
})();
