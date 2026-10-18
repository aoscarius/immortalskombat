/* =====================================================================
   Default character constants (MUGEN 240p units), used when a character's
   .cns omits a value. MD_UNITLESS marks constants that must not be scaled by
   the character's localcoord; MD_ALIAS maps newer constant names to older ones.
   ===================================================================== */
/** Default value(s) per constant name, in 240p units (vectors have several entries, e.g. [x, y]). */
const MD = {
  'data.life': [1000],
  'data.power': [3000],
  'data.attack': [100],
  'data.defence': [100],
  'data.fall.defence_up': [50],
  'data.liedown.time': [60],
  'data.airjuggle': [15],
  'data.sparkno': [2],
  'data.guard.sparkno': [40],
  'size.xscale': [1],
  'size.yscale': [1],
  'size.ground.back': [15],
  'size.ground.front': [16],
  'size.air.back': [12],
  'size.air.front': [12],
  'size.height': [60],
  'size.attack.dist': [160],
  'size.proj.attack.dist': [90],
  'size.head.pos': [-5, -90],
  'size.mid.pos': [-5, -60],
  'velocity.walk.fwd': [2.4],
  'velocity.walk.back': [-2.2],
  'velocity.run.fwd': [4.6, 0],
  'velocity.run.back': [-4.5, -3.8],
  'velocity.jump.neu': [0, -8.4],
  'velocity.jump.back': [-2.55],
  'velocity.jump.fwd': [2.5],
  'velocity.runjump.back': [-2.55, -8.1],
  'velocity.runjump.fwd': [4],
  'velocity.airjump.neu': [0, -8.1],
  'velocity.airjump.back': [-2.55],
  'velocity.airjump.fwd': [2.5],
  'velocity.air.gethit.groundrecover': [-0.15, -3.5],
  'velocity.air.gethit.airrecover.mul': [0.5, 0.2],
  'velocity.air.gethit.airrecover.add': [0, -4.5],
  'velocity.air.gethit.airrecover.back': [-1],
  'velocity.air.gethit.airrecover.fwd': [0],
  'velocity.air.gethit.airrecover.up': [-2],
  'velocity.air.gethit.airrecover.down': [1.5],
  'movement.airjump.num': [1],
  'movement.airjump.height': [35],
  'movement.yaccel': [0.44],
  'movement.stand.friction': [0.85],
  'movement.crouch.friction': [0.82],
  'movement.stand.friction.threshold': [2],
  'movement.crouch.friction.threshold': [0.05],
  'movement.air.gethit.groundlevel': [25],
  'movement.air.gethit.groundrecover.ground.threshold': [-20],
  'movement.air.gethit.groundrecover.groundlevel': [10],
  'movement.air.gethit.airrecover.threshold': [-1],
  'movement.air.gethit.airrecover.yaccel': [0.35],
  'movement.air.gethit.trip.groundlevel': [15],
  'movement.down.bounce.offset': [0, 20],
  'movement.down.bounce.yaccel': [0.4],
  'movement.down.bounce.groundlevel': [12],
  'movement.down.friction.threshold': [0.05]
};
/** Constant names that are plain numbers/ratios and are never scaled by localcoord. */
const MD_UNITLESS = /^data\.|friction$|airjump\.num$|airrecover\.mul$|^size\.(xscale|yscale)$/;
/** Alias constant name -> [base constant, component index] (e.g. velocity.jump.y is the y of velocity.jump.neu). */
const MD_ALIAS = {
  'velocity.jump.y': ['velocity.jump.neu', 1],
  'velocity.airjump.y': ['velocity.airjump.neu', 1],
  'velocity.run.back.y': ['velocity.run.back', 1],
  'velocity.run.fwd.y': ['velocity.run.fwd', 1]
};
