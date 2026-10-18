#!/usr/bin/env python3
"""Builds the base character 'Kaelith' as real MUGEN 1.x files (SFF v2 + AIR + CMD + CNS + DEF + SND).
Everything here is original: sprites come from this game's own procedural figure renderer, the
sounds are synthesised, and all state code is written from scratch."""
import os, struct, sys, math, random, colorsys, wave, io
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- sprites
POSES = ['idle0','idle1','idle2','walk0','walk1','walk2','walk3','crouch','cblock','jumpUp','jumpFall','lp0','lp1','hp0','hp1','lk0','lk1','hk0','hk1','clp1','cup0','cup1','ck1','sw0','sw1','jp0','jp1','jk1','block','hit0','hit1','air','lie','getup','taunt','win','cast0','cast1','rise1','rise2','rush','grab0','rage0']
AX, AY = 150, 280                      # axis inside the 300x300 source sprites
imgs = {}
for pose in POSES: imgs[pose] = Image.open(f'{SRC}/{pose}.png').convert('RGBA')
imgs['orb'] = Image.open(f'{SRC}/x_orb.png').convert('RGBA')
imgs['port'] = Image.open(f'{SRC}/x_port.png').convert('RGBA')
imgs['big'] = Image.open(f'{SRC}/x_big.png').convert('RGBA')

# shared 255-colour palette (index 0 = transparent) built from every sprite
keys = list(imgs)
sheet = Image.new('RGB', (300 * 8, 300 * ((len(keys) + 7) // 8)), (0, 0, 0))
for sheet_index, key in enumerate(keys):
    image = imgs[key]; flat = Image.new('RGB', image.size, (0, 0, 0)); flat.paste(image, mask=image.split()[3])
    sheet.paste(flat, ((sheet_index % 8) * 300, (sheet_index // 8) * 300))
pq = sheet.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
pal_flat = pq.getpalette()[:255 * 3]
pal = [(0, 0, 0)] + [tuple(pal_flat[color * 3:color * 3 + 3]) for color in range(255)]
def nearest_table():
    """Returns the shared palette (kept as a function for compatibility with older scripts)."""
    return pal
from functools import lru_cache
@lru_cache(maxsize=None)
def idx_of(rgb):
    """Index (1..255) of the palette colour closest to an (r, g, b) tuple."""
    best_index, best_distance = 1, 1e18
    for index in range(1, 256):
        color = pal[index]
        distance = (color[0] - rgb[0]) ** 2 + (color[1] - rgb[1]) ** 2 + (color[2] - rgb[2]) ** 2
        if distance < best_distance: best_distance, best_index = distance, index
    return best_index

def hue_pal(shift, sat=1.0):
    """Copy of the shared palette with the hue rotated by `shift` (0..1) and saturation scaled by `sat`."""
    shifted = [(0, 0, 0)]
    for red, green, blue in pal[1:]:
        hue, lightness, saturation = colorsys.rgb_to_hls(red / 255, green / 255, blue / 255)
        new_red, new_green, new_blue = colorsys.hls_to_rgb((hue + shift) % 1, lightness, min(1, saturation * sat))
        shifted.append((round(new_red * 255), round(new_green * 255), round(new_blue * 255)))
    return shifted
PALS = [pal, hue_pal(.45), hue_pal(.22, 1.1)]       # blue (default), red, gold

def rle8(data):
    """Compresses palette indices with the SFF v2 RLE8 scheme."""
    encoded = bytearray(); position = 0; length = len(data)
    while position < length:
        value = data[position]; run_end = position
        while run_end < length and data[run_end] == value and run_end - position < 63: run_end += 1
        run = run_end - position
        if run >= 2 or (value & 0xC0) == 0x40: encoded += bytes([0x40 | run, value])
        else: encoded.append(value)
        position = run_end
    return bytes(encoded)

def to_index(image):
    """Converts an RGBA image to palette indices (index 0 = transparent when alpha < 110)."""
    width, height = image.size; pixels = image.load(); indices = bytearray(width * height)
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            indices[y * width + x] = 0 if alpha < 110 else idx_of((red, green, blue))
    return bytes(indices)

sprites = []        # (group, item, w, h, ax, ay, rle data)
def add_sprite(group, item, image, axis):
    """Crops an image to its opaque bounding box and appends it (RLE8 encoded) to `sprites`."""
    bbox = image.split()[3].point(lambda alpha: 255 if alpha >= 110 else 0).getbbox()
    if not bbox: bbox = (0, 0, 1, 1)
    cropped = image.crop(bbox); width, height = cropped.size
    sprites.append((group, item, width, height, axis[0] - bbox[0], axis[1] - bbox[1], rle8(to_index(cropped))))
SPR = {}
for sprite_number, pose in enumerate(POSES):
    add_sprite(0, sprite_number, imgs[pose], (AX, AY)); SPR[pose] = sprite_number
add_sprite(9000, 0, imgs['port'], (0, 0))
add_sprite(9000, 1, imgs['big'], (0, 0))
add_sprite(100, 0, imgs['orb'], (32, 32))
# sprite 0,0 is used as the fall-back portrait source: keep idle0 there (index 0 = idle0 already)

def write_sff(path):
    """Writes every sprite and palette to an SFF v2 file."""
    header_size = 68; sprite_count = len(sprites); palette_count = len(PALS)
    palette_table = header_size + sprite_count * 28
    literal_offset = palette_table + palette_count * 16
    data = bytearray(); palette_offsets = []
    for palette in PALS:
        palette_offsets.append(len(data))
        for red, green, blue in palette: data += bytes([red, green, blue, 255])
    sprite_offsets = []; sprite_sizes = []
    for sprite in sprites:
        block = struct.pack('<I', sprite[2] * sprite[3]) + sprite[6]
        sprite_offsets.append(len(data)); sprite_sizes.append(len(block)); data += block
    out = bytearray(b'ElecbyteSpr\0') + bytes([0, 0, 0, 2]) + b'\0' * 16 + struct.pack('<I', 0)
    out += struct.pack('<IIIIIII', header_size, sprite_count, palette_table, palette_count, literal_offset, 0, literal_offset)
    out += b'\0' * (header_size - len(out))
    for index, sprite in enumerate(sprites):
        group, item, width, height, axis_x, axis_y, _ = sprite
        out += struct.pack('<HHHHhhHBBIIHH', group, item, width, height, axis_x, axis_y, 0, 2, 8, sprite_offsets[index], sprite_sizes[index], 0, 0)
    for index in range(palette_count):
        out += struct.pack('<HHHHII', 1, index + 1, 256, 0, palette_offsets[index], 1024)
    out += data
    open(path, 'wb').write(out)

# ---------------------------------------------------------------- animations
SEQ = {}
def anim(no, frames, loop_last=False):
    """Registers animation number `no` as a list of frames (see f())."""
    SEQ[no] = frames
def f(pose, ticks, **options):
    """One animation frame: pose name, duration in ticks, optional c1=[attack boxes] or scale=."""
    return (pose, ticks, options)

walkf = [f(f'walk{i}', 6) for i in range(4)]
anim(0, [f('idle0', 9), f('idle1', 9), f('idle2', 9), f('idle1', 9)])
anim(5, [f('idle0', 3)])
anim(10, [f('crouch', 4)]); anim(11, [f('crouch', 10)]); anim(12, [f('idle0', 3)])
anim(20, walkf); anim(21, list(reversed(walkf)))
anim(40, [f('crouch', 3)])
for n in (41, 42, 43): anim(n, [f('jumpUp', 16), f('jumpFall', -1)])
anim(47, [f('crouch', 4)])
for n in (100, 105): anim(n, [f('rush', 4), f('walk1', 4)])
for n in (120, 130, 140, 150): anim(n, [f('block', 3 if n != 130 else 6)])
for n in (121, 131, 141, 151): anim(n, [f('cblock', 3 if n != 131 else 6)])
for n in (122, 132, 142, 152): anim(n, [f('block', 3 if n != 132 else 6)])
anim(170, [f('hit0', -1)]); anim(175, [f('hit0', -1)]); anim(180, [f('win', -1)]); anim(181, [f('win', -1)])
anim(190, [f('taunt', 12), f('idle0', 12), f('taunt', 14)]); anim(191, [f('idle0', 10)])
# get-hit
for n in (5000, 5001, 5002): anim(n, [f('hit0' if n != 5002 else 'hit1', -1)])
for n in (5010, 5011, 5012): anim(n, [f('hit1', -1)])
for n in (5020, 5021, 5022): anim(n, [f('air', -1)])
anim(5030, [f('air', -1)]); anim(5035, [f('air', -1)]); anim(5040, [f('lie', -1)]); anim(5050, [f('air', -1)])
anim(5051, [f('air', -1)]); anim(5052, [f('air', -1)]); anim(5060, [f('air', -1)])
anim(5070, [f('lie', -1)]); anim(5080, [f('lie', -1)]); anim(5090, [f('air', -1)]); anim(5100, [f('air', 4)])
anim(5110, [f('lie', -1)]); anim(5120, [f('getup', 8), f('crouch', 6)]); anim(5150, [f('lie', -1)]); anim(5160, [f('getup', 8)])
anim(5200, [f('hit0', 10)]); anim(5201, [f('hit0', 10)]); anim(5210, [f('hit0', 10)])

# attacks: (pose, ticks, clsn1 or None)
def box(x1, y1, x2, y2):
    """A collision box as a tuple (left, top, right, bottom)."""
    return (x1, y1, x2, y2)
anim(200, [f('lp0', 3), f('lp1', 3, c1=[box(30, -162, 112, -118)]), f('lp0', 4)])
anim(210, [f('hp0', 5), f('hp1', 4, c1=[box(30, -170, 135, -112)]), f('hp1', 3), f('hp0', 7)])
anim(230, [f('lk0', 4), f('lk1', 3, c1=[box(30, -110, 118, -55)]), f('lk0', 5)])
anim(240, [f('hk0', 6), f('hk1', 4, c1=[box(25, -170, 140, -95)]), f('hk1', 3), f('hk0', 8)])
anim(400, [f('crouch', 3), f('clp1', 3, c1=[box(30, -100, 110, -62)]), f('crouch', 4)])
anim(410, [f('cup0', 5), f('cup1', 4, c1=[box(20, -200, 92, -90)]), f('cup1', 4), f('crouch', 8)])
anim(430, [f('crouch', 3), f('ck1', 3, c1=[box(25, -50, 128, -8)]), f('crouch', 5)])
anim(440, [f('sw0', 6), f('sw1', 5, c1=[box(25, -42, 150, 0)]), f('sw1', 3), f('sw0', 10)])
anim(600, [f('jp0', 3), f('jp1', 12, c1=[box(25, -140, 100, -80)])])
anim(630, [f('jk1', 14, c1=[box(15, -92, 108, -28)])])
anim(1000, [f('cast0', 7), f('cast1', 6), f('cast1', 12), f('cast0', 6)])
anim(1020, [f('rise1', 5), f('rise2', 6, c1=[box(15, -208, 88, -92)]), f('rise2', 10, c1=[box(15, -208, 88, -92)]), f('jumpFall', -1)])
anim(1040, [f('hk0', 5), f('rush', 18, c1=[box(15, -120, 150, -50)]), f('hk0', 12)])
anim(3000, [f('rage0', 10), f('rage0', 10), f('cast1', 14), f('cast0', 12)])
SEQ[1100] = [('orb', 4, {})]; SEQ[1101] = [('orb', 3, dict(scale=1.6))]; SEQ[3100] = [('orb', 4, dict(scale=2.4))]

DEFAULT_C2 = {'stand': box(-26, -178, 28, 0), 'crouch': box(-32, -104, 34, 0), 'air': box(-26, -158, 26, -14), 'lie': box(-80, -46, 80, 0)}
def c2_for(no, pose):
    """Body (Clsn2) box for a pose of animation `no`: crouching, airborne, lying or standing."""
    if pose in ('crouch', 'cblock', 'clp1', 'cup0', 'cup1', 'ck1', 'sw0', 'sw1'): return DEFAULT_C2['crouch']
    if pose in ('jumpUp', 'jumpFall', 'jp0', 'jp1', 'jk1', 'air', 'rise1', 'rise2', 'rush'): return DEFAULT_C2['air']
    if pose in ('lie', 'getup'): return DEFAULT_C2['lie']
    return DEFAULT_C2['stand']

air_lines = ['; Kaelith - animations (original work for Immortals Kombat)', '']
for no in sorted(SEQ):
    air_lines.append(f'[Begin Action {no}]')
    for pose, ticks, options in SEQ[no]:
        if pose == 'orb': pass
        else:
            body_box = c2_for(no, pose)
            air_lines.append(f'Clsn2: 1'); air_lines.append(f' Clsn2[0] = {body_box[0]},{body_box[1]},{body_box[2]},{body_box[3]}')
            if options.get('c1'):
                air_lines.append(f'Clsn1: {len(options["c1"])}')
                for box_index, attack_box in enumerate(options['c1']): air_lines.append(f' Clsn1[{box_index}] = {attack_box[0]},{attack_box[1]},{attack_box[2]},{attack_box[3]}')
        if pose == 'orb':
            if no in (1100, 1101, 3100):
                air_lines.append('Clsn1: 1'); air_lines.append(' Clsn1[0] = -26,-26,26,26')
            air_lines.append(f'100,0, 0,0, {ticks}' + (f', , , {options["scale"]},{options["scale"]}' if 'scale' in options else ''))
        else:
            air_lines.append(f'0,{SPR[pose]}, 0,0, {ticks}')
    air_lines.append('')
open(f'{OUT}/kaelith.air', 'w').write('\n'.join(air_lines))
write_sff(f'{OUT}/kaelith.sff')

# ---------------------------------------------------------------- sounds
def synth(kind):
    """Synthesises one sound effect ('whoosh', 'hit', 'orb', ...) and returns it as WAV bytes."""
    sample_rate = 22050; noise = random.Random(7)
    duration = {'whoosh': .16, 'whoosh2': .22, 'hit': .16, 'hit2': .26, 'block': .1, 'orb': .4, 'land': .12, 'ko': .8}[kind]
    samples = []
    for index in range(int(sample_rate * duration)):
        t = index / sample_rate; progress = index / (sample_rate * duration); envelope = (1 - progress) ** 2
        if kind.startswith('whoosh'):
            value = (noise.random() * 2 - 1) * math.sin(math.pi * progress) * .5
        elif kind.startswith('hit'):
            base_freq = 150 - 90 * progress if kind == 'hit' else 110 - 60 * progress
            value = (math.sin(2 * math.pi * base_freq * t) * .8 + (noise.random() * 2 - 1) * .55 * (1 - progress)) * envelope
        elif kind == 'block':
            value = (math.sin(2 * math.pi * (300 - 150 * progress) * t) * .5 + (noise.random() * 2 - 1) * .4) * envelope
        elif kind == 'orb':
            value = math.sin(2 * math.pi * (200 + 500 * progress) * t) * .4 * (math.sin(math.pi * progress)) + (noise.random() * 2 - 1) * .1
        elif kind == 'land':
            value = (math.sin(2 * math.pi * 80 * t) * .8 + (noise.random() * 2 - 1) * .3) * envelope
        else:
            value = (math.sin(2 * math.pi * (70 - 30 * progress) * t) * .8 + (noise.random() * 2 - 1) * .3) * envelope
        samples.append(int(max(-1, min(1, value)) * 20000))
    buffer = io.BytesIO(); wav_file = wave.open(buffer, 'wb'); wav_file.setnchannels(1); wav_file.setsampwidth(2); wav_file.setframerate(sample_rate); wav_file.writeframes(struct.pack('<%dh' % len(samples), *samples)); wav_file.close()
    return buffer.getvalue()
SOUNDS = [(0, 0, 'whoosh'), (0, 1, 'whoosh2'), (1, 0, 'orb'), (2, 0, 'land'), (3, 0, 'ko'), (5, 0, 'hit'), (5, 1, 'hit2'), (6, 0, 'block')]
snd = bytearray(b'ElecbyteSnd\0' + bytes([0, 0, 1, 0])) + struct.pack('<II', len(SOUNDS), 32)
snd += b'\0' * (32 - len(snd))
for sound_index, (group, item, kind) in enumerate(SOUNDS):
    wav = synth(kind); start = len(snd); next_offset = start + 16 + len(wav) if sound_index < len(SOUNDS) - 1 else 0
    snd += struct.pack('<IIII', next_offset, len(wav), group, item) + wav
open(f'{OUT}/kaelith.snd', 'wb').write(snd)

# ---------------------------------------------------------------- text files
open(f'{OUT}/kaelith.def', 'w').write('''; Kaelith, the Frostbound Hunter. Original character for Immortals Kombat.
[Info]
name = "Kaelith"
displayname = "Kaelith"
versiondate = 10,11,2026
mugenversion = 1.0
author = "Immortals Kombat"
pal.defaults = 1,2,3
localcoord = 960,540

[Files]
cmd = kaelith.cmd
cns = kaelith.cns
st = kaelith.cns
sprite = kaelith.sff
anim = kaelith.air
sound = kaelith.snd

[Palette Keymap]
x = 1
y = 2
z = 3
''')

open(f'{OUT}/kaelith.cmd', 'w').write(r'''; Kaelith command set. Written for this project.
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
''')

def hitdef(attr, dmg, gdmg, pause, ghit, gvel, extra='', sound='5,0', air='-4,-6', gslide=None, guardvel=None, guardflag='MA'):
    """Returns the CNS text of a HitDef controller (damage, hit/guard times, velocities)."""
    return f'''[State 0, hit]
type = HitDef
trigger1 = Time = 0
attr = {attr}
damage = {dmg}, {gdmg}
guardflag = {guardflag}
hitflag = MAF
priority = 3, Hit
pausetime = {pause[0]}, {pause[1]}
hitsound = {sound}
guardsound = 6,0
ground.type = {extra if extra else 'High'}
ground.slidetime = {gslide if gslide is not None else ghit - 2}
ground.hittime = {ghit}
ground.velocity = {gvel}
guard.slidetime = 8
guard.hittime = 10
guard.velocity = {guardvel if guardvel is not None else gvel * 1.1}
air.velocity = {air}
air.hittime = 16
airguard.velocity = -4,-2
'''

def stand_attack(no, cond_anim, attr, dmg, pause, ghit, gvel, snd_w, sound='5,0', next_state=0, kind='S', extra='', juggle=2, gdmg=2, power=40, low=False):
    """Returns the CNS text of a complete attack state: Statedef, HitDef, whoosh sound and return to idle."""
    state_type = kind
    ctrl_state = 11 if state_type == 'C' else 0
    state_text = f'''[Statedef {no}]
type = {state_type}
movetype = A
physics = {'C' if state_type == 'C' else 'S'}
juggle = {juggle}
poweradd = {power}
ctrl = 0
anim = {no}
velset = 0, 0
sprpriority = 2

'''
    hitdef_text = hitdef(attr, dmg, gdmg, pause, ghit, gvel, extra or 'High', sound, guardflag='L' if low else 'MA')
    hitdef_text = hitdef_text.replace('[State 0, hit]', f'[State {no}, hit]')
    state_text += hitdef_text
    state_text += f'''
[State {no}, whoosh]
type = PlaySnd
trigger1 = Time = 1
value = 0,{1 if dmg >= 35 else 0}

[State {no}, end]
type = ChangeState
trigger1 = AnimTime = 0
value = {ctrl_state}
ctrl = 1
'''
    return state_text

cns = ['''; Kaelith constants and states. Original code for Immortals Kombat.
; Coordinates use localcoord 960x540 (1 unit = 1 screen pixel at 960x540).
[Data]
life = 1000
attack = 100
defence = 100
fall.defence_up = 50
liedown.time = 60
airjuggle = 15
sparkno = -1
guard.sparkno = -1
KO.echo = 0
volume = 0
IntPersistIndex = 60
FloatPersistIndex = 40

[Size]
xscale = 1
yscale = 1
ground.back = 28
ground.front = 32
air.back = 24
air.front = 24
height = 170
attack.dist = 150
proj.attack.dist = 260
proj.doscale = 0
head.pos = -10, -170
mid.pos = -10, -110
shadowoffset = 0
draw.offset = 0, 0

[Velocity]
walk.fwd = 4.6
walk.back = -3.8
run.fwd = 9, 0
run.back = -9, -8
jump.neu = 0, -19
jump.back = -5.3
jump.fwd = 5.6
runjump.back = -5.6, -18
runjump.fwd = 8, -18
airjump.neu = 0, -18
airjump.back = -5
airjump.fwd = 5

[Movement]
airjump.num = 0
airjump.height = 70
yaccel = .95
stand.friction = .85
crouch.friction = .82
''']

cns.append(stand_attack(200, 200, 'S, NA', 28, (8, 9), 13, -6, 0, juggle=1))
cns.append(stand_attack(210, 210, 'S, NA', 52, (10, 11), 17, -9, 0, sound='5,1', gdmg=5, power=60, juggle=3))
cns.append(stand_attack(230, 230, 'S, NA', 34, (9, 10), 14, -7, 0, juggle=1))
cns.append(stand_attack(240, 240, 'S, NA', 66, (11, 12), 20, -12, 0, sound='5,1', gdmg=6, power=70, juggle=3))
cns.append(stand_attack(400, 400, 'C, NA', 24, (8, 9), 12, -5, 0, kind='C', extra='Low', juggle=1))
cns.append(stand_attack(430, 430, 'C, NA', 30, (8, 9), 13, -6, 0, kind='C', extra='Low', juggle=1, low=True))
# crouch heavy punch = launcher
cns.append(f'''[Statedef 410]
type = C
movetype = A
physics = C
juggle = 5
poweradd = 70
ctrl = 0
anim = 410
velset = 0, 0
sprpriority = 2

[State 410, whoosh]
type = PlaySnd
trigger1 = Time = 1
value = 0,1

[State 410, hit]
type = HitDef
trigger1 = Time = 0
attr = C, NA
damage = 58, 6
guardflag = MA
hitflag = MAF
priority = 3, Hit
pausetime = 11, 12
hitsound = 5,1
guardsound = 6,0
ground.type = High
ground.slidetime = 14
ground.hittime = 22
ground.velocity = -3, -15
fall = 1
fall.recover = 0
guard.slidetime = 9
guard.hittime = 12
guard.velocity = -9
air.velocity = -3, -15
air.fall = 1
airguard.velocity = -4,-2

[State 410, end]
type = ChangeState
trigger1 = AnimTime = 0
value = 11
ctrl = 1
''')
# sweep
cns.append(f'''[Statedef 440]
type = C
movetype = A
physics = C
juggle = 2
poweradd = 60
ctrl = 0
anim = 440
velset = 0, 0
sprpriority = 2

[State 440, whoosh]
type = PlaySnd
trigger1 = Time = 1
value = 0,1

[State 440, hit]
type = HitDef
trigger1 = Time = 0
attr = C, NA
damage = 48, 4
guardflag = L
hitflag = MAF
priority = 3, Hit
pausetime = 10, 11
hitsound = 5,1
guardsound = 6,0
ground.type = Trip
ground.slidetime = 14
ground.hittime = 22
ground.velocity = -6, -9
fall = 1
fall.recover = 0
guard.slidetime = 10
guard.hittime = 13
guard.velocity = -10
air.velocity = -5, -9

[State 440, end]
type = ChangeState
trigger1 = AnimTime = 0
value = 11
ctrl = 1
''')
# air normals
for no, attr, dmg, snd in ((600, 'A, NA', 30, '5,0'), (630, 'A, NA', 40, '5,0')):
    cns.append(f'''[Statedef {no}]
type = A
movetype = A
physics = A
juggle = 2
poweradd = 30
ctrl = 0
anim = {no}
sprpriority = 2

[State {no}, whoosh]
type = PlaySnd
trigger1 = Time = 1
value = 0,0

[State {no}, hit]
type = HitDef
trigger1 = Time = 0
attr = A, NA
damage = {dmg}, 3
guardflag = HA
hitflag = MAF
priority = 3, Hit
pausetime = 8, 9
hitsound = {snd}
guardsound = 6,0
ground.type = High
ground.slidetime = 12
ground.hittime = 14
ground.velocity = -5
guard.slidetime = 8
guard.hittime = 10
guard.velocity = -8
air.velocity = -4, -6
air.hittime = 16
airguard.velocity = -4,-2
''')
# frost orb
for no, vx, dmg, spd in ((1000, 'light', 40, 13), (1010, 'heavy', 52, 20)):
    cns.append(f'''[Statedef {no}]
type = S
movetype = A
physics = S
juggle = 1
ctrl = 0
anim = 1000
velset = 0, 0
sprpriority = 2
poweradd = 50

[State {no}, snd]
type = PlaySnd
trigger1 = Time = 8
value = 1,0

[State {no}, orb]
type = Projectile
trigger1 = AnimElem = 2
projid = 1000
projanim = 1100
projhitanim = 1101
projremanim = 1101
projremove = 1
projhits = 1
projpriority = 2
projmisstime = 1
projscale = 1, 1
offset = 78, -112
velocity = {spd}, 0
attr = S, SP
damage = {dmg}, 6
guardflag = MA
hitflag = MAF
priority = 3, Hit
pausetime = 0, 10
hitsound = 5,1
guardsound = 6,0
ground.type = High
ground.slidetime = 14
ground.hittime = 18
ground.velocity = -7
guard.slidetime = 10
guard.hittime = 12
guard.velocity = -9
air.velocity = -5, -9
air.hittime = 18

[State {no}, end]
type = ChangeState
trigger1 = AnimTime = 0
value = 0
ctrl = 1
''')
# rising strike
cns.append('''[Statedef 1020]
type = A
movetype = A
physics = A
juggle = 4
ctrl = 0
anim = 1020
sprpriority = 2
poweradd = 80

[State 1020, jump]
type = VelSet
trigger1 = Time = 0
x = 2.5
y = -18

[State 1020, snd]
type = PlaySnd
trigger1 = Time = 1
value = 0,1

[State 1020, hit]
type = HitDef
trigger1 = Time = 0
attr = S, SA
damage = 70, 7
guardflag = MA
hitflag = MAF
priority = 3, Hit
pausetime = 12, 13
hitsound = 5,1
guardsound = 6,0
ground.type = High
ground.slidetime = 16
ground.hittime = 22
ground.velocity = -3, -15
fall = 1
fall.recover = 0
guard.slidetime = 10
guard.hittime = 13
guard.velocity = -9
air.velocity = -3, -15
air.fall = 1
airguard.velocity = -4,-2
''')
# comet kick (ground rush)
cns.append('''[Statedef 1040]
type = S
movetype = A
physics = N
juggle = 3
ctrl = 0
anim = 1040
velset = 0, 0
sprpriority = 2
poweradd = 60

[State 1040, rush]
type = VelSet
trigger1 = AnimElemTime(2) >= 0 && AnimElemTime(2) < 18
x = 12

[State 1040, stop]
type = VelSet
trigger1 = AnimElemTime(3) >= 0
x = 0

[State 1040, snd]
type = PlaySnd
trigger1 = AnimElemTime(2) = 0
value = 0,1

[State 1040, hit]
type = HitDef
trigger1 = Time = 0
attr = S, SA
damage = 62, 6
guardflag = MA
hitflag = MAF
priority = 3, Hit
pausetime = 10, 11
hitsound = 5,1
guardsound = 6,0
ground.type = High
ground.slidetime = 14
ground.hittime = 20
ground.velocity = -9
guard.slidetime = 10
guard.hittime = 13
guard.velocity = -11
air.velocity = -6, -9

[State 1040, end]
type = ChangeState
trigger1 = AnimTime = 0
value = 0
ctrl = 1
''')
# super
cns.append('''[Statedef 3000]
type = S
movetype = A
physics = S
juggle = 0
ctrl = 0
anim = 3000
velset = 0, 0
sprpriority = 3

[State 3000, cost]
type = PowerAdd
trigger1 = Time = 0
value = -1000

[State 3000, pause]
type = SuperPause
trigger1 = Time = 0
time = 30
anim = -1
sound = 1,0
darken = 1

[State 3000, wave]
type = Projectile
trigger1 = AnimElem = 3
projid = 3000
projanim = 3100
projhitanim = 1101
projremanim = 1101
projremove = 0
projhits = 6
projpriority = 4
projmisstime = 8
offset = 90, -110
velocity = 9, 0
attr = S, HP
damage = 90, 20
guardflag = MA
hitflag = MAF
priority = 4, Hit
pausetime = 0, 12
hitsound = 5,1
guardsound = 6,0
ground.type = High
ground.slidetime = 16
ground.hittime = 24
ground.velocity = -12, -10
fall = 1
air.velocity = -9, -10
air.fall = 1

[State 3000, end]
type = ChangeState
trigger1 = AnimTime = 0
value = 0
ctrl = 1
''')
open(f'{OUT}/kaelith.cns', 'w').write('\n'.join(cns))
print('ok', len(sprites), 'sprites', len(SEQ), 'anims')
