# Immortals Kombat

An HTML5, MUGEN-compatible fighting engine and game. No server needed: open `dist/immortals-kombat.html`.

## Quick start
```
npm install          # jszip + terser (dev only)
node tools/build.js  # -> dist/immortals-kombat.html, dist/artifact.html, dist/assets/
node tools/serve.js  # static server for dist/, prints the port
npm test             # Playwright tests (Chromium)
```
`node tools/build.js --dev` skips minification.

## Content folder (one ZIP per fighter / stage)
The game reads a base folder at start: `?base=URL`, else the saved one (select screen > base box), else `assets/`.
The folder may hold `manifest.json` (`{"chars":[{"zip":"chars/x.zip"}],"stages":[...]}`) or just a browsable
directory index (zips and loose folders are both found). Zips are opened lazily; only the two fighters and the
stage of a match are in memory, everything else is released when you return to the menu.
See `docs/CONTENT.md`.

## Layout
- `js/core` util, audio, input
- `js/mugen/format` parsers: DEF/AIR/CMD/CNS, SFF v1+v2, SND
- `js/mugen/content` virtual file system, zip/crawl loading, fighter and stage loaders
- `js/mugen/engine` expression VM, animation, state machine, controllers, hitdefs, world, drawing
- `js/game` roster, content boot, match flow, select screen, HUD, renderer, debug tools
- `js/net` PeerJS lockstep netplay
- `tools`, `tests`, `docs`

See `docs/ARCHITECTURE.md`.

## Debugging stuck or odd animations
In a match press **F4** for a per-fighter overlay and **F3** to copy a report (last 120 ticks of state/anim/frame,
health check warnings). Watchdogs return a fighter to idle if an animation stops advancing for 30 ticks or a hit
state lasts over 400 ticks. See `docs/DEBUGGING.md`.

## Netplay
Peer-to-peer via PeerJS, lockstep with 4 ticks of input delay and a state hash every 60 ticks. Fighters and
stages are sent over the channel. Needs internet access to the PeerJS broker.

## Limits
No 3D stages, no team modes, limited BGCtrl support, SFF v2 only for the common compression types, online play may be
blocked inside sandboxed iframes. PixiJS was evaluated; canvas 2D with the sprite cache is sufficient.

## Debug keys (in a match, off online)
`Space` full life and power for the human players, `F2` CPU opponent to 1 life (arcade/practice), `F3` copy report, `F4` overlay. They are ignored online.

## More docs
- [Glossary](docs/GLOSSARY.md) – names used across the engine
