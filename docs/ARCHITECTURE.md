# Architecture
Fixed 60 Hz tick (max 3 catch-up ticks per frame). World units are pixels at 960x540; fighter `localcoord`
is scaled by 540/localcoord height.

Tick: input -> `Mugen.step` -> for each fighter: state controllers, physics, animation, hitdef resolution ->
projectiles -> watchdog/trace -> HUD (writes only on change) -> render (parallax in culled bands).

Data flow: `Content` (manifest/crawl/zip) -> VFS -> `MG.loadChar` / `MG.loadStage` -> `Roster` stubs resolve lazily
-> `Match.begin` loads two fighters + stage, `Roster.trim` frees the rest. Sprite cache: 96 MB, LRU.

Netplay: per-seed input buffers, `G.time` reset at match start, state hash compared every 60 ticks.
Script order is defined in `index.html`; every module attaches to the `MG` or `IK` namespaces.
Helpers: `mugen/engine/helper.js` (class MugenHelper extends MugenFighter). They update after both players each tick, are drawn with the players, and can attack but not be attacked.
