# Glossary

Names used across the engine. All code and comments are in English.

## Fighter state (`MugenFighter`, `js/mugen/engine/fighter.js`)
| Property | Meaning |
|---|---|
| `posX`, `posY` | Position in stage pixels (Y grows downward, 0 = ground) |
| `velX`, `velY` | Velocity in pixels per tick |
| `opponent` | The enemy fighter (redirect `enemy`) |
| `animation` | The `MAnim` player of the current AIR action |
| `getHit` | Data of the hit being received (damage, hit time, velocities, ground type) |
| `hitDef` | Active attack definition set by the `HitDef` controller |
| `stateno`, `prevStateno`, `time` | Current state, previous state, ticks in state |
| `ctrl`, `type`, `moveType`, `physics` | Statedef fields: control, S/C/A/L, I/A/H, physics mode |
| `vars`, `fvars`, `sysvars` | `var(n)`, `fvar(n)`, `sysvar(n)` arrays |
| `helpers`, `root`, `parent`, `isHelper`, `uid` | Helper tree and unique helper id |
| `pkg` | Character package (parsed DEF/CNS/CMD/AIR/SFF/SND) |

## Modules
| Prefix / name | Role |
|---|---|
| `MG` | MUGEN library: formats, parsing, loaders |
| `Mugen` | Match simulation (`world.js`): hits, helpers, pauses |
| `MCTL` | State controller implementations, keyed by MUGEN controller name |
| `MAnim` | Animation player |
| `IK` | Game layer: menus, roster, matches, debug, netplay |
| `Net` | PeerJS lockstep netplay |

See `ARCHITECTURE.md` for the module map, `CONTENT.md` for content formats and `DEBUGGING.md` for the debug keys, tests and known limits.
