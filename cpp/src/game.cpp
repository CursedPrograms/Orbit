// game.cpp - ORBIT, an Arcade Phantasm game by Cursed Entertainment, ported from the browser's site/game.js and
// site/sfx.js. A tiny spacecraft caught between gravitational fields. Every planet pulls (inverse square, the faint
// rings show its well); your thrust is weak and your fuel short, so gravity is how you really move: fall round a
// planet, slingshot to the next, grab the energy orbs. The ghosts that hunt you pull too. And the planets don't last:
// one cracks, glows, counts down, and goes, with a shockwave and debris, and its well is gone. The dotted line shows
// where you'll fall. Physics runs on a fixed 120 Hz step.
#include "game.h"
#include "splash.h"
#include "synth.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace {
constexpr float PI = 3.14159265358979f, TAU = PI * 2;
float frand() { return Synth::rand01(); }            // Math.random()

// ---- the sound (site/sfx.js) ------------------------------------------------------------------------------------
namespace Sfx {
using namespace Synth;
bool awake = false, muted = false;
int musicBus = 0, engine = 0;

void wake() {                                       // the browser starts its audio on the first key or tap
    if (awake || !Synth::ready()) return;
    awake = true;
    busGain(0, muted ? 0.f : 0.35f);
    musicBus = addBus(0.5f);
    // the engine: looping noise through a low filter, faded in and out while you thrust
    Voice v;
    v.wave = NoiseLoop; v.filter = Lowpass; v.cutoff = Param(700); v.gain = Param(0);
    engine = play(v);
}

// the music: a slow minor bass walk with a ghostly bell now and then
const int BASS[16] = {0, 0, 0, 0, 3, 3, 0, 0, -2, -2, -2, -2, -5, -5, -4, -4};
const int BELL[8] = {12, 15, 19, 22, 24, 19, 15, 10};
bool playing = false;
double nextT = 0;
int step = 0;
float bpm = 96;

void schedule() {
    if (!awake || !playing) return;
    while (nextT < now() + 0.2) {
        const double stepLen = 60.0 / bpm / 2;
        if (step % 2 == 0) {
            const float f = 55.f * std::pow(2.f, BASS[(step >> 1) % 16] / 12.f);
            Voice v;
            v.wave = Sawtooth; v.freq = Param(f);
            v.filter = Lowpass;
            v.cutoff.set(500, nextT).expTo(120, nextT + stepLen * 1.8);
            v.gain.set(0.0001f, nextT).expTo(0.18f, nextT + 0.04).expTo(0.001f, nextT + stepLen * 1.9);
            v.start = nextT; v.stop = nextT + stepLen * 2; v.bus = musicBus;
            play(v);
        }
        if (step % 4 == 2) noise(nextT, 0.04f, 0.04f, 8000, Highpass, musicBus);
        if (step % 12 == 7) {
            const float bf = 220.f * std::pow(2.f, BELL[(step / 12) % 8] / 12.f);
            tone(Sine, bf, bf, nextT, 1.6f, 0.06f, musicBus);
            tone(Triangle, bf * 2.01f, bf * 2.01f, nextT, 0.8f, 0.02f, musicBus);
        }
        nextT += stepLen;
        step++;
    }
}

bool toggleMute() {
    muted = !muted;
    Platform::store("orbitMute", muted ? "1" : "0");
    if (awake) busGain(0, muted ? 0.f : 0.35f, 0.02f);
    return muted;
}
bool isMuted() { return muted; }
void music(bool on, int wave = 1) {
    bpm = std::min(140.f, 92.f + wave * 4.f);
    if (on && !playing) {
        if (!awake) return;
        playing = true; nextT = now() + 0.05; step = 0;
    } else if (!on && playing) playing = false;
}
void thrust(bool on) {
    if (!awake) return;
    target(engine, Gain, on ? 0.22f : 0.f, 0.04f);
}
void orb(int combo) {
    if (!awake) return;
    const double t = now();
    const float up = std::pow(2.f, std::min(combo, 12) / 12.f);
    tone(Triangle, 660 * up, 660 * up, t, 0.1f, 0.35f);
    tone(Sine, 990 * up, 1320 * up, t + 0.06, 0.25f, 0.3f);
    tone(Sine, 1980 * up, 1980 * up, t + 0.12, 0.3f, 0.08f);
}
void tick(int left) {                               // the countdown, higher as it runs out
    if (!awake) return;
    const double t = now();
    const float f = 1200.f - left * 120.f;
    tone(Square, f, f, t, 0.06f, 0.08f);
    tone(Sine, f / 2, f / 2, t, 0.12f, 0.15f);
}
void boom(float near) {                             // a planet goes: a deep boom, rumble and crackle
    if (!awake) return;
    const double t = now();
    const float v = 0.4f + 0.6f * near;
    noise(t, 2.2f, 0.9f * v, 400);
    noise(t, 0.6f, 0.4f * v, 3000, Bandpass);
    tone(Sine, 120, 20, t, 1.8f, 0.6f * v);
    tone(Sawtooth, 80, 25, t, 1.2f, 0.2f * v);
}
void crash() {
    if (!awake) return;
    const double t = now();
    noise(t, 0.9f, 0.7f, 1200);
    tone(Square, 900, 60, t, 0.6f, 0.2f);
    tone(Sine, 300, 30, t, 0.8f, 0.4f);
}
void pop() {                                        // an enemy dies
    if (!awake) return;
    const double t = now();
    tone(Square, 1400, 200, t, 0.25f, 0.12f);
    noise(t, 0.25f, 0.3f, 2500, Bandpass);
}
void spawn() {                                      // an enemy comes through
    if (!awake) return;
    const double t = now();
    tone(Sawtooth, 60, 240, t, 0.6f, 0.08f);
    tone(Sine, 90, 360, t, 0.6f, 0.15f);
}
void bump() {
    if (!awake) return;
    tone(Triangle, 200, 90, now(), 0.12f, 0.2f);
}
void clear() {
    if (!awake) return;
    const double t = now();
    const int notes[] = {0, 4, 7, 12, 16, 19, 24};
    for (int i = 0; i < 7; i++) {
        const float f = 330.f * std::pow(2.f, notes[i] / 12.f);
        tone(Square, f, f, t + i * 0.07, 0.2f, 0.1f);
    }
}
void start() {
    if (!awake) return;
    const double t = now();
    tone(Sine, 110, 880, t, 0.7f, 0.2f);
    tone(Triangle, 220, 1760, t + 0.1, 0.6f, 0.08f);
}
void over() {
    if (!awake) return;
    const double t = now();
    tone(Square, 330, 82, t, 1.2f, 0.15f);
    tone(Triangle, 220, 55, t + 0.2, 1.4f, 0.35f);
}
}  // namespace Sfx

// ---- the game (site/game.js) ------------------------------------------------------------------------------------
namespace C {
const Color navy("#001725"), deep("#005184"), blue("#007ab7"), sky("#34a9e3"), pink("#f088e9"), green("#39ff6a"),
    black("#020611"), white("#ffffff");
}

// physics
constexpr float DT = 1.f / 120, G_K = 1500, SOFT = 12, THRUST = 115, ROT = 4.2f, FUEL_USE = 20, FUEL_REGEN = 1.6f, MAX_V = 650;
constexpr float SHIP_R = 6, PREDICT_T = 2.4f, WARN_T = 5, INVULN = 2.5f;

uint32_t seed = 1;
float rnd() {
    seed += 0x6D2B79F5u;
    uint32_t t = (seed ^ (seed >> 15)) * (1u | seed);
    t = (t + (t ^ (t >> 7)) * (61u | t)) ^ t;
    return (float)((t ^ (t >> 14)) / 4294967296.0);
}
float rr(float a, float b) { return a + (b - a) * rnd(); }
float clamp(float v, float a, float b) { return v < a ? a : v > b ? b : v; }

struct Planet {
    float x, y, r, gm, form = 0, timer = 0, warn = -1, warnMax = 1;
    int lastTick = 0;
    std::vector<std::vector<std::pair<float, float>>> cracks;
    int hue = 0;
    float rot = 0;
    int bands = 2;
    bool dead = false;
};
using PlanetP = std::shared_ptr<Planet>;
struct Enemy { int id; std::string type; float x, y, vx, vy, in, ph, dash, r, gm, acc, max; };
struct Orb { PlanetP p; float R = 0, w = 0, a = 0, x = 0, y = 0, vx = 0, vy = 0, in = 0; };
struct Debris { float x, y, vx, vy, r, rot, vr, life; int sides; };
struct Wave { float x, y, r, max, sp; std::vector<int> hit; };   // hit: enemy ids, -1 for the ship
struct Particle { float x, y, vx, vy, life, max; Color c; float s; };
struct Popup { float x, y; std::string t; Color c; float life; };
struct Star { float x, y, r, t, s; };
struct Ship { float x = 0, y = 0, vx = 0, vy = 0, ang = 0, fuel = 100, invuln = 0; std::vector<float> trail; bool dead = false; float lastTrail = 0; };

float W = 0, H = 0, WW = 1600, WH = 1000, VS = 1, VX = 0, VY = 0;
Ship ship;
std::vector<PlanetP> planets;
std::vector<Enemy> enemies;
std::vector<Orb> orbs;
std::vector<Debris> debris;
std::vector<Wave> waves;
std::vector<Particle> particles;
std::vector<Star> stars;
std::vector<Popup> popups;
std::vector<float> reformT;
std::string state = "attract";
bool paused = false, started_ = false;
float time_ = 0, acc = 0;
int wave, lives, score, orbsGot, orbsNeed, combo;
float comboT, spawnT, orbT, bannerT, shakeT, flashT, overT = 0, clearT = 0, respawnT = 0;
std::string bannerText, bannerSub;
Color flashCol;
bool thrusting = false;
struct { bool left = false, right = false, up = false, down = false; } keys;
int best = 0, nextEnemyId = 1;
double last = 0;
float splashFade = 1;
Texture logo;
Canvas* ctx = nullptr;

// ---- the world ------------------------------------------------------------------------------------------------
void worldSize() {
    if (W >= H) { WH = 1000; WW = clamp(1000 * W / H, 1100, 1900); }
    else { WW = 1000; WH = clamp(1000 * H / W, 1100, 1900); }
}
void view() {
    VS = std::min(W / WW, H / WH);
    VX = (W - WW * VS) / 2; VY = (H - WH * VS) / 2;
}

PlanetP makePlanet(float x, float y, float r) {
    auto p = std::make_shared<Planet>();
    for (int i = 0; i < 7; i++) {                         // the cracks that open up before it blows
        float a = rnd() * TAU, d = 0;
        std::vector<std::pair<float, float>> pts = {{0.f, 0.f}};
        while (d < 1) { d += rr(0.15f, 0.35f); a += rr(-0.6f, 0.6f); pts.push_back({std::cos(a) * std::min(d, 1.f), std::sin(a) * std::min(d, 1.f)}); }
        p->cracks.push_back(pts);
    }
    p->x = x; p->y = y; p->r = r; p->gm = G_K * r * r;
    p->hue = rnd() < 0.5f ? 0 : 1; p->rot = rnd() * TAU; p->bands = 2 + (int)std::floor(rnd() * 3);
    return p;
}

bool freeSpot(float r, float gap, float& ox, float& oy) {
    for (int tries = 0; tries < 200; tries++) {
        const float x = rr(r + 110, WW - r - 110), y = rr(r + 110, WH - r - 110);
        bool ok = true;
        for (auto& p : planets) if (std::hypot(p->x - x, p->y - y) < p->r + r + gap) { ok = false; break; }
        if (ok && std::hypot(ship.x - x, ship.y - y) < r + 120) ok = false;
        if (ok) { ox = x; oy = y; return true; }
    }
    return false;
}

float explodeDelay() { return std::max(6.f, rr(16, 26) - wave * 1.6f); }

void layout() {
    planets.clear(); enemies.clear(); orbs.clear(); debris.clear(); waves.clear(); reformT.clear();
    const int n = std::min(6, 1 + (int)std::ceil(wave * 0.75f) + (wave == 1 ? 1 : 0));
    for (int i = 0; i < n; i++) {
        const float r = rr(34, 66);
        float x, y;
        if (!freeSpot(r, 230, x, y) && !freeSpot(r, 150, x, y)) continue;
        PlanetP p = makePlanet(x, y, r);
        p->form = 1;
        p->timer = explodeDelay() + i * rr(4, 8) + (wave == 1 ? 8 : 0);
        planets.push_back(p);
    }
}

// put the ship into a circular orbit round the planet that's furthest from trouble
void placeShip() {
    PlanetP bestP;
    float bestD = -1;
    for (auto& p : planets) {
        if (p->dead || p->warn >= 0 || p->form < 1) continue;
        float dmin = 1e9f;
        for (auto& e : enemies) dmin = std::min(dmin, std::hypot(e.x - p->x, e.y - p->y));
        if (dmin > bestD) { bestD = dmin; bestP = p; }
    }
    const float a = rnd() * TAU;
    if (!bestP) { ship.x = WW / 2; ship.y = WH / 2; ship.vx = ship.vy = 0; return; }
    const float R = bestP->r * 2.4f, v = std::sqrt(bestP->gm / std::sqrt(R * R + SOFT * SOFT));
    ship.x = bestP->x + std::cos(a) * R; ship.y = bestP->y + std::sin(a) * R;
    ship.vx = -std::sin(a) * v; ship.vy = std::cos(a) * v;
    ship.ang = std::atan2(ship.vy, ship.vx);
    ship.trail.clear();
}

int enemyTarget() {
    return 1 + wave / 2 + (wave >= 3 ? 1 + (wave - 3) / 3 : 0) + (wave >= 4 ? (wave - 2) / 2 : 0);
}
int countType(const std::string& t) { int n = 0; for (auto& e : enemies) if (e.type == t) n++; return n; }

void spawnEnemy(std::string type = "") {
    if (type.empty()) {
        const float r = rnd();
        type = wave >= 4 && r < 0.3f ? "darter" : wave >= 3 && r < 0.5f && countType("maw") < 1 + (wave - 3) / 3 ? "maw" : "wisp";
    }
    const int side = (int)std::floor(rnd() * 4);
    float x, y;
    if (side == 0) { x = rr(60, WW - 60); y = 40; } else if (side == 1) { x = WW - 40; y = rr(60, WH - 60); }
    else if (side == 2) { x = rr(60, WW - 60); y = WH - 40; } else { x = 40; y = rr(60, WH - 60); }
    if (std::hypot(ship.x - x, ship.y - y) < 300) { x = WW - x; y = WH - y; }
    Enemy e{nextEnemyId++, type, x, y, 0, 0, 1.4f, rnd() * TAU, rr(2, 4), 0, 0, 0, 0};
    if (type == "wisp") { e.r = 11; e.gm = 2.6e5f; e.acc = 75; e.max = 175; }
    else if (type == "maw") { e.r = 20; e.gm = 1.3e6f; e.acc = 22; e.max = 65; }
    else { e.r = 8; e.gm = 1.6e5f; e.acc = 150; e.max = 320; }
    enemies.push_back(e);
    if (state == "play") Sfx::spawn();
}

void spawnOrb() {
    std::vector<PlanetP> live;
    for (auto& p : planets) if (!p->dead && p->warn < 0 && p->form >= 1) live.push_back(p);
    if (!live.empty() && rnd() < 0.7f) {                  // most orbs ride an orbit round a planet: match it to catch one
        PlanetP p = live[(size_t)std::floor(rnd() * live.size()) % live.size()];
        const float R = p->r * rr(1.8f, 3.4f), v = std::sqrt(p->gm / std::sqrt(R * R + SOFT * SOFT));
        Orb o;
        o.p = p; o.R = R; o.w = (rnd() < 0.5f ? -1 : 1) * v / R; o.a = rnd() * TAU;
        orbs.push_back(o);
    } else {
        for (int t = 0; t < 30; t++) {
            const float x = rr(80, WW - 80), y = rr(80, WH - 80);
            bool ok = true;
            for (auto& p : planets) if (std::hypot(p->x - x, p->y - y) < p->r + 50) ok = false;
            if (ok) { Orb o; o.x = x; o.y = y; o.vx = rr(-15, 15); o.vy = rr(-15, 15); orbs.push_back(o); return; }
        }
    }
}

// ---- gravity --------------------------------------------------------------------------------------------------
float AX = 0, AY = 0;
void gravity(float x, float y, bool withEnemies) {
    AX = 0; AY = 0;
    for (auto& p : planets) {
        if (p->dead) continue;
        const float dx = p->x - x, dy = p->y - y, d2 = dx * dx + dy * dy + SOFT * SOFT, d = std::sqrt(d2), a = p->gm * p->form / d2;
        AX += a * dx / d; AY += a * dy / d;
    }
    if (withEnemies) {
        for (auto& e : enemies) {
            if (e.in > 0) continue;
            const float dx = e.x - x, dy = e.y - y, d2 = dx * dx + dy * dy + 900, d = std::sqrt(d2), a = e.gm / d2;
            AX += a * dx / d; AY += a * dy / d;
        }
    }
}

// ---- the game -------------------------------------------------------------------------------------------------
void banner(const std::string& t, const std::string& sub = "") { bannerText = t; bannerSub = sub; bannerT = 3.2f; }
void flash(const Color& c, float t) { flashCol = c; flashT = t; }

void startWave() {
    orbsGot = 0; orbsNeed = 5 + 2 * wave; combo = 0; comboT = 0;
    seed = seed + (uint32_t)(wave * 7919);
    layout();
    for (int i = 0; i < enemyTarget(); i++) spawnEnemy(i == 0 ? "wisp" : "");
    for (size_t i = 0; i < enemies.size(); i++) enemies[i].in = 1.4f + i * 0.6f;
    placeShip();
    ship.fuel = 100; ship.invuln = INVULN; ship.dead = false;
    for (int i = 0; i < 3 + std::min(wave, 3); i++) spawnOrb();
    spawnT = 9; orbT = 2;
    banner("WAVE " + std::to_string(wave), wave == 1 ? "Fall round the planets. Thrust is weak, gravity is strong." :
           wave == 2 ? "Planets don't last. Get clear when the countdown starts." :
           wave == 3 ? "The maw: a ghost with a deep well of its own" : wave == 4 ? "Darters: fast and hungry" : "Faster, fiercer, more");
}

void newGame(int firstWave) {
    wave = firstWave; lives = 3; score = 0;
    ship = Ship();
    particles.clear(); popups.clear();
    startWave();
    state = "play";
    Sfx::start(); Sfx::music(true, wave);
}

void burst(float x, float y, int n, float speed, const std::vector<Color>& cols, float size, float life = 0.8f) {
    for (int i = 0; i < n; i++) {
        const float a = frand() * TAU, v = speed * (0.15f + frand() * 0.85f), l = life * (0.5f + frand() * 0.8f);
        particles.push_back({x, y, std::cos(a) * v, std::sin(a) * v, l, l, cols[(size_t)(frand() * cols.size()) % cols.size()], size * (0.5f + frand())});
    }
}

void popup(float x, float y, const std::string& text, const Color& col) { popups.push_back({x, y, text, col, 1.2f}); }

void killShip() {
    if (ship.dead) return;
    ship.dead = true;
    burst(ship.x, ship.y, 80, 320, {C::white, C::sky, C::pink}, 3, 1.2f);
    burst(ship.x, ship.y, 20, 120, {C::white}, 5, 0.6f);
    Sfx::crash(); Sfx::thrust(false);
    shakeT = 0.6f; flash(C::white, 0.3f);
    lives--;
    combo = 0;
    if (lives <= 0) {
        state = "over"; overT = time_;
        Sfx::music(false); Sfx::over();
        if (score > best) { best = score; Platform::store("orbitBest", std::to_string(best)); }
    } else {
        respawnT = 1.4f;
    }
}

void killEnemy(int id, const std::string& why) {
    auto it = std::find_if(enemies.begin(), enemies.end(), [id](const Enemy& e) { return e.id == id; });
    if (it == enemies.end()) return;
    const Enemy e = *it;
    enemies.erase(it);
    burst(e.x, e.y, 40, 240, {C::green, C::white, C::pink}, 3, 0.9f);
    if (state == "play") {
        const int pts = (e.type == "maw" ? 400 : e.type == "darter" ? 250 : 150) * wave;
        score += pts; popup(e.x, e.y - 20, "+" + std::to_string(pts) + " " + why, C::green);
        Sfx::pop();
    }
}

void explode(PlanetP p) {
    p->dead = true;
    const float near = clamp(1 - std::hypot(ship.x - p->x, ship.y - p->y) / 900, 0, 1);
    waves.push_back({p->x, p->y, p->r, 260 + p->r * 3.2f, 560, {}});
    for (int i = 0; i < 12 + (int)std::floor(p->r / 5); i++) {
        const float a = frand() * TAU, v = rr(140, 360);
        debris.push_back({p->x + std::cos(a) * p->r * 0.7f, p->y + std::sin(a) * p->r * 0.7f, std::cos(a) * v, std::sin(a) * v,
                          rr(4, 9), frand() * TAU, rr(-6, 6), rr(4, 6), 3 + (int)std::floor(frand() * 3)});
    }
    burst(p->x, p->y, 160, 520, {C::white, C::pink, C::pink, C::sky, Color("#ffd0f8")}, 4, 1.4f);
    burst(p->x, p->y, 40, 160, {C::white}, 8, 0.5f);
    // anything too close is caught in the blast
    if (!ship.dead && ship.invuln <= 0 && std::hypot(ship.x - p->x, ship.y - p->y) < p->r + 45 && state == "play") killShip();
    for (int i = (int)enemies.size() - 1; i >= 0; i--)
        if (i < (int)enemies.size() && std::hypot(enemies[i].x - p->x, enemies[i].y - p->y) < p->r + 45) killEnemy(enemies[i].id, "blast");
    // orbs riding its orbit fly off on their own
    for (Orb& o : orbs) {
        if (o.p != p) continue;
        o.vx = -std::sin(o.a) * o.w * o.R; o.vy = std::cos(o.a) * o.w * o.R;
        const float sp = std::hypot(o.vx, o.vy), k = std::min(1.f, 90 / sp);
        o.vx *= k; o.vy *= k; o.p.reset();
    }
    Sfx::boom(near);
    shakeT = 0.4f + near * 0.6f; flash(C::pink, 0.2f + near * 0.3f);
    reformT.push_back(rr(5, 8));
}

void edgeHit() {
    burst(ship.x, ship.y, 10, 120, {C::sky, C::white}, 2, 0.4f);
    if (state == "play") Sfx::bump();
}

void waveClear() {
    const int bonus = 1000 * wave + (int)std::floor(ship.fuel) * 10;
    score += bonus;
    banner("WAVE " + std::to_string(wave) + " CLEAR", "Bonus " + std::to_string(bonus) + " (fuel left counts)");
    Sfx::clear();
    flash(C::sky, 0.3f);
    state = "clear"; clearT = 2.8f;
    ship.invuln = 3.5f;
    if (wave % 2 == 0 && lives < 5) { lives++; popup(ship.x, ship.y - 30, "+1 life", C::green); }
}

bool hitHas(const Wave& w, int id) { return std::find(w.hit.begin(), w.hit.end(), id) != w.hit.end(); }

void step(float dt) {
    time_ += dt;
    const bool playing = state == "play";

    // the planets: count down, crack, blow; new ones form
    for (int i = (int)planets.size() - 1; i >= 0; i--) {
        PlanetP p = planets[i];
        p->rot += dt * 0.15f;
        if (p->form < 1) { p->form = std::min(1.f, p->form + dt / 2.2f); continue; }
        if (p->warn < 0) {
            p->timer -= dt;
            if (p->timer <= 0) { p->warn = std::max(3.4f, WARN_T - wave * 0.15f); p->warnMax = p->warn; p->lastTick = (int)std::ceil(p->warn); }
        } else {
            p->warn -= dt;
            if ((int)std::ceil(p->warn) < p->lastTick) { p->lastTick = (int)std::ceil(p->warn); if (playing) Sfx::tick(p->lastTick); }
            if (p->warn <= 0) { explode(p); planets.erase(std::find(planets.begin(), planets.end(), p)); }
        }
    }
    for (int i = (int)reformT.size() - 1; i >= 0; i--) {
        reformT[i] -= dt;
        if (reformT[i] <= 0) {
            reformT.erase(reformT.begin() + i);
            const float r = rr(34, 62);
            float x, y;
            if (freeSpot(r, 200, x, y)) { PlanetP np = makePlanet(x, y, r); np->timer = explodeDelay() + rr(2, 8); planets.push_back(np); }
        }
    }

    // the ship
    if (!ship.dead) {
        float turn = (keys.right ? 1.f : 0.f) - (keys.left ? 1.f : 0.f);
        bool thr = keys.up, brk = keys.down;
        if (state == "attract") { turn = 0; thr = false; brk = false; }
        ship.ang += turn * ROT * dt;
        gravity(ship.x, ship.y, true);
        float ax = AX, ay = AY;
        bool burning = false;
        if (thr && ship.fuel > 0) { ax += std::cos(ship.ang) * THRUST; ay += std::sin(ship.ang) * THRUST; burning = true; }
        if (brk && ship.fuel > 0) {
            const float sp = std::hypot(ship.vx, ship.vy);
            if (sp > 5) { ax -= ship.vx / sp * THRUST; ay -= ship.vy / sp * THRUST; burning = true; }
        }
        if (burning) {
            ship.fuel = std::max(0.f, ship.fuel - FUEL_USE * dt);
            if (frand() < 0.6f) {
                const float ba = thr ? ship.ang + PI : std::atan2(ship.vy, ship.vx) + (frand() - 0.5f);
                particles.push_back({ship.x + std::cos(ba) * 8, ship.y + std::sin(ba) * 8,
                                     std::cos(ba + (frand() - 0.5f) * 0.5f) * 140 + ship.vx, std::sin(ba + (frand() - 0.5f) * 0.5f) * 140 + ship.vy,
                                     0.35f, 0.35f, frand() < 0.5f ? C::pink : C::white, 2});
            }
        } else ship.fuel = std::min(100.f, ship.fuel + FUEL_REGEN * dt);
        if (burning != thrusting) { thrusting = burning; if (state == "play") Sfx::thrust(burning); }
        ship.vx += ax * dt; ship.vy += ay * dt;
        const float v = std::hypot(ship.vx, ship.vy);
        if (v > MAX_V) { ship.vx *= MAX_V / v; ship.vy *= MAX_V / v; }
        ship.x += ship.vx * dt; ship.y += ship.vy * dt;
        ship.invuln = std::max(0.f, ship.invuln - dt);
        // the edge of the arena gives you a jolt and sends you back
        if (ship.x < 8 || ship.x > WW - 8) { ship.vx = -ship.vx * 0.55f; ship.x = clamp(ship.x, 8, WW - 8); edgeHit(); }
        if (ship.y < 8 || ship.y > WH - 8) { ship.vy = -ship.vy * 0.55f; ship.y = clamp(ship.y, 8, WH - 8); edgeHit(); }
        // crashing into a planet
        for (auto& p : planets) {
            const float d = std::hypot(ship.x - p->x, ship.y - p->y);
            if (d < p->r * p->form + SHIP_R) {
                if (ship.invuln > 0 || state != "play") {     // bounce off while you're still blinking
                    const float nx = (ship.x - p->x) / d, ny = (ship.y - p->y) / d, vn = ship.vx * nx + ship.vy * ny;
                    ship.x = p->x + nx * (p->r * p->form + SHIP_R + 1); ship.y = p->y + ny * (p->r * p->form + SHIP_R + 1);
                    if (vn < 0) { ship.vx -= 1.6f * vn * nx; ship.vy -= 1.6f * vn * ny; }
                } else { killShip(); break; }
            }
        }
        if (time_ - ship.lastTrail > 0.03f) {
            ship.trail.push_back(ship.x); ship.trail.push_back(ship.y); ship.lastTrail = time_;
            if (ship.trail.size() > 120) ship.trail.erase(ship.trail.begin(), ship.trail.begin() + 2);
        }
    } else if (state == "play") {
        respawnT -= dt;
        if (respawnT <= 0) { ship.dead = false; ship.fuel = 100; ship.invuln = INVULN; placeShip(); }
    }

    // the ghosts: they hunt you, fall like you do, and pull you towards them
    for (int i = (int)enemies.size() - 1; i >= 0; i--) {
        if (i >= (int)enemies.size()) continue;
        Enemy& e = enemies[i];
        if (e.in > 0) { e.in -= dt; continue; }
        const float tx = ship.dead ? WW / 2 : ship.x, ty = ship.dead ? WH / 2 : ship.y;
        float dx = tx - e.x, dy = ty - e.y, d = std::hypot(dx, dy);
        if (d == 0) d = 1;
        float eax = dx / d * e.acc, eay = dy / d * e.acc;
        if (e.type == "darter") {
            e.dash -= dt;
            if (e.dash <= 0) { e.dash = rr(2.5f, 4.5f); e.vx += dx / d * 260; e.vy += dy / d * 260; burst(e.x, e.y, 8, 80, {C::green}, 2, 0.4f); }
        }
        if (e.type != "maw") {                            // they keep clear of the planets, mostly
            gravity(e.x, e.y, false);
            eax += AX * 0.6f; eay += AY * 0.6f;
            for (auto& pp : planets) {
                const float pdx = e.x - pp->x, pdy = e.y - pp->y, pd = std::hypot(pdx, pdy);
                if (pd < pp->r + 70) { eax += pdx / pd * 260; eay += pdy / pd * 260; }
            }
        }
        e.vx += eax * dt; e.vy += eay * dt;
        const float ev = std::hypot(e.vx, e.vy), emax = e.max * (1 + wave * 0.04f);
        if (ev > emax) { e.vx *= emax / ev; e.vy *= emax / ev; }
        e.x = clamp(e.x + e.vx * dt, 10, WW - 10); e.y = clamp(e.y + e.vy * dt, 10, WH - 10);
        bool dead = false;
        for (auto& p : planets) {
            if (std::hypot(e.x - p->x, e.y - p->y) < p->r * p->form + e.r * 0.6f) { killEnemy(e.id, "crashed"); dead = true; break; }
        }
        if (dead) continue;
        if (!ship.dead && ship.invuln <= 0 && state == "play" && std::hypot(e.x - ship.x, e.y - ship.y) < e.r + SHIP_R - 2) killShip();
    }

    // the shockwaves push everything outwards and smash ghosts
    for (int i = (int)waves.size() - 1; i >= 0; i--) {
        Wave& w = waves[i];
        w.r += w.sp * dt;
        if (w.r > w.max) { waves.erase(waves.begin() + i); continue; }
        const float k = 1 - w.r / w.max;
        if (!ship.dead && !hitHas(w, -1)) {
            const float d = std::hypot(ship.x - w.x, ship.y - w.y);
            if (std::fabs(d - w.r) < 24) {
                w.hit.push_back(-1);
                ship.vx += (ship.x - w.x) / d * (80 + 320 * k); ship.vy += (ship.y - w.y) / d * (80 + 320 * k);
                shakeT = std::max(shakeT, 0.3f);
            }
        }
        for (int j = (int)enemies.size() - 1; j >= 0; j--) {
            if (j >= (int)enemies.size()) continue;
            Enemy& e = enemies[j];
            if (e.in > 0 || hitHas(w, e.id)) continue;
            const float d = std::hypot(e.x - w.x, e.y - w.y);
            if (std::fabs(d - w.r) < 24) {
                w.hit.push_back(e.id);
                if (k > 0.45f && e.type != "maw") killEnemy(e.id, "blast");
                else { e.vx += (e.x - w.x) / d * 260 * k; e.vy += (e.y - w.y) / d * 260 * k; }
            }
        }
    }

    // debris: falls through the wells, kills what it hits
    for (int i = (int)debris.size() - 1; i >= 0; i--) {
        Debris& b = debris[i];
        b.life -= dt;
        gravity(b.x, b.y, false);
        b.vx += AX * dt; b.vy += AY * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt;
        bool gone = b.life <= 0 || b.x < -50 || b.x > WW + 50 || b.y < -50 || b.y > WH + 50;
        for (auto& p : planets) {
            if (gone) break;
            if (std::hypot(b.x - p->x, b.y - p->y) < p->r * p->form) { gone = true; burst(b.x, b.y, 8, 90, {C::pink, C::white}, 2, 0.5f); }
        }
        if (!gone && !ship.dead && ship.invuln <= 0 && state == "play" && std::hypot(b.x - ship.x, b.y - ship.y) < b.r + SHIP_R - 1) { killShip(); gone = true; }
        for (int j = (int)enemies.size() - 1; j >= 0 && !gone; j--) {
            if (enemies[j].in <= 0 && std::hypot(b.x - enemies[j].x, b.y - enemies[j].y) < b.r + enemies[j].r) { killEnemy(enemies[j].id, "smashed"); gone = true; }
        }
        if (gone) debris.erase(debris.begin() + i);
    }

    // the orbs
    for (int i = (int)orbs.size() - 1; i >= 0; i--) {
        Orb& o = orbs[i];
        o.in = std::min(1.f, o.in + dt * 1.5f);
        if (o.p) { o.a += o.w * dt; o.x = o.p->x + std::cos(o.a) * o.R; o.y = o.p->y + std::sin(o.a) * o.R; }
        else {
            o.x += o.vx * dt; o.y += o.vy * dt; o.vx *= 1 - 0.3f * dt; o.vy *= 1 - 0.3f * dt;
            if (o.x < 20 || o.x > WW - 20) o.vx = -o.vx;
            if (o.y < 20 || o.y > WH - 20) o.vy = -o.vy;
        }
        if (!ship.dead && state == "play" && std::hypot(o.x - ship.x, o.y - ship.y) < 16 + SHIP_R) {
            const float ox = o.x, oy = o.y;
            orbs.erase(orbs.begin() + i);
            orbsGot++;
            combo = comboT > 0 ? combo + 1 : 0; comboT = 3;
            const int pts = 100 * wave * (1 + combo);
            score += pts; ship.fuel = std::min(100.f, ship.fuel + 22);
            popup(ox, oy - 18, "+" + std::to_string(pts), C::sky);
            burst(ox, oy, 30, 200, {C::sky, C::white, C::green}, 2.5f, 0.7f);
            Sfx::orb(combo);
            if (orbsGot >= orbsNeed) waveClear();
        }
    }
    comboT = std::max(0.f, comboT - dt);

    if (playing) {
        orbT -= dt;
        if (orbT <= 0 && (int)orbs.size() < 3 + std::min(wave, 3)) { spawnOrb(); orbT = rr(1.5f, 3.5f); }
        spawnT -= dt;
        if (spawnT <= 0) { if ((int)enemies.size() < enemyTarget()) spawnEnemy(); spawnT = std::max(4.f, 10.f - wave); }
    }
    if (state == "clear") {
        clearT -= dt;
        if (clearT <= 0) { wave++; state = "play"; startWave(); Sfx::music(false); Sfx::music(true, wave); }
    }
    if (state == "attract" && enemies.size() < 3 && frand() < dt) spawnEnemy("wisp");
    if (state == "attract" && orbs.size() < 5 && frand() < dt) spawnOrb();
    if (state == "attract" && planets.size() < 3 && reformT.empty()) reformT.push_back(2);
}

// ---- drawing --------------------------------------------------------------------------------------------------
float sx(float x) { return VX + x * VS; }
float sy(float y) { return VY + y * VS; }

void makeStars() {
    stars.clear();
    const int n = (int)std::floor(W * H / 2600);
    for (int i = 0; i < n; i++) stars.push_back({frand() * W, frand() * H, frand() * 1.4f + 0.2f, frand() * TAU, 0.4f + frand() * 2});
}

void drawBackground() {
    Canvas& c = *ctx;
    c.fillStyle = C::black;
    c.fillRect(0, 0, W, H);
    c.fillStyle = C::white;
    for (const Star& s : stars) {
        c.globalAlpha = 0.25f + 0.6f * std::fabs(std::sin(s.t + time_ * s.s));
        c.fillRect(s.x, s.y, s.r, s.r);
    }
    c.globalAlpha = 1;
    c.strokeStyle = C::deep; c.lineWidth = 2;               // the arena's edge
    c.setLineDash({10, 8});
    c.strokeRect(sx(0), sy(0), WW * VS, WH * VS);
    c.setLineDash({});
}

void drawWells() {
    Canvas& c = *ctx;
    // the gravity wells: faint rings where the pull is 400, 200, 100, 50 and 25, drifting slowly inwards
    c.lineWidth = 1;
    const float levels[5] = {420, 200, 100, 50, 25};
    for (auto& p : planets) {
        for (int j = 0; j < 5; j++) {
            const float R = std::sqrt(p->gm * p->form / levels[j]);
            if (R < p->r + 6) continue;
            const float drift = std::fmod(time_ * 12, 20.f);
            c.strokeStyle = p->warn >= 0 ? C::pink : C::sky;
            c.globalAlpha = (0.42f - j * 0.06f) * p->form;
            c.setLineDash({4, 10}); c.lineDashOffset = drift;
            c.beginPath(); c.arc(sx(p->x), sy(p->y), (R - std::fmod(time_ * 6 + j * 3, 6.f)) * VS, 0, TAU); c.stroke();
        }
    }
    for (auto& e : enemies) {
        if (e.in > 0) continue;
        for (int j = 2; j < 5; j++) {
            const float R = std::sqrt(e.gm / levels[j]);
            c.strokeStyle = C::green; c.globalAlpha = 0.3f - (j - 2) * 0.07f;
            c.setLineDash({3, 8}); c.lineDashOffset = -time_ * 20;
            c.beginPath(); c.arc(sx(e.x), sy(e.y), R * VS, 0, TAU); c.stroke();
        }
    }
    c.setLineDash({}); c.globalAlpha = 1;
}

void drawPlanet(Planet& p) {
    Canvas& c = *ctx;
    float x = sx(p.x), y = sy(p.y);
    const float r = p.r * VS * p.form;
    const float heat = p.warn >= 0 ? 1 - p.warn / p.warnMax : 0;
    if (heat > 0) { x += (frand() - 0.5f) * heat * 6; y += (frand() - 0.5f) * heat * 6; }
    const Color rim = p.hue ? C::pink : C::sky;
    c.shadowColor = heat > 0 ? C::pink : rim; c.shadowBlur = 20 + heat * 40;
    c.fillStyle = heat > 0.6f && frand() < heat * 0.4f ? Color("#3a0f38") : C::navy;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.shadowBlur = 0;
    // bands across it, turning slowly
    c.save(); c.beginPath(); c.arc(x, y, r, 0, TAU); c.clip();
    c.strokeStyle = p.hue ? Color("#5a2a5a") : C::deep; c.lineWidth = r * 0.16f;
    for (int i = 0; i < p.bands; i++) {
        const float yy = y - r + (i + 1) * 2 * r / (p.bands + 1) + std::sin(p.rot + i) * r * 0.1f;
        c.beginPath(); c.moveTo(x - r, yy); c.quadraticCurveTo(x, yy + std::sin(p.rot * 2 + i) * r * 0.3f, x + r, yy); c.stroke();
    }
    c.restore();
    c.strokeStyle = rim; c.lineWidth = 2.5f;
    c.shadowColor = rim; c.shadowBlur = 14;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
    c.shadowBlur = 0;
    if (p.form < 1) {                                     // a new planet pulling itself together
        c.strokeStyle = C::white; c.globalAlpha = 1 - p.form;
        c.beginPath(); c.arc(x, y, p.r * VS * (2 - p.form), 0, TAU); c.stroke();
        c.globalAlpha = 1;
        if (frand() < 0.5f) {
            const float a = frand() * TAU, d = p.r * 2.5f;
            particles.push_back({p.x + std::cos(a) * d, p.y + std::sin(a) * d, -std::cos(a) * d * 1.2f, -std::sin(a) * d * 1.2f, 0.7f, 0.7f, rim, 2});
        }
    }
    if (heat > 0) {
        // the cracks glow brighter as it runs out
        c.strokeStyle = heat > 0.7f && (int)std::floor(time_ * 20) % 2 ? C::white : C::pink;
        c.shadowColor = C::pink; c.shadowBlur = 10 + heat * 20;
        c.lineWidth = 1 + heat * 3;
        const float reach = std::min(1.f, 0.3f + heat);
        for (auto& cr : p.cracks) {
            c.beginPath(); c.moveTo(x, y);
            for (size_t k = 1; k < cr.size(); k++) {
                const float f = std::min(1.f, reach);
                c.lineTo(x + cr[k].first * r * f, y + cr[k].second * r * f);
            }
            c.stroke();
        }
        // the countdown ring and number
        const float left = p.warn / p.warnMax;
        c.lineWidth = 4; c.strokeStyle = C::pink;
        c.beginPath(); c.arc(x, y, r + 16 * VS + 6, -PI / 2, -PI / 2 + TAU * left); c.stroke();
        c.shadowBlur = 0;
        c.fillStyle = C::white; c.textAlign = Align::Center; c.textBaseline = Baseline::Middle;
        c.font(Font::Black, std::max(16.f, r * 0.9f));
        c.fillText(std::to_string((int)std::ceil(p.warn)), x, y);
    }
}

void drawEnemy(const Enemy& e) {
    Canvas& c = *ctx;
    const float x = sx(e.x), y = sy(e.y), r = e.r * VS;
    if (e.in > 0) {                                       // a rift opening where it comes through
        c.strokeStyle = C::green; c.globalAlpha = 0.5f + 0.5f * std::sin(time_ * 20);
        c.lineWidth = 2;
        c.beginPath(); c.arc(x, y, r * (1 + e.in * 2), 0, TAU); c.stroke();
        c.beginPath(); c.moveTo(x - r, y - r); c.lineTo(x + r, y + r); c.moveTo(x + r, y - r); c.lineTo(x - r, y + r); c.stroke();
        c.globalAlpha = 1;
        return;
    }
    c.save(); c.translate(x, y);
    c.shadowColor = C::green; c.shadowBlur = 18;
    if (e.type == "maw") {                                // a black mouth with a green rim
        c.fillStyle = C::black; c.strokeStyle = C::green; c.lineWidth = 3;
        c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.stroke();
        c.rotate(time_ * 1.5f);
        for (int i = 0; i < 8; i++) {
            c.rotate(TAU / 8);
            c.beginPath(); c.moveTo(r * 0.55f, 0); c.lineTo(r, -r * 0.15f); c.lineTo(r, r * 0.15f); c.closePath();
            c.fillStyle = C::green; c.fill();
        }
    } else {                                              // a ghost with a wavy hem, looking at you
        const float a = std::atan2(e.vy, e.vx), sq = e.type == "darter" ? 0.7f : 1.f;
        c.fillStyle = e.type == "darter" ? C::green : Color("#c8ffd8");
        c.beginPath();
        c.arc(0, -r * 0.2f, r * sq, PI, 0);
        for (int k = 0; k <= 6; k++)
            c.lineTo(r * sq - k * (2 * r * sq / 6), r * 0.8f + std::sin(time_ * 10 + k + e.ph) * r * 0.2f * (k % 2 ? 1 : -1));
        c.closePath(); c.fill();
        c.shadowBlur = 0; c.fillStyle = C::black;
        const float ex = std::cos(a) * r * 0.2f, ey = std::sin(a) * r * 0.2f;
        c.beginPath(); c.arc(-r * 0.35f * sq + ex, -r * 0.3f + ey, r * 0.18f, 0, TAU); c.arc(r * 0.35f * sq + ex, -r * 0.3f + ey, r * 0.18f, 0, TAU); c.fill();
    }
    c.restore();
}

void drawPrediction() {
    Canvas& c = *ctx;
    if (ship.dead || state == "attract") return;
    // a copy of the ship falls ahead through the wells: where you'll be over the next couple of seconds
    float x = ship.x, y = ship.y, vx = ship.vx, vy = ship.vy;
    const float h = 1.f / 60;
    const int n = (int)std::round(PREDICT_T / h);
    c.fillStyle = C::white;
    for (int i = 1; i <= n; i++) {
        gravity(x, y, true);
        vx += AX * h; vy += AY * h;
        const float v = std::hypot(vx, vy);
        if (v > MAX_V) { vx *= MAX_V / v; vy *= MAX_V / v; }
        x += vx * h; y += vy * h;
        bool hit = false;
        for (auto& p : planets) if (std::hypot(x - p->x, y - p->y) < p->r * p->form + SHIP_R) hit = true;
        if (hit) {
            c.globalAlpha = 0.9f; c.strokeStyle = C::pink; c.lineWidth = 2.5f;
            const float X = sx(x), Y = sy(y);
            c.beginPath(); c.moveTo(X - 6, Y - 6); c.lineTo(X + 6, Y + 6); c.moveTo(X + 6, Y - 6); c.lineTo(X - 6, Y + 6); c.stroke();
            break;
        }
        if (x < 0 || x > WW || y < 0 || y > WH) break;
        if (i % 4 == 0) {
            c.globalAlpha = 0.85f * (1 - (float)i / n);
            c.fillRect(sx(x) - 1.5f, sy(y) - 1.5f, 3, 3);
        }
    }
    c.globalAlpha = 1;
}

void drawShip() {
    Canvas& c = *ctx;
    const auto& t = ship.trail;
    if (t.size() > 4) {                                   // the trail
        c.lineWidth = 2; c.strokeStyle = C::sky;
        for (size_t i = 2; i + 1 < t.size(); i += 2) {
            c.globalAlpha = ((float)i / t.size()) * 0.6f;
            c.beginPath(); c.moveTo(sx(t[i - 2]), sy(t[i - 1])); c.lineTo(sx(t[i]), sy(t[i + 1])); c.stroke();
        }
        if (!ship.dead) { c.globalAlpha = 0.6f; c.beginPath(); c.moveTo(sx(t[t.size() - 2]), sy(t[t.size() - 1])); c.lineTo(sx(ship.x), sy(ship.y)); c.stroke(); }
        c.globalAlpha = 1;
    }
    if (ship.dead || state == "attract") return;
    if (ship.invuln > 0 && (int)std::floor(time_ * 12) % 2) return;
    const float s = std::max(1.f, VS) * 1.1f;
    c.save(); c.translate(sx(ship.x), sy(ship.y)); c.rotate(ship.ang); c.scale(s, s);
    if (thrusting && keys.up) {
        c.fillStyle = C::pink; c.shadowColor = C::pink; c.shadowBlur = 16;
        c.beginPath(); c.moveTo(-7, -3.5f); c.lineTo(-13 - frand() * 8, 0); c.lineTo(-7, 3.5f); c.closePath(); c.fill();
    }
    c.shadowColor = C::sky; c.shadowBlur = 16;
    c.fillStyle = C::navy; c.strokeStyle = C::white; c.lineWidth = 1.8f; c.roundJoin = true;
    c.beginPath(); c.moveTo(11, 0); c.lineTo(-7, -7); c.lineTo(-4, 0); c.lineTo(-7, 7); c.closePath(); c.fill(); c.stroke();
    c.shadowBlur = 0; c.fillStyle = C::sky;
    c.beginPath(); c.arc(2, 0, 2, 0, TAU); c.fill();
    c.restore();
}

void drawOrbs() {
    Canvas& c = *ctx;
    for (size_t i = 0; i < orbs.size(); i++) {
        const Orb& o = orbs[i];
        const float x = sx(o.x), y = sy(o.y), r = (6 + std::sin(time_ * 5 + i) * 1.5f) * VS * o.in;
        c.shadowColor = C::sky; c.shadowBlur = 18;
        c.fillStyle = C::sky; c.beginPath(); c.arc(x, y, r * 1.5f, 0, TAU); c.fill();
        c.fillStyle = C::white; c.beginPath(); c.arc(x, y, r * 0.8f, 0, TAU); c.fill();
        c.shadowBlur = 0;
        if (o.p) {                                        // a faint arc showing the orbit it rides
            c.strokeStyle = C::sky; c.globalAlpha = 0.18f; c.lineWidth = 1;
            c.beginPath(); c.arc(sx(o.p->x), sy(o.p->y), o.R * VS, o.a - 0.5f * (o.w > 0 ? 1.f : o.w < 0 ? -1.f : 0.f), o.a, o.w < 0); c.stroke();
            c.globalAlpha = 1;
        }
    }
}

void drawDebrisAndWaves() {
    Canvas& c = *ctx;
    for (const Wave& w : waves) {
        const float k = 1 - w.r / w.max;
        c.strokeStyle = C::white; c.shadowColor = C::pink; c.shadowBlur = 25;
        c.globalAlpha = k; c.lineWidth = 2 + 8 * k;
        c.beginPath(); c.arc(sx(w.x), sy(w.y), w.r * VS, 0, TAU); c.stroke();
        c.strokeStyle = C::pink; c.lineWidth = 2;
        c.beginPath(); c.arc(sx(w.x), sy(w.y), w.r * VS * 0.85f, 0, TAU); c.stroke();
    }
    c.globalAlpha = 1;
    for (const Debris& b : debris) {
        c.save(); c.translate(sx(b.x), sy(b.y)); c.rotate(b.rot);
        c.fillStyle = Color("#3a0f38"); c.strokeStyle = C::pink; c.shadowColor = C::pink; c.shadowBlur = 10; c.lineWidth = 1.5f;
        c.globalAlpha = std::min(1.f, b.life);
        c.beginPath();
        for (int k2 = 0; k2 < b.sides; k2++) {
            const float a = (float)k2 / b.sides * TAU, rr2 = b.r * VS * (k2 % 2 ? 0.7f : 1.f);
            if (k2) c.lineTo(std::cos(a) * rr2, std::sin(a) * rr2); else c.moveTo(std::cos(a) * rr2, std::sin(a) * rr2);
        }
        c.closePath(); c.fill(); c.stroke();
        c.restore();
    }
    c.globalAlpha = 1; c.shadowBlur = 0;
}

void drawParticles(float dt) {
    Canvas& c = *ctx;
    const float drag = std::exp(-1.8f * dt);
    for (int i = (int)particles.size() - 1; i >= 0; i--) {
        Particle& p = particles[i];
        p.life -= dt;
        if (p.life <= 0) { particles.erase(particles.begin() + i); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= drag; p.vy *= drag;
        const float k = p.life / p.max;
        c.globalAlpha = k; c.fillStyle = p.c;
        c.beginPath(); c.arc(sx(p.x), sy(p.y), (0.5f + p.s * k) * std::max(0.7f, VS), 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
    c.textAlign = Align::Center; c.textBaseline = Baseline::Middle; c.font(Font::Bold, 16);
    for (int i = (int)popups.size() - 1; i >= 0; i--) {
        Popup& q = popups[i];
        q.life -= dt; q.y -= 30 * dt;
        if (q.life <= 0) { popups.erase(popups.begin() + i); continue; }
        c.globalAlpha = std::min(1.f, q.life * 2); c.fillStyle = q.c;
        c.fillText(q.t, sx(q.x), sy(q.y));
    }
    c.globalAlpha = 1;
}

void centreText(const std::string& t, float y, float size, const Color& col, bool glow) {
    Canvas& c = *ctx;
    c.textAlign = Align::Center; c.textBaseline = Baseline::Middle;
    c.font(Font::Black, size);
    c.shadowColor = col; c.shadowBlur = glow ? 22.f : 0.f;
    c.fillStyle = col; c.fillText(t, W / 2, y);
    c.shadowBlur = 0;
}

void drawHudCanvas() {
    Canvas& c = *ctx;
    if (state == "attract") return;
    // fuel
    const float bw = std::min(260.f, W * 0.4f), x = 14, y = H - 30;
    c.fillStyle = Color("#c2c2c2"); c.font(Font::Bold, 13); c.textAlign = Align::Left; c.textBaseline = Baseline::Middle;
    c.fillText("FUEL", x, y - 14);
    c.fillStyle = C::navy; c.fillRect(x, y, bw, 10);
    c.fillStyle = ship.fuel < 25 && (int)std::floor(time_ * 4) % 2 ? C::pink : C::green;
    c.fillRect(x, y, bw * ship.fuel / 100, 10);
    c.strokeStyle = C::deep; c.lineWidth = 1; c.strokeRect(x, y, bw, 10);
}

void drawOverlays() {
    Canvas& c = *ctx;
    if (flashT > 0) { c.globalAlpha = std::min(0.5f, flashT * 1.5f); c.fillStyle = flashCol; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
    if (bannerT > 0 && state != "attract") {
        c.globalAlpha = std::min(1.f, bannerT * 1.5f);
        centreText(bannerText, H * 0.3f, std::min(72.f, W / 10), C::pink, true);
        centreText(bannerSub, H * 0.3f + std::min(54.f, W / 13), std::min(22.f, W / 26), C::sky, false);
        c.globalAlpha = 1;
    }
    if (paused || state == "over") {
        c.fillStyle = Color("rgba(2, 6, 17, 0.65)"); c.fillRect(0, 0, W, H);
        centreText(paused ? "PAUSED" : "GAME OVER", H / 2 - 30, std::min(84.f, W / 8), C::pink, true);
        c.font(Font::Regular, 20); c.fillStyle = C::white;
        c.fillText(paused ? "P to carry on" : "Score " + std::to_string(score) + "  \xC2\xB7  Wave " + std::to_string(wave), W / 2, H / 2 + 28);
        if (!paused) {
            const bool nb = score >= best && score > 0;
            c.fillStyle = nb ? C::green : C::sky; c.fillText(nb ? "A new best!" : "Best " + std::to_string(best), W / 2, H / 2 + 60);
            c.fillStyle = Color("#c2c2c2"); c.fillText("Space, Enter or click to fly again", W / 2, H / 2 + 96);
        }
    }
}

void draw(float dt) {
    Canvas& c = *ctx;
    c.save();
    if (shakeT > 0) c.translate((frand() - 0.5f) * shakeT * 16, (frand() - 0.5f) * shakeT * 16);
    drawBackground();
    drawWells();
    drawPrediction();
    drawOrbs();
    for (size_t i = 0; i < planets.size(); i++) drawPlanet(*planets[i]);
    drawDebrisAndWaves();
    for (const Enemy& e : enemies) drawEnemy(e);
    drawShip();
    drawParticles(dt);
    c.restore();
    drawHudCanvas();
    drawOverlays();
}

// the HTML bits over the canvas: the HUD (top left) and the help line (bottom right)
void drawHud() {
    Canvas& c = *ctx;
    if (!started_) return;
    c.save();
    c.globalAlpha = 1 - splashFade;
    c.font(Font::Bold, 20); c.letterSpacing = 1; c.textAlign = Align::Left; c.textBaseline = Baseline::Top;
    float x = 14;
    const std::string parts[5] = {"Score " + std::to_string(score), "Wave " + std::to_string(wave),
                                  "Orbs " + std::to_string(std::min(orbsGot, orbsNeed)) + "/" + std::to_string(orbsNeed),
                                  "Lives " + std::to_string(std::max(0, lives)), "Best " + std::to_string(best) + (Sfx::isMuted() ? "  (muted)" : "")};
    for (int i = 0; i < 5; i++) {
        c.fillStyle = i == 4 ? C::sky : C::pink;
        c.fillText(parts[i], x, 12);
        x += c.measureText(parts[i]) + 22;
    }
    c.letterSpacing = 0;
    c.font(Font::Regular, 13); c.fillStyle = Color("#c2c2c2"); c.textAlign = Align::Right; c.textBaseline = Baseline::Bottom;
    c.fillText("\xE2\x86\x90 \xE2\x86\x92 / A D turn \xC2\xB7 \xE2\x86\x91 / W thrust \xC2\xB7 \xE2\x86\x93 / S brake \xC2\xB7 P pause \xC2\xB7 M mute \xC2\xB7 F11 fullscreen", W - 14, H - 10);
    c.restore();
}

void drawTheSplash(double nowMs) {
    if (splashFade <= 0) return;
    const float vw = W / 100;
    SplashItem title; title.text = "ORBIT"; title.font = Font::Black; title.px = std::min(150.f, 22 * vw);
    title.spacing = title.px * 0.12f; title.lineH = 1; title.color = C::pink;
    SplashItem tag; tag.text = "AN ARCADE PHANTASM GAME"; tag.font = Font::Bold; tag.px = std::min(24.f, 5 * vw);
    tag.spacing = tag.px * 0.2f; tag.color = C::sky; tag.marginBottom = 10;
    SplashItem img; img.image = &logo; img.imageW = std::min(260.f, 50 * vw);
    SplashItem copy; copy.text = "\xC2\xA9 Cursed Entertainment 2026"; copy.px = 15; copy.color = Color("#c2c2c2");
    SplashItem how; how.text = "Your thrust is weak. Gravity is how you really move.\nSlingshot round the planets, grab the orbs, and get clear before they blow.";
    how.px = 15; how.lineH = 1.5f; how.color = Color("#c2c2c2"); how.marginTop = 10;
    SplashItem press; press.text = "Press any key or click to start"; press.font = Font::Bold; press.px = 20;
    press.spacing = 1.6f; press.color = C::green; press.marginTop = 14;
    press.alpha = std::fmod(nowMs / 1000.0, 1.2) < 0.6 ? 1.f : 0.f;
    drawSplash(*ctx, {title, tag, img, copy, how, press}, 14, Color("rgba(2, 6, 17, 0.62)"), splashFade);
}

void start() {
    if (started_) return;
    started_ = true;
    worldSize(); view();
    newGame(1);
}
void togglePause() {
    if (state == "over" || !started_) return;
    paused = !paused;
    Sfx::music(!paused, wave);
    if (paused) Sfx::thrust(false);
}
void restart() { if (state == "over" && time_ - overT > 0.8f) newGame(1); }
}  // namespace

// ---- what main.cpp calls ----------------------------------------------------------------------------------------
const char* Game::title() { return "ORBIT"; }
bool Game::started() { return started_; }

void Game::init(float w, float h) {
    best = std::atoi(Platform::load("orbitBest", "0").c_str());
    Sfx::muted = Platform::load("orbitMute", "0") == "1";
    logo = Platform::texture("cursed-logo.png");
    resize(w, h);
    seed = 4242;
    wave = 2; lives = 3; score = 0;
    ship = Ship();
    ship.invuln = 1e9f;
    particles.clear(); popups.clear();
    startWave();
    state = "attract"; bannerT = 0;
}

void Game::resize(float w, float h) {
    W = w; H = h;
    if (!started_) worldSize();
    view();
    makeStars();
}

void Game::frame(Canvas& c, double now) {
    ctx = &c;
    const float dt = last ? std::min(0.1f, (float)((now - last) / 1000)) : 1.f / 60;
    last = now;
    Sfx::schedule();
    if (!paused && state != "over") {
        acc += dt;
        while (acc >= DT) { step(DT); acc -= DT; }
    } else if (state == "over") time_ += dt;
    bannerT = std::max(0.f, bannerT - (paused ? 0 : dt));
    flashT = std::max(0.f, flashT - dt);
    shakeT = std::max(0.f, shakeT - dt);
    draw(paused ? 0 : dt);
    if (started_) splashFade = std::max(0.f, splashFade - dt / 0.5f);
    drawHud();
    drawTheSplash(now);
}

void Game::keyDown(const std::string& k, bool) {
    Sfx::wake();
    if (!started_) { start(); return; }
    if (k == "m") Sfx::toggleMute();
    else if (k == "p" || k == "Escape") togglePause();
    else if (state == "over" && (k == " " || k == "Enter" || k == "r")) restart();
    else if (k == "ArrowLeft" || k == "a") keys.left = true;
    else if (k == "ArrowRight" || k == "d") keys.right = true;
    else if (k == "ArrowUp" || k == "w") keys.up = true;
    else if (k == "ArrowDown" || k == "s") keys.down = true;
}

void Game::keyUp(const std::string& k) {
    if (k == "ArrowLeft" || k == "a") keys.left = false;
    if (k == "ArrowRight" || k == "d") keys.right = false;
    if (k == "ArrowUp" || k == "w") keys.up = false;
    if (k == "ArrowDown" || k == "s") keys.down = false;
}

void Game::pointerDown(float, float) {
    Sfx::wake();
    if (!started_) { start(); return; }
    if (state == "over") restart();
}
void Game::pointerMove(float, float) {}
void Game::pointerUp(float, float) {}

void Game::blur() {
    keys.left = keys.right = keys.up = keys.down = false;
    if (state == "play" && !paused) togglePause();
}
