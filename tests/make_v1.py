#!/usr/bin/env python3
"""Test helper: writes a copy of the base character with an SFF v1 (PCX) sprite file, to exercise the v1 reader."""
import sys, os, struct, shutil
sys.argv = ['x', 'tools/sprite-src', '/tmp/_ignore']
src = open('tools/make_char.py').read()
# reuse the sprite preparation part of make_char.py (everything before write_sff)
head = src[:src.index('def write_sff')]
ns = {}; exec(compile(head, 'make_char_head', 'exec'), ns)
sprites, pal = ns['sprites'], ns['pal']
out = sys.argv[1] if False else 'tests/out/kaelith_v1'
shutil.rmtree(out, ignore_errors=True); shutil.copytree('content-src/chars/kaelith', out)
# decode the RLE8 data back to raw indices (the v2 writer stores RLE8) and re-encode as PCX
def unrle8(data, count):
    """Decodes SFF v2 RLE8 data into `count` raw palette indices."""
    decoded = bytearray(); position = 0
    while len(decoded) < count:
        byte = data[position]; position += 1
        if (byte & 0xC0) == 0x40: run = byte & 0x3F; value = data[position]; position += 1; decoded += bytes([value]) * run
        else: decoded.append(byte)
    return bytes(decoded[:count])
def pcx(width, height, indices, palette):
    """Encodes palette indices as an 8-bit RLE PCX image (the palette is appended when given)."""
    bytes_per_line = width + (width & 1); header = bytearray(128); header[0] = 10; header[1] = 5; header[2] = 1; header[3] = 8
    struct.pack_into('<HHHH', header, 4, 0, 0, width - 1, height - 1); header[65] = 1; struct.pack_into('<H', header, 66, bytes_per_line)
    body = bytearray()
    for y in range(height):
        row = indices[y * width:(y + 1) * width] + b'\0' * (bytes_per_line - width); position = 0
        while position < bytes_per_line:
            value = row[position]; run_end = position
            while run_end < bytes_per_line and row[run_end] == value and run_end - position < 63: run_end += 1
            run = run_end - position
            if run > 1 or value >= 0xC0: body += bytes([0xC0 | run, value])
            else: body.append(value)
            position = run_end
    data = bytes(header) + bytes(body)
    if palette is not None: data += b'\x0c' + b''.join(bytes(color) for color in palette)
    return data
blocks = []
for number, (group, item, width, height, axis_x, axis_y, rle) in enumerate(sprites):
    indices = unrle8(rle, width * height)
    blocks.append((group, item, width, height, axis_x, axis_y, pcx(width, height, indices, pal if number == 0 else None), number == 0))
header = bytearray(512); header[0:12] = b'ElecbyteSpr\0'; header[12:16] = bytes([0, 1, 0, 1]) ; struct.pack_into('<IIII', header, 16, 1, len(blocks), 512, 32)
body = bytearray(); offset = 512
for index, (group, item, width, height, axis_x, axis_y, data, is_first) in enumerate(blocks):
    next_offset = offset + 32 + len(data) if index < len(blocks) - 1 else 0
    subheader = struct.pack('<IIhhHHHB', next_offset, len(data), axis_x, axis_y, group, item, 0, 0 if is_first else 1) + b'\0' * 13
    body += subheader + data; offset = next_offset
open(out + '/kaelith.sff', 'wb').write(bytes(header) + bytes(body))
print('v1 sff written', len(blocks), 'sprites', os.path.getsize(out + '/kaelith.sff'), 'bytes')
