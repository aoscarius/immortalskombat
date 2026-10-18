# Debugging
- F4: overlay (state, anim, frame, time, vel) for both fighters.
- F3: copies a report with recent history and `healthCheck` warnings (missing anims, unknown controllers,
  missing sounds). Paste it into a bug report.
- `MG.trace = fn` receives each fighter after every tick.
- Watchdogs: anim stuck 30 ticks, hit state over 400 ticks -> back to idle with a warning.

## Bugs found with real fighters (all covered by `tests/engine.js` or the soak in `tests/ref.js`)
- `[State 0,0]` controllers were attached to state 0 instead of the current Statedef (the number is only a label) -> states with no controllers, fighter frozen.
- `AnimElem = 1 > 0` (no comma) was read as `AnimElem = (1>0)` -> gravity applied once, jump kicks never landed.
- Victims ran the attacker's get-hit states (p2getp1state) instead of their own.
- Engine-side transitions (5110 -> 5120) skipped the new state's time-0 controllers -> get-up animation never started.
- Air-type states forced to `physics = S` were snapped to the floor and could not fall to their exit height.
- Indexed redirections `EnemyNear(n),trigger` / `Enemy(n),trigger` and `var(n) := x` inside `||` were not parsed.

## Move coverage
`node tests/moves.js <fighter folder>...` forces every named command of a fighter once and reports moves that do nothing,
never return control, or leave the screen. Bloo (35 commands) and Kenshiro (92) report nothing.

## Helpers
The Helper controller is supported (`js/mugen/engine/helper.js`, `Mugen.addHelper` in world.js): own variables, states, hitdefs,
explods and projectiles; `Root`, `Parent`, `Helper(id)`, `PlayerID(id)` redirects; `NumHelper`, `IsHelper`, `ParentDist`, `RootDist`;
`DestroySelf`, `BindToParent/Root`, `ParentVarSet/Add`, per-helper pause move time. Helpers never take hits and are cleared at each round.

## Not supported yet
`Partner`/team modes, `HitOverride`, dizzy/guard points, `ModifyExplod`, palette effects, 3D stages.
