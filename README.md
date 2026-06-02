# Yardline Ops FPS

A browser-playable FPS prototype built with Vite, TypeScript, Three.js, and a small authoritative Node WebSocket server.

## Run Locally

```sh
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173/`. The Vite client connects to `ws://localhost:8787/ws` by default.

## Production-Style Run

```sh
npm.cmd run build
npm.cmd start
```

Open `http://localhost:8787/`. The same server serves `dist` and accepts WebSocket connections at `/ws`.

## Online Multiplayer

Deploy this repo to any public Node host that supports WebSocket upgrades. The client uses `VITE_WS_URL` when provided; otherwise production builds use the same origin `/ws`.

## Features

- Main menu, player customization, private room codes, and host-started online lobbies.
- Singleplayer practice match against one bot.
- Free-for-all matches for up to 8 online players.
- Grounded weapon models and classes: M4 Carbine, MP5 SMG, M249 LMG, and M24 Sniper.
- Tactical mods: Quick Hands, Lightweight, and Armor Plate.
- One procedural shipping-container yard map with server-authoritative online movement, hit detection, scoring, reloads, and respawns.
- Real recorded SFX for weapon fire, reloads, footsteps, hitmarkers, and Player 1/Player 2 lead callouts.
- Three.js post-processing with tone mapping, SMAA, mild bloom, muzzle flashes, hit sparks, and camera/weapon recoil.

## Audio Assets

The gameplay SFX in `public/audio/sfx/` are real recorded or CC0 UI audio assets, not procedural oscillator sounds.

- Gunshots: OpenGameArt "Gunshot Sounds" (`sks.wav`, `cz.wav`, `shotty.wav`, `mosin.wav`), CC0/public domain. Source: https://opengameart.org/content/gunshot-sounds
- Reloads: OpenGameArt "Gun reload sounds" (`gunreload1.wav`, `assaultriflereload1.wav`), CC0/public domain. Source: https://opengameart.org/content/gun-reload-sounds
- Footsteps: OpenGameArt "Metal footsteps on concrete" (`metal_steps_01.wav` through `metal_steps_06.wav`), CC0/public domain. Source: https://opengameart.org/content/metal-footsteps-on-concrete
- Hitmarker, killmarker, and reload finish clicks: Kenney "51 UI sound effects (buttons, switches and clicks)", CC0. Source: https://opengameart.org/content/51-ui-sound-effects-buttons-switches-and-clicks
- Lead callouts and match intro: user-provided MP4 files copied from `C:\Users\brade\Videos\2026-06-01 20-22-29.mp4`, `C:\Users\brade\Videos\2026-06-01 20-22-36.mp4`, and `C:\Users\brade\Videos\freeforall.mp4`.

## Test

```sh
npm.cmd test
npm.cmd run build
```
