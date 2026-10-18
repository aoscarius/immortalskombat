; Kaelith command set. Written for this project.
[Remap]
x = x
y = y
z = z
a = a
b = b
c = c
s = s

[Defaults]
command.time = 16
command.buffer.time = 3

[Command]
name = "rage"
command = y+b
time = 2

[Command]
name = "QCF_x"
command = ~D, DF, F, x
[Command]
name = "QCF_y"
command = ~D, DF, F, y
[Command]
name = "DP_x"
command = ~F, D, DF, x
[Command]
name = "DP_y"
command = ~F, D, DF, y
[Command]
name = "QCB_a"
command = ~D, DB, B, a
[Command]
name = "QCB_b"
command = ~D, DB, B, b
[Command]
name = "x"
command = x
time = 1
[Command]
name = "y"
command = y
time = 1
[Command]
name = "a"
command = a
time = 1
[Command]
name = "b"
command = b
time = 1
[Command]
name = "holdfwd"
command = /$F
time = 1
[Command]
name = "holdback"
command = /$B
time = 1
[Command]
name = "holdup"
command = /$U
time = 1
[Command]
name = "holddown"
command = /$D
time = 1

[Statedef -1]

[State -1, Immortal Rage]
type = ChangeState
value = 3000
triggerall = command = "rage"
triggerall = power >= 1000
triggerall = statetype = S
trigger1 = ctrl
trigger2 = movecontact && stateno >= 200 && stateno < 500

[State -1, Rising Strike]
type = ChangeState
value = 1020
triggerall = command = "DP_x" || command = "DP_y"
triggerall = statetype != A
trigger1 = ctrl
trigger2 = movecontact && stateno >= 200 && stateno < 500

[State -1, Frost Orb heavy]
type = ChangeState
value = 1010
triggerall = command = "QCF_y"
triggerall = statetype != A
trigger1 = ctrl
trigger2 = movecontact && stateno >= 200 && stateno < 500

[State -1, Frost Orb light]
type = ChangeState
value = 1000
triggerall = command = "QCF_x"
triggerall = statetype != A
trigger1 = ctrl
trigger2 = movecontact && stateno >= 200 && stateno < 500

[State -1, Comet Kick]
type = ChangeState
value = 1040
triggerall = command = "QCB_a" || command = "QCB_b"
triggerall = statetype != A
trigger1 = ctrl
trigger2 = movecontact && stateno >= 200 && stateno < 500

[State -1, Sweep]
type = ChangeState
value = 440
triggerall = command = "b"
triggerall = command = "holddown"
triggerall = statetype = C
trigger1 = ctrl

[State -1, Crouch heavy punch]
type = ChangeState
value = 410
triggerall = command = "y"
triggerall = command = "holddown"
triggerall = statetype = C
trigger1 = ctrl
trigger2 = movecontact && stateno = 400

[State -1, Crouch light kick]
type = ChangeState
value = 430
triggerall = command = "a"
triggerall = command = "holddown"
triggerall = statetype = C
trigger1 = ctrl

[State -1, Crouch light punch]
type = ChangeState
value = 400
triggerall = command = "x"
triggerall = command = "holddown"
triggerall = statetype = C
trigger1 = ctrl

[State -1, Stand heavy kick]
type = ChangeState
value = 240
triggerall = command = "b"
triggerall = statetype = S
trigger1 = ctrl
trigger2 = movecontact && stateno = 230

[State -1, Stand light kick]
type = ChangeState
value = 230
triggerall = command = "a"
triggerall = statetype = S
trigger1 = ctrl
trigger2 = movecontact && stateno = 200

[State -1, Stand heavy punch]
type = ChangeState
value = 210
triggerall = command = "y"
triggerall = statetype = S
trigger1 = ctrl
trigger2 = movecontact && (stateno = 200 || stateno = 230)

[State -1, Stand light punch]
type = ChangeState
value = 200
triggerall = command = "x"
triggerall = statetype = S
trigger1 = ctrl

[State -1, Jump kick]
type = ChangeState
value = 630
triggerall = command = "a" || command = "b"
triggerall = statetype = A
trigger1 = ctrl
trigger1 = Pos Y < -30

[State -1, Jump punch]
type = ChangeState
value = 600
triggerall = command = "x" || command = "y"
triggerall = statetype = A
trigger1 = ctrl
trigger1 = Pos Y < -30
