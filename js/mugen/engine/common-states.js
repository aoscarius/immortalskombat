/* =====================================================================
   Built-in common states: an original implementation of the standard
   states every MUGEN character relies on (stand, walk, jump, crouch, guard,
   get-hit, fall, lie down, get up, intro...). A character's own states
   always take precedence; these fill in anything it does not define.
   ===================================================================== */
const COMMON_CNS = `
[Statedef 0]
type = S
physics = S
movetype = I
sprpriority = 0
[State 0, anim]
type = ChangeAnim
trigger1 = Anim != 0 && Anim != 5
trigger2 = Anim = 5 && AnimTime = 0
value = 0
[State 0, vy]
type = VelSet
trigger1 = Time = 0
y = 0
[State 0, vx]
type = VelSet
trigger1 = Time = 4 || Abs(Vel X) < Const(movement.stand.friction.threshold)
x = 0
[State 0, ko]
type = ChangeState
trigger1 = !Alive
value = 5050
ctrl = 0

[Statedef 10]
type = C
physics = C
movetype = I
anim = 10
[State 10, a]
type = VelMul
trigger1 = Time = 0
x = .75
[State 10, b]
type = VelSet
trigger1 = Abs(Vel X) < Const(movement.crouch.friction.threshold)
x = 0
[State 10, c]
type = ChangeState
trigger1 = AnimTime = 0
value = 11

[Statedef 11]
type = C
physics = C
movetype = I
anim = 11
sprpriority = 0
[State 11, a]
type = ChangeAnim
trigger1 = Anim = 6 && AnimTime = 0
value = 11
[State 11, b]
type = VelSet
trigger1 = Abs(Vel X) < Const(movement.crouch.friction.threshold)
x = 0

[Statedef 12]
type = S
physics = S
movetype = I
anim = 12
[State 12, a]
type = ChangeState
trigger1 = AnimTime = 0
value = 0

[Statedef 20]
type = S
physics = S
movetype = I
sprpriority = 0
[State 20, back]
type = VelSet
trigger1 = Command = "holdback"
x = Const(velocity.walk.back.x)
[State 20, fwd]
type = VelSet
trigger1 = Command = "holdfwd"
x = Const(velocity.walk.fwd.x)
[State 20, anim fwd]
type = ChangeAnim
trigger1 = Vel X > 0 && ((Anim = 5 && AnimTime = 0) || (Anim != 5 && Anim != 20))
value = 20
[State 20, anim back]
type = ChangeAnim
trigger1 = Vel X < 0 && ((Anim = 5 && AnimTime = 0) || (Anim != 5 && Anim != 21))
value = 21

[Statedef 40]
type = S
physics = S
movetype = I
anim = 40
ctrl = 0
sprpriority = 1
facep2 = 1
[State 40, z]
type = VarSet
trigger1 = Time = 0
sysvar(1) = 0
[State 40, b]
type = VarSet
trigger1 = Command = "holdback"
sysvar(1) = -1
[State 40, f]
type = VarSet
trigger1 = Command = "holdfwd"
sysvar(1) = 1
[State 40, jn]
type = VelSet
trigger1 = AnimTime = 0 && sysvar(1) = 0
x = Const(velocity.jump.neu.x)
y = Const(velocity.jump.neu.y)
[State 40, jf]
type = VelSet
trigger1 = AnimTime = 0 && sysvar(1) = 1 && PrevStateNo != 100
x = Const(velocity.jump.fwd.x)
y = Const(velocity.jump.neu.y)
[State 40, jrf]
type = VelSet
trigger1 = AnimTime = 0 && sysvar(1) = 1 && PrevStateNo = 100
x = Const(velocity.runjump.fwd.x)
y = Const(velocity.jump.neu.y)
[State 40, jb]
type = VelSet
trigger1 = AnimTime = 0 && sysvar(1) = -1
x = Const(velocity.jump.back.x)
y = Const(velocity.jump.neu.y)
[State 40, go]
type = ChangeState
trigger1 = AnimTime = 0
value = 50
ctrl = 1

[Statedef 45]
type = A
physics = N
movetype = I
ctrl = 0
velset = 0, 0
[State 45, anim]
type = ChangeAnim
trigger1 = 1
value = IfElse(SelfAnimExist(44), 44, 41)
[State 45, z]
type = VarSet
trigger1 = Time = 0
sysvar(1) = 0
[State 45, b]
type = VarSet
trigger1 = Command = "holdback"
sysvar(1) = -1
[State 45, f]
type = VarSet
trigger1 = Command = "holdfwd"
sysvar(1) = 1
[State 45, vn]
type = VelSet
trigger1 = Time = 2 && sysvar(1) = 0
x = Const(velocity.airjump.neu.x)
y = Const(velocity.airjump.neu.y)
[State 45, vf]
type = VelSet
trigger1 = Time = 2 && sysvar(1) = 1
x = Const(velocity.airjump.fwd.x)
y = Const(velocity.airjump.neu.y)
[State 45, vb]
type = VelSet
trigger1 = Time = 2 && sysvar(1) = -1
x = Const(velocity.airjump.back.x)
y = Const(velocity.airjump.neu.y)
[State 45, go]
type = ChangeState
trigger1 = Time = 2
value = 50
ctrl = 1

[Statedef 50]
type = A
physics = A
movetype = I
[State 50, a]
type = ChangeAnim
trigger1 = Time = 0
value = Cond(Vel X = 0, 41, IfElse(Vel X > 0, 42, 43))
[State 50, b]
type = ChangeAnim
persistent = 0
trigger1 = Vel Y > Const240p(-2) && Anim >= 41 && Anim <= 43 && SelfAnimExist(Anim + 3)
value = Anim + 3

[Statedef 51]
type = A
physics = A
movetype = I

[Statedef 52]
type = S
physics = S
movetype = I
ctrl = 0
anim = 47
[State 52, a]
type = VelSet
trigger1 = Time = 0
y = 0
[State 52, b]
type = PosSet
trigger1 = Time = 0
y = 0
[State 52, c]
type = CtrlSet
trigger1 = Time = 3
value = 1
[State 52, d]
type = VelSet
trigger1 = Abs(Vel X) < Const(movement.stand.friction.threshold)
x = 0
[State 52, e]
type = ChangeState
trigger1 = AnimTime = 0
value = 0
ctrl = 1

[Statedef 100]
type = S
physics = S
movetype = I
anim = 100
sprpriority = 1
[State 100, a]
type = VelSet
trigger1 = 1
x = Const(velocity.run.fwd.x)
[State 100, b]
type = AssertSpecial
trigger1 = 1
flag = noWalk
flag2 = noAutoTurn
[State 100, c]
type = ChangeState
trigger1 = Command != "holdfwd"
value = 0

[Statedef 105]
type = A
physics = A
movetype = I
ctrl = 0
anim = 105
sprpriority = 1
[State 105, a]
type = VelSet
trigger1 = Time = 0
x = Const(velocity.run.back.x)
y = Const(velocity.run.back.y)
[State 105, b]
type = CtrlSet
trigger1 = Time = 2
value = 1
[State 105, c]
type = ChangeState
trigger1 = Vel Y > 0 && Pos Y >= 0
value = 106

[Statedef 106]
type = S
physics = S
movetype = I
ctrl = 0
anim = 47
[State 106, a]
type = VelSet
trigger1 = Abs(Vel X) < Const(movement.stand.friction.threshold)
x = 0
[State 106, b]
type = VelSet
trigger1 = Time = 0
y = 0
[State 106, c]
type = PosSet
trigger1 = Time = 0
y = 0
[State 106, d]
type = ChangeState
trigger1 = Time = 7
value = 0
ctrl = 1

[Statedef 120]
type = U
physics = U
movetype = I
[State 120, hi]
type = StateTypeSet
trigger1 = Command = "holddown" && StateType = S
statetype = C
physics = C
[State 120, lo]
type = StateTypeSet
trigger1 = Command != "holddown" && StateType = C
statetype = S
physics = S
[State 120, anim]
type = ChangeAnim
trigger1 = Time = 0
value = 120 + (StateType = C) + (StateType = A) * 2
[State 120, go]
type = ChangeState
trigger1 = AnimTime = 0
value = 130 + (StateType = C) + (StateType = A) * 2
[State 120, stop]
type = ChangeState
trigger1 = Command != "holdback" || !InGuardDist
value = 140

[Statedef 130]
type = S
physics = S
movetype = I
[State 130, a]
type = ChangeAnim
trigger1 = Anim != 130
value = 130
[State 130, c]
type = ChangeState
trigger1 = Command = "holddown"
value = 131
[State 130, stop]
type = ChangeState
trigger1 = Command != "holdback" || !InGuardDist
value = 140

[Statedef 131]
type = C
physics = C
movetype = I
[State 131, a]
type = ChangeAnim
trigger1 = Anim != 131
value = 131
[State 131, c]
type = ChangeState
trigger1 = Command != "holddown"
value = 130
[State 131, stop]
type = ChangeState
trigger1 = Command != "holdback" || !InGuardDist
value = 140

[Statedef 132]
type = A
physics = N
movetype = I
[State 132, a]
type = ChangeAnim
trigger1 = Anim != 132
value = 132
[State 132, g]
type = VelAdd
trigger1 = 1
y = Const(movement.yaccel)
[State 132, l3]
type = ChangeState
trigger1 = Pos Y >= 0 && Vel Y > 0 && Command = "holdback" && InGuardDist
value = 130
[State 132, l4]
type = ChangeState
trigger1 = Pos Y >= 0 && Vel Y > 0
value = 52
[State 132, stop]
type = ChangeState
trigger1 = Command != "holdback" || !InGuardDist
value = 140

[Statedef 140]
type = U
physics = U
movetype = I
ctrl = 1
[State 140, hi]
type = StateTypeSet
trigger1 = Command = "holddown" && StateType = S
statetype = C
physics = C
[State 140, lo]
type = StateTypeSet
trigger1 = Command != "holddown" && StateType = C
statetype = S
physics = S
[State 140, anim]
type = ChangeAnim
trigger1 = Time = 0
value = 140 + (StateType = C) + (StateType = A) * 2

[Statedef 150]
type = S
movetype = H
physics = N
velset = 0, 0
[State 150, a]
type = ChangeAnim
trigger1 = 1
value = 150
[State 150, go]
type = ChangeState
trigger1 = HitShakeOver
value = 151 + 2 * (Command = "holddown")

[Statedef 151]
type = S
movetype = H
physics = S
anim = 150
[State 151, v]
type = HitVelSet
trigger1 = Time = 0
x = 1
[State 151, s]
type = VelSet
trigger1 = Time = GetHitVar(slidetime) || HitOver
x = 0
[State 151, c]
type = CtrlSet
trigger1 = Time = GetHitVar(ctrltime)
value = 1
[State 151, go]
type = ChangeState
trigger1 = HitOver
value = 130
ctrl = 1

[Statedef 152]
type = C
movetype = H
physics = N
velset = 0, 0
[State 152, a]
type = ChangeAnim
trigger1 = 1
value = 151
[State 152, go]
type = ChangeState
trigger1 = HitShakeOver
value = 153

[Statedef 153]
type = C
movetype = H
physics = C
anim = 151
[State 153, v]
type = HitVelSet
trigger1 = Time = 0
x = 1
[State 153, s]
type = VelSet
trigger1 = Time = GetHitVar(slidetime) || HitOver
x = 0
[State 153, c]
type = CtrlSet
trigger1 = Time = GetHitVar(ctrltime)
value = 1
[State 153, go]
type = ChangeState
trigger1 = HitOver
value = 131
ctrl = 1

[Statedef 154]
type = A
movetype = H
physics = N
velset = 0, 0
[State 154, a]
type = ChangeAnim
trigger1 = 1
value = 152
[State 154, go]
type = ChangeState
trigger1 = HitShakeOver
value = 155

[Statedef 155]
type = A
movetype = H
physics = N
anim = 152
[State 155, v]
type = HitVelSet
trigger1 = Time = 0
x = 1
y = 1
[State 155, c]
type = CtrlSet
trigger1 = Time = GetHitVar(ctrltime)
value = 1
[State 155, g]
type = VelAdd
trigger1 = 1
y = Const(movement.yaccel)
[State 155, l1]
type = ChangeState
trigger1 = Pos Y >= 0 && Vel Y > 0 && Command = "holdback" && InGuardDist
value = 130
[State 155, l2]
type = ChangeState
trigger1 = Pos Y >= 0 && Vel Y > 0
value = 52

[Statedef 170]
type = S
ctrl = 0
anim = 170
velset = 0, 0
[State 170, a]
type = NotHitBy
trigger1 = 1
value = SCA
time = 1

[Statedef 175]
type = S
ctrl = 0
velset = 0, 0
[State 175, a]
type = ChangeState
trigger1 = Time = 0 && !SelfAnimExist(175)
value = 170
[State 175, b]
type = ChangeAnim
trigger1 = Time = 0
value = 175
[State 175, c]
type = NotHitBy
trigger1 = 1
value = SCA
time = 1

[Statedef 190]
type = S
ctrl = 0
velset = 0, 0
[State 190, a]
type = ChangeAnim
trigger1 = SelfAnimExist(190)
value = 190
[State 190, b]
type = ChangeState
trigger1 = Time = 0
value = 191

[Statedef 191]
type = S
ctrl = 0
[State 191, a]
type = ChangeState
trigger1 = Time = 0
value = 0
ctrl = 1

[Statedef 5000]
type = S
movetype = H
physics = N
velset = 0, 0
[State 5000, a1]
type = ChangeAnim
trigger1 = Time = 0 && GetHitVar(animtype) >= 4 && SelfAnimExist(5051 + GetHitVar(animtype) - 4)
value = 5051 + GetHitVar(animtype) - 4
[State 5000, a2]
type = ChangeAnim
trigger1 = Time = 0 && GetHitVar(animtype) >= 3 && !(GetHitVar(animtype) >= 4 && SelfAnimExist(5051 + GetHitVar(animtype) - 4))
value = 5030
[State 5000, a3]
type = ChangeAnim
trigger1 = Time = 0 && GetHitVar(animtype) < 3
value = IfElse(GetHitVar(groundtype) = 1, 5000, 5010) + GetHitVar(animtype)
[State 5000, air]
type = StateTypeSet
trigger1 = (Time = 0 && (GetHitVar(yvel) != 0 || GetHitVar(fall))) || Pos Y != 0
statetype = A
[State 5000, go]
type = ChangeState
trigger1 = HitShakeOver
value = IfElse(GetHitVar(yvel) != 0 || GetHitVar(fall), 5030, 5001)

[Statedef 5001]
type = S
movetype = H
physics = S
[State 5001, v]
type = HitVelSet
trigger1 = Time = 0
x = 1
[State 5001, a]
type = ChangeAnim
trigger1 = (Time = 0 || AnimTime = 0) && SelfAnimExist(5005 + (GetHitVar(groundtype) = 2) * 10 + GetHitVar(animtype))
value = 5005 + (GetHitVar(groundtype) = 2) * 10 + GetHitVar(animtype)
[State 5001, m]
type = VelMul
trigger1 = Time >= GetHitVar(slidetime)
x = .6
[State 5001, o1]
type = VelSet
trigger1 = HitOver
x = 0
[State 5001, o2]
type = DefenceMulSet
trigger1 = HitOver
value = 1
[State 5001, go]
type = ChangeState
trigger1 = HitOver
value = 0
ctrl = 1

[Statedef 5010]
type = C
movetype = H
physics = N
velset = 0, 0
[State 5010, a1]
type = ChangeAnim
trigger1 = Time = 0 && GetHitVar(animtype) >= 4 && SelfAnimExist(5051 + GetHitVar(animtype) - 4)
value = 5051 + GetHitVar(animtype) - 4
[State 5010, a2]
type = ChangeAnim
trigger1 = Time = 0 && GetHitVar(animtype) >= 3 && !(GetHitVar(animtype) >= 4 && SelfAnimExist(5051 + GetHitVar(animtype) - 4))
value = 5030
[State 5010, a3]
type = ChangeAnim
trigger1 = Time = 0 && GetHitVar(animtype) < 3
value = 5020 + GetHitVar(animtype)
[State 5010, air]
type = StateTypeSet
trigger1 = (Time = 0 && (GetHitVar(yvel) != 0 || GetHitVar(fall))) || Pos Y != 0
statetype = A
[State 5010, go]
type = ChangeState
trigger1 = HitShakeOver
value = IfElse(GetHitVar(yvel) != 0 || GetHitVar(fall), 5030, 5011)

[Statedef 5011]
type = C
movetype = H
physics = C
[State 5011, v]
type = HitVelSet
trigger1 = Time = 0
x = 1
[State 5011, a]
type = ChangeAnim
trigger1 = (Time = 0 || AnimTime = 0) && SelfAnimExist(5025 + GetHitVar(animtype))
value = 5025 + GetHitVar(animtype)
[State 5011, m]
type = VelMul
trigger1 = Time >= GetHitVar(slidetime)
x = .6
[State 5011, o1]
type = VelSet
trigger1 = HitOver
x = 0
[State 5011, o2]
type = DefenceMulSet
trigger1 = HitOver
value = 1
[State 5011, go]
type = ChangeState
trigger1 = HitOver
value = 11
ctrl = 1

[Statedef 5020]
type = A
movetype = H
physics = N
velset = 0, 0
[State 5020, a1]
type = ChangeAnim
trigger1 = Time = 0 && GetHitVar(animtype) >= 4 && SelfAnimExist(5051 + GetHitVar(animtype) - 4)
value = 5051 + GetHitVar(animtype) - 4
[State 5020, a2]
type = ChangeAnim
trigger1 = Time = 0 && GetHitVar(animtype) >= 3 && !(GetHitVar(animtype) >= 4 && SelfAnimExist(5051 + GetHitVar(animtype) - 4))
value = 5030
[State 5020, a3]
type = ChangeAnim
trigger1 = Time = 0 && GetHitVar(animtype) < 3
value = IfElse(GetHitVar(airtype) = 1, 5000, 5010) + GetHitVar(animtype)
[State 5020, go]
type = ChangeState
trigger1 = HitShakeOver
value = 5030

[Statedef 5030]
type = A
movetype = H
physics = N
ctrl = 0
[State 5030, a]
type = ChangeAnim
trigger1 = (Anim < 5000 || Anim > 5199) && SelfAnimExist(5030)
value = 5030
[State 5030, v]
type = HitVelSet
trigger1 = Time = 0
x = 1
y = 1
[State 5030, g]
type = VelAdd
trigger1 = Time != 0
y = GetHitVar(yaccel)
[State 5030, f]
type = ChangeState
trigger1 = (HitOver || (Vel Y > 0 && Pos Y >= Const(movement.air.gethit.groundlevel))) && HitFall
value = 5050
[State 5030, n]
type = ChangeState
trigger1 = HitOver || (Vel Y > 0 && Pos Y >= Const(movement.air.gethit.groundlevel))
value = 5040
[State 5030, t]
type = ChangeState
trigger1 = AnimTime = 0
value = 5035

[Statedef 5035]
type = A
movetype = H
physics = N
[State 5035, a]
type = ChangeAnim
trigger1 = Time = 0 && SelfAnimExist(5035) && !(Anim >= 5051 && Anim <= 5059) && Anim != 5090
value = 5035
[State 5035, g]
type = VelAdd
trigger1 = Time > 0
y = GetHitVar(yaccel)
[State 5035, f]
type = ChangeState
trigger1 = (HitOver || AnimTime = 0 || (Vel Y > 0 && Pos Y >= Const(movement.air.gethit.groundlevel)) || (Time = 0 && Anim != 5035)) && HitFall
value = 5050
[State 5035, n]
type = ChangeState
trigger1 = HitOver || AnimTime = 0 || (Vel Y > 0 && Pos Y >= Const(movement.air.gethit.groundlevel)) || (Time = 0 && Anim != 5035)
value = 5040

[Statedef 5040]
type = A
movetype = H
physics = N
[State 5040, ko]
type = ChangeState
trigger1 = !Alive
value = 5050
ctrl = 0
[State 5040, a]
type = ChangeAnim
trigger1 = (AnimTime = 0 && Anim != 5040) || (Time = 0 && Anim != 5035)
value = 5040
[State 5040, c]
type = CtrlSet
trigger1 = HitOver
value = 1
[State 5040, m]
type = StateTypeSet
trigger1 = HitOver
movetype = I
[State 5040, g]
type = VelAdd
trigger1 = Time > 0
y = GetHitVar(yaccel)
[State 5040, l]
type = ChangeState
trigger1 = Vel Y > 0 && Pos Y >= 0
value = 52

[Statedef 5050]
type = A
movetype = H
physics = N
[State 5050, a]
type = ChangeAnim
trigger1 = (AnimTime = 0 && Anim = 5035) || (Time = 0 && Anim != 5035 && !(Anim >= 5051 && Anim <= 5059) && !(Anim >= 5061 && Anim <= 5069) && Anim != 5090)
value = 5050
[State 5050, b]
type = ChangeAnim
persistent = 0
trigger1 = Anim >= 5050 && Anim <= 5059 && Vel Y >= IfElse(Anim = 5050, Const240p(1), Const240p(-2)) && SelfAnimExist(Anim + 10)
value = Anim + 10
[State 5050, g]
type = VelAdd
trigger1 = Time > 0
y = GetHitVar(yaccel)
[State 5050, r1]
type = ChangeState
trigger1 = Alive && CanRecover && Command = "recovery" && Vel Y > 0 && Pos Y >= Const(movement.air.gethit.groundrecover.ground.threshold)
value = 5200
[State 5050, r2]
type = ChangeState
trigger1 = Alive && CanRecover && Command = "recovery" && Vel Y > Const(movement.air.gethit.airrecover.threshold)
value = 5210
[State 5050, land]
type = ChangeState
trigger1 = Vel Y > 0 && Pos Y >= IfElse((Anim >= 5051 && Anim <= 5059) || (Anim >= 5061 && Anim <= 5069), 0, Const(movement.air.gethit.groundlevel))
value = 5100

[Statedef 5070]
type = A
movetype = H
physics = N
velset = 0, 0
[State 5070, a]
type = ChangeAnim
trigger1 = 1
value = 5070
[State 5070, go]
type = ChangeState
trigger1 = HitShakeOver
value = 5071

[Statedef 5071]
type = A
movetype = H
physics = N
[State 5071, v]
type = HitVelSet
trigger1 = Time = 0
x = 1
y = 1
[State 5071, g]
type = VelAdd
trigger1 = Time != 0
y = GetHitVar(yaccel)
[State 5071, l]
type = ChangeState
trigger1 = Vel Y > 0 && Pos Y >= Const(movement.air.gethit.trip.groundlevel)
value = 5110

[Statedef 5080]
type = L
movetype = H
physics = N
velset = 0, 0
[State 5080, a]
type = ChangeAnim
trigger1 = 1
value = IfElse(GetHitVar(yvel) = 0, 5080, IfElse(SelfAnimExist(5090), 5090, 5030))
[State 5080, g]
type = ChangeState
trigger1 = HitShakeOver && GetHitVar(yvel) = 0
value = 5081
[State 5080, g2]
type = ChangeState
trigger1 = HitShakeOver
value = 5030

[Statedef 5081]
type = L
movetype = H
physics = C
[State 5081, v]
type = HitVelSet
trigger1 = Time = 0
x = 1
[State 5081, go]
type = ChangeState
trigger1 = HitOver
value = 5110
[State 5081, vs]
type = VelSet
trigger1 = HitOver
x = 0

[Statedef 5100]
type = L
movetype = H
physics = N
[State 5100, e]
type = FallEnvShake
trigger1 = Time = 0
[State 5100, sv]
type = VarSet
trigger1 = Time = 0
sysvar(1) = Vel Y
[State 5100, a]
type = ChangeAnim
trigger1 = Time = 0
value = IfElse(((Anim >= 5051 && Anim <= 5059) || (Anim >= 5061 && Anim <= 5069)) && SelfAnimExist(5100 + Anim % 10), 5100 + Anim % 10, 5100)
[State 5100, p]
type = PosSet
trigger1 = Time = 0
y = 0
[State 5100, v]
type = VelSet
trigger1 = Time = 0
y = 0
[State 5100, m]
type = VelMul
trigger1 = Time = 0
x = .75
[State 5100, nb]
type = ChangeState
trigger1 = Time = 0 && GetHitVar(fall.yvel) = 0
value = 5110
[State 5100, fx]
type = HitGroundFx
trigger1 = Time = 1
[State 5100, d]
type = HitFallDamage
trigger1 = Time = 3
[State 5100, fr]
type = PosFreeze
trigger1 = 1
[State 5100, go]
type = ChangeState
trigger1 = AnimTime = 0
value = 5101

[Statedef 5101]
type = L
movetype = H
physics = N
[State 5101, a]
type = ChangeAnim
trigger1 = Time = 0
value = IfElse(Anim >= 5101 && Anim <= 5109 && SelfAnimExist(5160 + Anim % 10), 5160 + Anim % 10, 5160)
[State 5101, fv]
type = HitFallVel
trigger1 = Time = 0
[State 5101, p]
type = PosSet
trigger1 = Time = 0
y = Const(movement.down.bounce.offset.y)
[State 5101, p2]
type = PosAdd
trigger1 = Time = 0
x = Const(movement.down.bounce.offset.x)
[State 5101, g]
type = VelAdd
trigger1 = Time > 0
y = Const(movement.down.bounce.yaccel)
[State 5101, l]
type = ChangeState
trigger1 = Vel Y > 0 && Pos Y >= Const(movement.down.bounce.groundlevel)
value = 5110

[Statedef 5110]
type = L
movetype = H
physics = N
[State 5110, a]
type = ChangeAnim
trigger1 = Time = 0 && !(Anim >= 5110 && Anim <= 5119)
value = IfElse(Anim >= 5161 && Anim <= 5169 && SelfAnimExist(5170 + Anim % 10), 5170 + Anim % 10, IfElse(SelfAnimExist(5170), 5170, 5110))
[State 5110, e]
type = FallEnvShake
trigger1 = Time = 0
[State 5110, d]
type = HitFallDamage
trigger1 = Time = 0
[State 5110, p]
type = PosSet
trigger1 = Time = 0
y = 0
[State 5110, fx]
type = HitGroundFx
trigger1 = Time = 0
[State 5110, v]
type = VelSet
trigger1 = Time = 0
y = 0
[State 5110, b]
type = ChangeAnim
persistent = 0
trigger1 = AnimTime = 0 && Anim != 5110 && !(Anim >= 5111 && Anim <= 5119)
value = 5110
[State 5110, ko]
type = ChangeState
trigger1 = !Alive && (AnimTime = 0 || Anim = 5110)
value = 5150
[State 5110, m]
type = VelMul
trigger1 = 1
x = .85
[State 5110, f]
type = VelSet
trigger1 = Abs(Vel X) < Const(movement.down.friction.threshold)
x = 0

[Statedef 5120]
type = L
movetype = I
physics = N
[State 5120, a]
type = ChangeAnim
trigger1 = Time = 0
value = IfElse(SelfAnimExist(5120), 5120, 5110)
[State 5120, v]
type = VelSet
trigger1 = Time = 0
x = 0
[State 5120, n]
type = NotHitBy
trigger1 = 1
value = SCA
time = 1
[State 5120, go]
type = ChangeState
trigger1 = AnimTime = 0
value = 0
ctrl = 1

[Statedef 5150]
type = L
movetype = H
physics = N
sprpriority = -3
ctrl = 0
[State 5150, a]
type = ChangeAnim
trigger1 = Time = 0 && !(Anim >= 5140 && Anim <= 5159) && !(Anim >= 5110 && Anim <= 5119)
value = 5110
[State 5150, m]
type = VelMul
trigger1 = 1
x = .85
[State 5150, f]
type = VelSet
trigger1 = Abs(Vel X) < Const(movement.down.friction.threshold)
x = 0
[State 5150, n]
type = NotHitBy
trigger1 = 1
value = SCA
time = 1

[Statedef 5200]
type = A
movetype = H
physics = N
[State 5200, a]
type = ChangeAnim
trigger1 = Anim = 5035 && AnimTime = 0
value = 5050
[State 5200, g]
type = VelAdd
trigger1 = Time > 0
y = GetHitVar(yaccel)
[State 5200, l]
type = SelfState
trigger1 = Vel Y > 0 && Pos Y >= Const(movement.air.gethit.groundrecover.groundlevel)
value = 5201

[Statedef 5201]
type = A
movetype = H
physics = A
anim = 5200
[State 5201, t]
type = Turn
trigger1 = Time = 0 && P2Dist X < Const240p(-5)
[State 5201, v]
type = VelSet
trigger1 = Time = 0
x = Const(velocity.air.gethit.groundrecover.x)
y = Const(velocity.air.gethit.groundrecover.y)
[State 5201, p]
type = PosSet
trigger1 = Time = 0
y = 0
[State 5201, n]
type = NotHitBy
trigger1 = 1
value = SCA
time = 1

[Statedef 5210]
type = A
movetype = I
physics = N
anim = 5210
ctrl = 0
[State 5210, t]
type = Turn
trigger1 = Time = 0 && P2Dist X < Const240p(-20)
[State 5210, n]
type = NotHitBy
trigger1 = Time = 0
value = SCA
time = 15
[State 5210, fz]
type = PosFreeze
trigger1 = Time = 0
[State 5210, m]
type = VelMul
trigger1 = Time = 4
x = Const(velocity.air.gethit.airrecover.mul.x)
y = Const(velocity.air.gethit.airrecover.mul.y)
[State 5210, a]
type = VelAdd
trigger1 = Time = 4
x = Const(velocity.air.gethit.airrecover.add.x)
y = Const(velocity.air.gethit.airrecover.add.y)
[State 5210, up]
type = VelAdd
trigger1 = Time = 4 && Command = "holdup"
y = Const(velocity.air.gethit.airrecover.up)
[State 5210, dn]
type = VelAdd
trigger1 = Time = 4 && Command = "holddown"
y = Const(velocity.air.gethit.airrecover.down)
[State 5210, fw]
type = VelAdd
trigger1 = Time = 4 && Command = "holdfwd"
x = Const(velocity.air.gethit.airrecover.fwd)
[State 5210, bk]
type = VelAdd
trigger1 = Time = 4 && Command = "holdback"
x = Const(velocity.air.gethit.airrecover.back)
[State 5210, c]
type = CtrlSet
trigger1 = Time = 20
value = 1
[State 5210, g]
type = VelAdd
trigger1 = Time >= 4
y = Const(movement.air.gethit.airrecover.yaccel)
[State 5210, l]
type = ChangeState
trigger1 = Vel Y > 0 && Pos Y >= 0
value = 52
ctrl = 1

[Statedef 5900]
type = S
[State 5900, v]
type = VarRangeSet
trigger1 = RoundsExisted = 0
value = 0
[State 5900, f]
type = VarRangeSet
trigger1 = RoundsExisted = 0
fvalue = 0
[State 5900, i]
type = ChangeState
trigger1 = RoundNo = 1
value = 190
[State 5900, g]
type = ChangeState
trigger1 = 1
value = 0
`;
let COMMON_STATES = null;
function commonStates() {
  if (!COMMON_STATES) COMMON_STATES = MG.parseCns(COMMON_CNS).states;
  return COMMON_STATES;
}
