[![Twitter: @NorowaretaGemu](https://img.shields.io/badge/X-@NorowaretaGemu-blue.svg?style=flat)](https://x.com/NorowaretaGemu)

<br>
<div align="center">
  <a href="https://ko-fi.com/cursedentertainment">
    <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="ko-fi" style="width: 20%;"/>
  </a>
</div>
<br>
<div align="center">
  <img alt="JavaScript" src="https://img.shields.io/badge/javascript%20-%23323330.svg?&style=for-the-badge&logo=javascript&logoColor=white"/>
  <img alt="HTML5" src="https://img.shields.io/badge/html5%20-%23323330.svg?&style=for-the-badge&logo=html5&logoColor=white"/>
  <img alt="CSS3" src="https://img.shields.io/badge/css3%20-%23323330.svg?&style=for-the-badge&logo=css3&logoColor=white"/>
</div>
<br>

# ORBIT

**An [Arcade Phantasm](https://arcade-phantasm.netlify.app/) game** · **[Play it](https://cursedprograms.github.io/Orbit/)**

A tiny spacecraft caught between gravitational fields. Orbit planets to dodge enemies, slingshot between gravity wells and collect energy orbs, while planets explode around you.

**The twist:** enemies have their own gravity, pulling you off course.

<div align="center">
  <img src="images/screenshot-splash.png" alt="ORBIT splash" width="49%"/>
  <img src="images/screenshot-play.png" alt="ORBIT: a planet explodes while another counts down" width="49%"/>
</div>

## Versions

| Version | Where | Status |
|---|---|---|
| Browser | this folder, the repo root · **[Play it](https://cursedprograms.github.io/Orbit/)** | Playable |
| Windows exe | `cpp/` | Coming |
| Android | `android/` | Coming |

## How to play

Every planet pulls on you (inverse square: the faint rings mark its well). Your thrust is weak and your fuel is short, so gravity is how you really move: fall round a planet, then slingshot to the next. The dotted line shows where you'll fall over the next couple of seconds, and a pink cross marks a crash ahead.

- **Energy orbs**: collect enough to clear the wave. Most ride an orbit round a planet: match it to catch one. Each orb tops up your fuel.
- **Ghosts** hunt you and pull you towards them with their own gravity (the green rings). From wave 3 come the maws, slow ghosts with deep wells, and from wave 4 the darters.
- **Planets explode**: a planet cracks, glows and counts down, then goes with a shockwave and flying debris, and its well is gone. Get clear. The blast, the shockwave and the debris destroy ghosts too, for points. New planets form in their place.
- Fuel slowly comes back when you're not burning. The arena's edge bounces you back in.

Each wave has more planets and more ghosts. You have three lives, and an extra one every second wave. Fuel left at the end of a wave adds to the bonus. Your best score is kept in the browser.

## Controls

| Key | Action |
|---|---|
| ← → or A D | Turn |
| ↑ or W | Thrust |
| ↓ or S | Brake (thrust against your motion) |
| P or Esc | Pause |
| M | Mute |
| Space or Enter | Fly again after game over |

On a phone: drag anywhere to steer and thrust towards the drag, BRAKE brakes, II pauses.

## Files

- `index.html`: the page
- `site/style.css`: the page's look
- `site/game.js`: the game: fixed-step gravity physics, the planets, the ghosts, the trajectory dots, the drawing
- `site/sfx.js`: the sound, made with Web Audio (no audio files)
- `images/`: the Cursed logo and the screenshots

Open `index.html#shot` for a mid-game screenshot.

## Also in the arcade

[KillerStardust](https://github.com/CursedPrograms/KillerStardust) · ProtocolHex · Seance · RicochetReaper · GraveDanger · [Vortex](https://github.com/CursedPrograms/Vortex) · **Orbit** · RocksOfRuin · Devourer

<br>
<div align="center">
© Cursed Entertainment 2026
</div>
<br>
<div align="center">
<a href="https://cursed-entertainment.itch.io/" target="_blank">
    <img src="https://github.com/CursedPrograms/cursedentertainment/raw/main/images/logos/logo-wide-grey.png"
        alt="CursedEntertainment Logo" style="width:250px;">
</a>
</div>
