// ORBIT's sound, all made with the Web Audio API (no files): the engine's hiss while you thrust, orb chimes, the tick
// of a planet counting down, the boom when it goes, crashes, and a slow, eerie bass under it all. Browsers only allow
// sound after a key or tap, so the audio starts on the first one. M mutes (remembered between visits).
var Sfx = (function () {
  "use strict";
  var ctx = null, out = null, musicBus = null, engine = null, engineGain = null;
  var muted = localStorage.getItem("orbitMute") === "1";

  function wake() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      out = ctx.createGain();
      out.gain.value = muted ? 0 : 0.35;
      out.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.5;
      musicBus.connect(out);
      // the engine: looping noise through a low filter, faded in and out while you thrust
      var n = ctx.sampleRate, buf = ctx.createBuffer(1, n, n), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      engine = ctx.createBufferSource(); engine.buffer = buf; engine.loop = true;
      var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 700;
      engineGain = ctx.createGain(); engineGain.gain.value = 0;
      engine.connect(f); f.connect(engineGain); engineGain.connect(out);
      engine.start();
    }
    if (ctx.state === "suspended") ctx.resume();
  }
  ["keydown", "pointerdown", "touchstart"].forEach(function (e) { document.addEventListener(e, wake, true); });

  function tone(type, f0, f1, at, len, vol, dest) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + len);
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + len);
    o.connect(g); g.connect(dest || out);
    o.start(at); o.stop(at + len + 0.02);
  }

  function noise(at, len, vol, freq, type, dest) {
    var n = Math.floor(ctx.sampleRate * len), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = buf;
    f.type = type || "lowpass"; f.frequency.value = freq || 2000;
    g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(dest || out);
    s.start(at);
  }

  // the music: a slow minor bass walk with a ghostly bell now and then
  var BASS = [0, 0, 0, 0, 3, 3, 0, 0, -2, -2, -2, -2, -5, -5, -4, -4];
  var BELL = [12, 15, 19, 22, 24, 19, 15, 10];
  var playing = false, nextT = 0, step = 0, bpm = 96, timer = null;
  function schedule() {
    if (!ctx || !playing) return;
    while (nextT < ctx.currentTime + 0.2) {
      var stepLen = 60 / bpm / 2;
      if (step % 2 === 0) {
        var f = 55 * Math.pow(2, BASS[(step >> 1) % 16] / 12);
        var o = ctx.createOscillator(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = "sawtooth"; o.frequency.value = f;
        flt.type = "lowpass"; flt.frequency.setValueAtTime(500, nextT); flt.frequency.exponentialRampToValueAtTime(120, nextT + stepLen * 1.8);
        g.gain.setValueAtTime(0.0001, nextT); g.gain.exponentialRampToValueAtTime(0.18, nextT + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, nextT + stepLen * 1.9);
        o.connect(flt); flt.connect(g); g.connect(musicBus);
        o.start(nextT); o.stop(nextT + stepLen * 2);
      }
      if (step % 4 === 2) noise(nextT, 0.04, 0.04, 8000, "highpass", musicBus);
      if (step % 12 === 7) {
        var bf = 220 * Math.pow(2, BELL[(step / 12 | 0) % 8] / 12);
        tone("sine", bf, bf, nextT, 1.6, 0.06, musicBus);
        tone("triangle", bf * 2.01, bf * 2.01, nextT, 0.8, 0.02, musicBus);
      }
      nextT += stepLen;
      step++;
    }
  }

  return {
    toggleMute: function () {
      muted = !muted;
      localStorage.setItem("orbitMute", muted ? "1" : "0");
      if (out) out.gain.setTargetAtTime(muted ? 0 : 0.35, ctx.currentTime, 0.02);
      return muted;
    },
    isMuted: function () { return muted; },
    music: function (on, wave) {
      bpm = Math.min(140, 92 + (wave || 1) * 4);
      if (on && !playing) {
        if (!ctx) return;
        playing = true; nextT = ctx.currentTime + 0.05; step = 0;
        timer = setInterval(schedule, 50);
      } else if (!on && playing) {
        playing = false; clearInterval(timer);
      }
    },
    thrust: function (on) {
      if (!ctx) return;
      engineGain.gain.setTargetAtTime(on ? 0.22 : 0, ctx.currentTime, 0.04);
    },
    orb: function (combo) {
      if (!ctx) return;
      var t = ctx.currentTime, up = Math.pow(2, Math.min(combo, 12) / 12);
      tone("triangle", 660 * up, 660 * up, t, 0.1, 0.35);
      tone("sine", 990 * up, 1320 * up, t + 0.06, 0.25, 0.3);
      tone("sine", 1980 * up, 1980 * up, t + 0.12, 0.3, 0.08);
    },
    tick: function (left) {            // the countdown, higher as it runs out
      if (!ctx) return;
      var t = ctx.currentTime, f = 1200 - left * 120;
      tone("square", f, f, t, 0.06, 0.08);
      tone("sine", f / 2, f / 2, t, 0.12, 0.15);
    },
    boom: function (near) {            // a planet goes: a deep boom, rumble and crackle
      if (!ctx) return;
      var t = ctx.currentTime, v = 0.4 + 0.6 * near;
      noise(t, 2.2, 0.9 * v, 400);
      noise(t, 0.6, 0.4 * v, 3000, "bandpass");
      tone("sine", 120, 20, t, 1.8, 0.6 * v);
      tone("sawtooth", 80, 25, t, 1.2, 0.2 * v);
    },
    crash: function () {
      if (!ctx) return;
      var t = ctx.currentTime;
      noise(t, 0.9, 0.7, 1200);
      tone("square", 900, 60, t, 0.6, 0.2);
      tone("sine", 300, 30, t, 0.8, 0.4);
    },
    pop: function () {                 // an enemy dies
      if (!ctx) return;
      var t = ctx.currentTime;
      tone("square", 1400, 200, t, 0.25, 0.12);
      noise(t, 0.25, 0.3, 2500, "bandpass");
    },
    spawn: function () {               // an enemy comes through
      if (!ctx) return;
      var t = ctx.currentTime;
      tone("sawtooth", 60, 240, t, 0.6, 0.08);
      tone("sine", 90, 360, t, 0.6, 0.15);
    },
    bump: function () {
      if (!ctx) return;
      tone("triangle", 200, 90, ctx.currentTime, 0.12, 0.2);
    },
    clear: function () {
      if (!ctx) return;
      var t = ctx.currentTime, notes = [0, 4, 7, 12, 16, 19, 24];
      for (var i = 0; i < notes.length; i++) tone("square", 330 * Math.pow(2, notes[i] / 12), 330 * Math.pow(2, notes[i] / 12), t + i * 0.07, 0.2, 0.1);
    },
    start: function () {
      if (!ctx) return;
      var t = ctx.currentTime;
      tone("sine", 110, 880, t, 0.7, 0.2);
      tone("triangle", 220, 1760, t + 0.1, 0.6, 0.08);
    },
    over: function () {
      if (!ctx) return;
      var t = ctx.currentTime;
      tone("square", 330, 82, t, 1.2, 0.15);
      tone("triangle", 220, 55, t + 0.2, 1.4, 0.35);
    }
  };
})();
