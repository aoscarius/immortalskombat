#!/usr/bin/env python3
"""Generates the example stage 'Ashen Gate' (MUGEN stage: .def + SFF v2) into content-src/stages/ashen_gate/.
Original artwork drawn with PIL; three parallax layers. Run: python3 tools/make_stage.py"""
import os, struct, random, math
from PIL import Image, ImageDraw, ImageFilter
OUT = os.path.join(os.path.dirname(__file__), '..', 'content-src', 'stages', 'ashen_gate'); os.makedirs(OUT, exist_ok=True)
R = random.Random(11)

def sky(width, height):
    """Sky layer: dusk gradient, a glowing moon and scattered stars (opaque RGBA image)."""
    image = Image.new('RGB', (width, height)); draw = ImageDraw.Draw(image)
    for y in range(height):
        k = y / height; draw.line([(0, y), (width, y)], fill=(int(18 + 70 * k ** 2), int(10 + 22 * k), int(34 + 40 * (1 - k) + 20 * k)))
    glow = Image.new('RGB', (width, height), (0, 0, 0)); glow_draw = ImageDraw.Draw(glow); moon_x, moon_y = width // 2 + 60, 190
    glow_draw.ellipse([moon_x - 150, moon_y - 150, moon_x + 150, moon_y + 150], fill=(150, 70, 40)); glow = glow.filter(ImageFilter.GaussianBlur(70))
    from PIL import ImageChops; image = ImageChops.add(image, glow)
    draw = ImageDraw.Draw(image); draw.ellipse([moon_x - 52, moon_y - 52, moon_x + 52, moon_y + 52], fill=(244, 206, 160)); draw.ellipse([moon_x - 20, moon_y - 30, moon_x + 10, moon_y - 4], fill=(226, 182, 140))
    for _ in range(90): x, y = R.randrange(width), R.randrange(int(height * .6)); brightness = R.randrange(120, 230); draw.point((x, y), fill=(brightness, brightness, brightness))
    return image.convert('RGBA')

def ruins(width, height):
    """Middle layer: a ruined skyline with towers and lit windows (transparent RGBA image)."""
    image = Image.new('RGBA', (width, height), (0, 0, 0, 0)); draw = ImageDraw.Draw(image); base = 470
    draw.polygon([(0, base)] + [(x, base - 70 - 50 * math.sin(x / 140) - R.randrange(25)) for x in range(0, width + 40, 40)] + [(width, base)], fill=(36, 22, 44, 255))
    for center_x in range(130, width, 330):
        top = 150 + R.randrange(90); tower_width = 120
        draw.rectangle([center_x - tower_width // 2, top, center_x + tower_width // 2, base], fill=(26, 16, 34, 255)); draw.rectangle([center_x - tower_width // 2 - 14, top - 18, center_x + tower_width // 2 + 14, top + 6], fill=(32, 20, 40, 255))
        draw.pieslice([center_x - 150, top + 60 - 120, center_x + 150, top + 60 + 120], 180, 360, fill=(0, 0, 0, 0)) if False else None
        for course in range(0, base - top, 46): draw.line([(center_x - tower_width // 2, top + course), (center_x + tower_width // 2, top + course)], fill=(40, 26, 50, 255), width=2)
        for window_y in (top + 70, top + 160): draw.rectangle([center_x - 10, window_y, center_x + 10, window_y + 36], fill=(150, 66, 34, 255))
    return image

def floor(width, height):
    """Front layer: the stone floor with perspective lines, cracks and two braziers (transparent RGBA image)."""
    image = Image.new('RGBA', (width, height), (0, 0, 0, 0)); draw = ImageDraw.Draw(image); ground_y = 462
    for y in range(ground_y, height):
        k = (y - ground_y) / (height - ground_y); draw.line([(0, y), (width, y)], fill=(int(58 - 30 * k), int(40 - 22 * k), int(52 - 28 * k), 255))
    draw.line([(0, ground_y), (width, ground_y)], fill=(150, 90, 70, 255), width=3)
    for x in range(-width, 2 * width, 110): draw.line([(x, height), (width // 2 + (x - width // 2) * .45, ground_y)], fill=(20, 12, 24, 255), width=2)
    for y in (ground_y + 14, ground_y + 38, ground_y + 74): draw.line([(0, y), (width, y)], fill=(24, 14, 28, 255), width=2)
    for _ in range(40): x = R.randrange(width); y = R.randrange(ground_y + 6, height - 4); draw.ellipse([x, y, x + R.randrange(6, 22), y + 3], fill=(86, 50, 60, 120))
    # braziers
    for brazier_x in (width // 2 - 520, width // 2 + 520):
        draw.rectangle([brazier_x - 9, ground_y - 70, brazier_x + 9, ground_y], fill=(30, 18, 36, 255)); draw.polygon([(brazier_x - 26, ground_y - 70), (brazier_x + 26, ground_y - 70), (brazier_x + 18, ground_y - 48), (brazier_x - 18, ground_y - 48)], fill=(44, 26, 52, 255))
        draw.polygon([(brazier_x - 14, ground_y - 70), (brazier_x, ground_y - 124), (brazier_x + 14, ground_y - 70)], fill=(255, 150, 50, 255)); draw.polygon([(brazier_x - 7, ground_y - 70), (brazier_x, ground_y - 100), (brazier_x + 7, ground_y - 70)], fill=(255, 222, 130, 255))
    return image

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

def to_indexed(image):
    """RGBA -> (index bytes, palette[256] of RGB); index 0 is transparent."""
    rgb = image.convert('RGB').quantize(255, method=Image.Quantize.MEDIANCUT); palette = (rgb.getpalette() or [])[:765]; palette += [0] * (765 - len(palette)); indices = bytearray(); alpha = image.getchannel('A').tobytes()
    for position, value in enumerate(rgb.tobytes()): indices.append(0 if alpha[position] < 128 else value + 1)
    return bytes(indices), [(0, 0, 0)] + [tuple(palette[color * 3:color * 3 + 3]) for color in range(255)]

SPR = [(0, 0, sky(1100, 540), True), (1, 0, ruins(1500, 540), False), (2, 0, floor(1700, 540), False)]
def write_sff(path):
    """Writes the three background layers (SPR) as an SFF v2 file with one palette each."""
    header_size = 68; count = len(SPR); palette_table = header_size + count * 28; literal_offset = palette_table + count * 16; data = bytearray(); palette_offsets = []; blocks = []
    for group, item, image, opaque in SPR:
        indices, palette = to_indexed(image.convert('RGBA') if not opaque else image); palette_offsets.append(len(data))
        for red, green, blue in palette: data += bytes([red, green, blue, 255])
    for group, item, image, opaque in SPR:
        indices, palette = to_indexed(image if not opaque else image); blocks.append((len(data), len(rle8(indices)) + 4)); encoded = rle8(indices); data += struct.pack('<I', len(indices)) + encoded
    out = bytearray(b'ElecbyteSpr\0') + bytes([0, 0, 0, 2]) + b'\0' * 16 + struct.pack('<I', 0) + struct.pack('<IIIIIII', header_size, count, palette_table, count, literal_offset, 0, literal_offset); out += b'\0' * (header_size - len(out))
    for index, (group, item, image, opaque) in enumerate(SPR):
        out += struct.pack('<HHHHhhHBBIIHH', group, item, image.width, image.height, image.width // 2, 0, 0, 2, 8, blocks[index][0], blocks[index][1], index, 0)
    for index in range(count): out += struct.pack('<HHHHII', 1, index + 1, 256, 0, palette_offsets[index], 1024)
    open(path, 'wb').write(out + data)

write_sff(os.path.join(OUT, 'ashen_gate.sff'))
open(os.path.join(OUT, 'ashen_gate.def'), 'w').write('''[Info]
name = "Ashen Gate"
displayname = "Ashen Gate"
author = "Immortals Kombat"
mugenversion = 1.0

[Camera]
startx = 0
starty = 0
boundleft = -150
boundright = 150
tension = 60

[PlayerInfo]
p1startx = -130
p1starty = 0
p2startx = 130
p2starty = 0
leftbound = -480
rightbound = 480

[Bound]
screenleft = 20
screenright = 20

[StageInfo]
zoffset = 462
autoturn = 1
resetBG = 1
localcoord = 960,540

[Shadow]
color = 0,0,0
intensity = 120
yscale = .25

[BGdef]
spr = ashen_gate.sff

[BG Sky]
type = normal
spriteno = 0,0
layerno = 0
start = 0,0
delta = .08,1
mask = 0

[BG Ruins]
type = normal
spriteno = 1,0
layerno = 0
start = 0,0
delta = .45,1
mask = 1

[BG Floor]
type = normal
spriteno = 2,0
layerno = 0
start = 0,0
delta = 1,1
mask = 1
''')
print('stage written')
