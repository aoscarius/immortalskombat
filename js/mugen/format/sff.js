/* =====================================================================
   SFF reader: MUGEN sprite archives ("ElecbyteSpr"), versions 1 and 2,
   plus the sprite pixel decoders, palette helpers and the sprite canvas cache.

   SFF v1 (MUGEN 1.0): a linked list of sub-files. Each node is a 32-byte
   header (next offset, data size, axis, group, index, link, "same palette"
   flag) followed by a PCX image (RLE or raw, 8-bit paletted). The palette is
   the 768-byte tail of the PCX, or is shared with the previous sprite.

   SFF v2 (MUGEN 1.1): fixed-size tables. A palette table (16 bytes per
   entry), then a sprite table (28 bytes per entry) pointing into "literal"
   or "translated" data blocks. Pixel formats: 0 raw, 2 RLE8, 3 RLE5, 4 LZ5,
   10 indexed PNG, 11/12 RGBA PNG.

   Decoded sprite objects look like
     { g, i, ax, ay, w, h, idx (palette indices) | rgba (true colour), pal, link, ... }
   Pixel data is decoded lazily by MG.ensure() the first time a sprite is drawn.
   ===================================================================== */

/* ------------------------------ sprite decoders ------------------------------ */

/**
 * Decodes SFF v2 RLE8 data into palette indices.
 * A byte 01xxxxxx means "repeat the next byte xxxxxx times"; any other byte is one literal pixel.
 * @param {Uint8Array} source compressed bytes
 * @param {number} pixelCount number of pixels to produce (width * height)
 * @returns {Uint8Array} palette indices
 */
function rle8(source, pixelCount) {
  const pixels = new Uint8Array(pixelCount);
  let readPos = 0,
    writePos = 0;
  if (!source.length) return pixels;
  while (writePos < pixelCount) {
    let runLength = 1,
      value = source[readPos];
    if (readPos < source.length - 1) readPos++;
    if ((value & 0xc0) === 0x40) {
      runLength = value & 0x3f;
      value = source[readPos];
      if (readPos < source.length - 1) readPos++;
    }
    for (; runLength > 0; runLength--) if (writePos < pixelCount) pixels[writePos++] = value;
  }
  return pixels;
}

/**
 * Decodes SFF v2 RLE5 data into palette indices.
 * Each packet gives a first run length, a count of following (colour, run) pairs and optionally
 * an explicit first colour; the pairs pack a 5-bit colour with a 3-bit run length.
 * @param {Uint8Array} source compressed bytes
 * @param {number} pixelCount number of pixels to produce
 * @returns {Uint8Array} palette indices
 */
function rle5(source, pixelCount) {
  const pixels = new Uint8Array(pixelCount);
  let readPos = 0,
    writePos = 0;
  if (!source.length) return pixels;
  while (writePos < pixelCount) {
    let runLeft = source[readPos];
    if (readPos < source.length - 1) readPos++;
    let pairsLeft = source[readPos] & 0x7f,
      color = 0;
    if (source[readPos] >> 7) {
      // High bit set: an explicit colour byte follows.
      if (readPos < source.length - 1) readPos++;
      color = source[readPos];
    }
    if (readPos < source.length - 1) readPos++;
    for (;;) {
      if (writePos < pixelCount) pixels[writePos++] = color;
      runLeft--;
      if (runLeft < 0) {
        pairsLeft--;
        if (pairsLeft < 0) break;
        color = source[readPos] & 0x1f;
        runLeft = source[readPos] >> 5;
        if (readPos < source.length - 1) readPos++;
      }
    }
  }
  return pixels;
}

/**
 * Decodes SFF v2 LZ5 data into palette indices.
 * A control byte supplies 8 flags (LSB first); a set flag means "copy from earlier output"
 * (short form: 6-bit length with a 2-bit slice of the offset kept in `recycled` bits;
 * long form when the low 6 bits are zero), a clear flag means a run of one colour.
 * @param {Uint8Array} source compressed bytes
 * @param {number} pixelCount number of pixels to produce
 * @returns {Uint8Array} palette indices
 */
function lz5(source, pixelCount) {
  const pixels = new Uint8Array(pixelCount);
  if (!source.length) return pixels;
  let readPos = 0,
    writePos = 0,
    count = 0,
    controlByte = source[readPos],
    flagIndex = 0,
    recycledBits = 0,
    recycledBitCount = 0;
  if (readPos < source.length - 1) readPos++;
  while (writePos < pixelCount) {
    let byte = source[readPos];
    if (readPos < source.length - 1) readPos++;
    if (controlByte & (1 << flagIndex)) {
      // Back-reference: copy `count + 1` pixels from `distance` pixels back.
      if ((byte & 0x3f) === 0) {
        byte = ((byte << 2) | source[readPos]) + 1;
        if (readPos < source.length - 1) readPos++;
        count = source[readPos] + 2;
        if (readPos < source.length - 1) readPos++;
      } else {
        recycledBits |= (byte & 0xc0) >> recycledBitCount;
        recycledBitCount += 2;
        count = byte & 0x3f;
        if (recycledBitCount < 8) {
          byte = source[readPos] + 1;
          if (readPos < source.length - 1) readPos++;
        } else {
          byte = recycledBits + 1;
          recycledBits = 0;
          recycledBitCount = 0;
        }
      }
      const distance = byte;
      for (;;) {
        if (writePos < pixelCount) {
          pixels[writePos] = writePos - distance >= 0 ? pixels[writePos - distance] : 0;
          writePos++;
        }
        count--;
        if (count < 0) break;
      }
    } else {
      // Literal run: either (colour, count) packed in one byte or an extended count byte.
      if ((byte & 0xe0) === 0) {
        count = source[readPos] + 8;
        if (readPos < source.length - 1) readPos++;
      } else {
        count = byte >> 5;
        byte &= 0x1f;
      }
      for (; count > 0; count--) if (writePos < pixelCount) pixels[writePos++] = byte;
    }
    flagIndex++;
    if (flagIndex >= 8) {
      controlByte = source[readPos];
      flagIndex = 0;
      if (readPos < source.length - 1) readPos++;
    }
  }
  return pixels;
}

/**
 * Decodes the PCX run-length data of an SFF v1 sprite into palette indices.
 * Bytes >= 0xC0 start a run (low 6 bits = length); each scanline is `bytesPerLine` bytes
 * long but only `width` of them are pixels (the rest is padding).
 * @param {Uint8Array} source PCX pixel data
 * @param {number} width image width
 * @param {number} height image height
 * @param {number} bytesPerLine PCX scanline stride
 * @returns {Uint8Array} palette indices (width * height)
 */
function pcxDecode(source, width, height, bytesPerLine) {
  const pixels = new Uint8Array(width * height);
  let readPos = 0,
    writePos = 0,
    column = 0;
  if (!source.length) return pixels;
  while (writePos < pixels.length && readPos < source.length) {
    let runLength = 1,
      value = source[readPos++];
    if (value >= 0xc0) {
      runLength = value & 0x3f;
      value = source[readPos++];
    }
    for (; runLength > 0; runLength--) {
      if (column < width && writePos < pixels.length) pixels[writePos++] = value;
      column++;
      if (column === bytesPerLine) {
        column = 0;
        runLength = 1; // runs never cross a scanline: drop the rest of this one
      }
    }
  }
  return pixels;
}

/**
 * Decodes an indexed (colour type 3), non-interlaced PNG into palette indices.
 * Uses the browser's DecompressionStream for the zlib data and reverses the PNG scanline filters by hand.
 * Throws when the PNG is not of that simple kind so the caller can fall back to pngRgba().
 * @param {Uint8Array} bytes PNG file bytes
 * @returns {Promise<{w: number, h: number, idx: Uint8Array}>} size and indices
 */
async function pngIndexed(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, // skip the 8-byte PNG signature
    width = 0,
    height = 0,
    bitDepth = 8,
    colorType = 0,
    interlace = 0;
  const dataChunks = [];
  let totalDataLength = 0;
  // Walk the chunks: IHDR gives the format, IDAT chunks hold the compressed pixels.
  while (offset + 8 <= bytes.length) {
    const chunkLength = view.getUint32(offset),
      chunkType = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (chunkType === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      bitDepth = bytes[offset + 16];
      colorType = bytes[offset + 17];
      interlace = bytes[offset + 20];
    } else if (chunkType === 'IDAT') {
      dataChunks.push(bytes.subarray(offset + 8, offset + 8 + chunkLength));
      totalDataLength += chunkLength;
    } else if (chunkType === 'IEND') break;
    offset += 12 + chunkLength; // length + type + data + CRC
  }
  if (colorType !== 3 || interlace !== 0) throw new Error('png not simple indexed');
  const compressed = new Uint8Array(totalDataLength);
  let copyPos = 0;
  for (const chunk of dataChunks) {
    compressed.set(chunk, copyPos);
    copyPos += chunk.length;
  }
  const decompressor = new DecompressionStream('deflate'),
    writer = decompressor.writable.getWriter();
  writer.write(compressed);
  writer.close();
  const raw = new Uint8Array(await new Response(decompressor.readable).arrayBuffer());
  const bytesPerLine = Math.ceil((width * bitDepth) / 8),
    indices = new Uint8Array(width * height),
    previousLine = new Uint8Array(bytesPerLine),
    currentLine = new Uint8Array(bytesPerLine),
    bytesPerPixel = Math.max(1, bitDepth >> 3);
  let readPos = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[readPos++];
    for (let x = 0; x < bytesPerLine; x++) {
      const filtered = raw[readPos++],
        left = x >= bytesPerPixel ? currentLine[x - bytesPerPixel] : 0,
        up = previousLine[x],
        upLeft = x >= bytesPerPixel ? previousLine[x - bytesPerPixel] : 0;
      let predictor;
      if (filterType === 0)
        predictor = 0; // None
      else if (filterType === 1)
        predictor = left; // Sub
      else if (filterType === 2)
        predictor = up; // Up
      else if (filterType === 3)
        predictor = (left + up) >> 1; // Average
      else {
        // Paeth: pick whichever of left / up / upLeft is closest to left + up - upLeft.
        const distLeft = Math.abs(up - upLeft),
          distUp = Math.abs(left - upLeft),
          distUpLeft = Math.abs(left + up - 2 * upLeft);
        predictor = distLeft <= distUp && distLeft <= distUpLeft ? left : distUp <= distUpLeft ? up : upLeft;
      }
      currentLine[x] = (filtered + predictor) & 255;
    }
    if (bitDepth === 8) indices.set(currentLine.subarray(0, width), y * width);
    else {
      // Sub-byte depths (1/2/4 bits): unpack several pixels per byte, most significant first.
      const pixelsPerByte = 8 / bitDepth,
        mask = (1 << bitDepth) - 1;
      for (let x = 0; x < width; x++)
        indices[y * width + x] =
          (currentLine[Math.floor(x / pixelsPerByte)] >> (8 - bitDepth - (x % pixelsPerByte) * bitDepth)) & mask;
    }
    previousLine.set(currentLine);
  }
  return { w: width, h: height, idx: indices };
}

/**
 * Decodes any PNG to RGBA through the browser (canvas read-back).
 * @param {Uint8Array} bytes PNG file bytes
 * @returns {Promise<{w: number, h: number, rgba: Uint8ClampedArray}>} size and pixels
 */
async function pngRgba(bytes) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0);
  return { w: canvas.width, h: canvas.height, rgba: context.getImageData(0, 0, canvas.width, canvas.height).data };
}

/* ------------------------------ SFF ------------------------------ */

/**
 * Parses an SFF file (v1 or v2) into sprite and palette tables. Pixel data is decoded lazily
 * (see MG.ensure) except for PNG sprites, which are decoded here because decoding is asynchronous.
 * @param {ArrayBuffer} buffer whole file contents
 * @param {Set<string>} [only] optional set of 'group,index' keys; PNG sprites outside it are not decoded (used for thumbnails)
 * @returns {Promise<{ver: number, sprites: Map<string, object>, pals: {g: number, i: number, rgba: Uint8Array}[],
 *   palByKey: Object<string, number>, list: object[]}>} `sprites` is keyed by "group,index" (first one wins),
 *   `list` keeps every sprite in file order (links refer to list positions), `pals`/`palByKey` are the v2 palettes.
 */
MG.readSff = async function (buffer, only) {
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  const signature = String.fromCharCode(...bytes.subarray(0, 11));
  if (signature !== 'ElecbyteSpr') throw new Error('Not an SFF file');
  const version = bytes[15],
    sff = { ver: version, sprites: new Map(), pals: [], palByKey: {}, list: [] };
  if (version === 1) {
    // ---- SFF v1: walk the linked list of sub-file headers ----
    const spriteCount = view.getUint32(20, true);
    let headerOffset = view.getUint32(24, true),
      previousSprite = null;
    for (let index = 0; index < spriteCount; index++) {
      const nextOffset = view.getUint32(headerOffset, true),
        dataSize = view.getUint32(headerOffset + 4, true);
      const axisX = view.getInt16(headerOffset + 8, true),
        axisY = view.getInt16(headerOffset + 10, true),
        group = view.getUint16(headerOffset + 12, true),
        number = view.getUint16(headerOffset + 14, true),
        linkIndex = view.getUint16(headerOffset + 16, true),
        samePaletteFlag = bytes[headerOffset + 18];
      const sprite = { g: group, i: number, ax: axisX, ay: axisY, w: 0, h: 0, idx: null, rgba: null, pal: null };
      if (dataSize === 0) {
        // Linked sprite: shares the pixels of an earlier one.
        const linkedSprite = sff.list[linkIndex];
        if (linkedSprite && linkIndex < index) {
          sprite.w = linkedSprite.w;
          sprite.h = linkedSprite.h;
          sprite.link = linkedSprite;
          sprite.pal = linkedSprite.pal;
        }
      } else {
        const pcxOffset = headerOffset + 32; // PCX header position
        const bitsPerPixel = bytes[pcxOffset + 3],
          encoding = bytes[pcxOffset + 2];
        const xMin = view.getUint16(pcxOffset + 4, true),
          yMin = view.getUint16(pcxOffset + 6, true),
          xMax = view.getUint16(pcxOffset + 8, true),
          yMax = view.getUint16(pcxOffset + 10, true),
          bytesPerLine = view.getUint16(pcxOffset + 66, true);
        sprite.w = xMax - xMin + 1;
        sprite.h = yMax - yMin + 1;
        const sharesPalette = samePaletteFlag !== 0 && previousSprite !== null,
          isFirstOfPalette = previousSprite === null || (group === 0 && number === 0),
          pixelDataStart = pcxOffset + 128;
        let pixelDataEnd, paletteOffset;
        // Locate the palette: the first sprite (or 0,0) owns the last 768 bytes of its block;
        // others either reuse the previous palette or carry their own after a 0x0C marker byte.
        if (isFirstOfPalette) {
          const blockSize = nextOffset > pcxOffset ? nextOffset - pcxOffset : dataSize;
          pixelDataEnd = pcxOffset + blockSize - 768;
          paletteOffset = pcxOffset + blockSize - 768;
        } else {
          const blockEnd = nextOffset > pcxOffset ? nextOffset : pcxOffset + dataSize;
          if (sharesPalette) {
            paletteOffset = -1;
            pixelDataEnd = blockEnd;
          } else {
            paletteOffset = -1;
            for (let scan = blockEnd - 769; scan >= pixelDataStart; scan--)
              if (bytes[scan] === 0x0c) {
                paletteOffset = scan + 1;
                break;
              }
            if (paletteOffset < 0) paletteOffset = blockEnd - 768;
            pixelDataEnd = paletteOffset - 1;
          }
        }
        if (bitsPerPixel === 8)
          sprite.raw1 = {
            d: bytes.subarray(
              pixelDataStart,
              Math.max(pixelDataStart, encoding === 1 ? pixelDataEnd : pixelDataStart + sprite.w * sprite.h)
            ),
            enc: encoding,
            bpl: bytesPerLine
          }; /* decoded on first use */
        if (sharesPalette && previousSprite) sprite.pal = previousSprite.pal;
        else {
          // 256 RGB triplets -> RGBA; colour 0 is transparent.
          const palette = new Uint8Array(256 * 4);
          for (let color = 0; color < 256; color++) {
            palette[color * 4] = bytes[paletteOffset + color * 3];
            palette[color * 4 + 1] = bytes[paletteOffset + color * 3 + 1];
            palette[color * 4 + 2] = bytes[paletteOffset + color * 3 + 2];
            palette[color * 4 + 3] = color === 0 ? 0 : 255;
          }
          sprite.pal = palette;
        }
        previousSprite = sprite;
      }
      sff.list.push(sprite);
      const key = group + ',' + number;
      if (!sff.sprites.has(key)) sff.sprites.set(key, sprite);
      headerOffset = nextOffset;
    }
  } else if (version === 2) {
    // ---- SFF v2: fixed tables of sprite and palette descriptors ----
    const spriteTableOffset = view.getUint32(36, true),
      spriteCount = view.getUint32(40, true),
      paletteTableOffset = view.getUint32(44, true),
      paletteCount = view.getUint32(48, true),
      literalDataOffset = view.getUint32(52, true),
      translatedDataOffset = view.getUint32(60, true);
    for (let index = 0; index < paletteCount; index++) {
      const entryOffset = paletteTableOffset + index * 16,
        group = view.getUint16(entryOffset, true),
        number = view.getUint16(entryOffset + 2, true),
        linkIndex = view.getUint16(entryOffset + 6, true),
        dataOffset = view.getUint32(entryOffset + 8, true),
        dataSize = view.getUint32(entryOffset + 12, true);
      let palette;
      // Zero size = alias of an earlier palette; otherwise 4 bytes (RGBx) per colour.
      if (dataSize === 0) palette = (sff.pals[linkIndex] || { rgba: new Uint8Array(1024) }).rgba;
      else {
        const colorCount = Math.min(256, dataSize >> 2);
        palette = new Uint8Array(1024);
        for (let color = 0; color < colorCount; color++) {
          const source = literalDataOffset + dataOffset + color * 4;
          palette[color * 4] = bytes[source];
          palette[color * 4 + 1] = bytes[source + 1];
          palette[color * 4 + 2] = bytes[source + 2];
          palette[color * 4 + 3] = color === 0 ? 0 : 255;
        }
      }
      sff.pals.push({ g: group, i: number, rgba: palette });
      sff.palByKey[group + ',' + number] = index;
    }
    const pngJobs = []; // pending asynchronous PNG decodes
    for (let index = 0; index < spriteCount; index++) {
      const entryOffset = spriteTableOffset + index * 28,
        group = view.getUint16(entryOffset, true),
        number = view.getUint16(entryOffset + 2, true),
        width = view.getUint16(entryOffset + 4, true),
        height = view.getUint16(entryOffset + 6, true),
        axisX = view.getInt16(entryOffset + 8, true),
        axisY = view.getInt16(entryOffset + 10, true);
      const linkIndex = view.getUint16(entryOffset + 12, true),
        format = bytes[entryOffset + 14],
        colorDepth = bytes[entryOffset + 15];
      let dataOffset = view.getUint32(entryOffset + 16, true);
      const dataSize = view.getUint32(entryOffset + 20, true),
        paletteIndex = view.getUint16(entryOffset + 24, true),
        flags = view.getUint16(entryOffset + 26, true);
      dataOffset += flags & 1 ? translatedDataOffset : literalDataOffset; // flag bit 0 selects the data block
      const sprite = {
        g: group,
        i: number,
        ax: axisX,
        ay: axisY,
        w: width,
        h: height,
        idx: null,
        rgba: null,
        palidx: paletteIndex,
        pal: null,
        fmt: format,
        depth: colorDepth
      };
      if (dataSize === 0) {
        const linkedSprite = sff.list[linkIndex];
        if (linkedSprite && linkIndex < index) {
          sprite.link = linkedSprite;
          sprite.w = linkedSprite.w;
          sprite.h = linkedSprite.h;
          if (!paletteIndex) sprite.palidx = linkedSprite.palidx;
        }
      } else if (format === 0 || format === 2 || format === 3 || format === 4)
        // Raw / RLE8 / RLE5 / LZ5; compressed formats start with a 4-byte uncompressed-size header.
        sprite.raw =
          format === 0
            ? bytes.subarray(dataOffset, dataOffset + dataSize)
            : bytes.subarray(dataOffset + 4, dataOffset + dataSize);
      /* decoded on first use */ else if (
        only &&
        !only.has(group + ',' + number) &&
        (format === 10 || format === 11 || format === 12)
      ) {
        /* skipped */
      } else if (format === 10) {
        // Indexed PNG; fall back to a full RGBA decode when it is not the simple kind.
        const pngBytes = bytes.subarray(dataOffset + 4, dataOffset + dataSize);
        pngJobs.push(
          pngIndexed(pngBytes)
            .then(decoded => {
              sprite.w = decoded.w;
              sprite.h = decoded.h;
              sprite.idx = decoded.idx;
            })
            .catch(() =>
              pngRgba(pngBytes).then(decoded => {
                sprite.w = decoded.w;
                sprite.h = decoded.h;
                sprite.rgba = new Uint8ClampedArray(decoded.rgba);
              })
            )
        );
      } else if (format === 11 || format === 12) {
        // True-colour PNG (RGB / RGBA).
        const pngBytes = bytes.subarray(dataOffset + 4, dataOffset + dataSize);
        pngJobs.push(
          pngRgba(pngBytes)
            .then(decoded => {
              sprite.w = decoded.w;
              sprite.h = decoded.h;
              sprite.rgba = new Uint8ClampedArray(decoded.rgba);
            })
            .catch(() => MG.warn('PNG sprite decode failed'))
        );
      } else MG.warn('Unsupported SFF sprite format ' + format);
      sff.list.push(sprite);
      const key = group + ',' + number;
      if (!sff.sprites.has(key)) sff.sprites.set(key, sprite);
    }
    await Promise.all(pngJobs);
    // Linked sprites copy their size from the target once PNG decoding has finished.
    for (const sprite of sff.list)
      if (sprite.link) {
        sprite.w = sprite.link.w;
        sprite.h = sprite.link.h;
      }
  } else throw new Error('Unsupported SFF version ' + version);
  return sff;
};

/**
 * Reads an Adobe ACT palette file (768 bytes of RGB). MUGEN uses ACT colours in reverse order,
 * so entry 0 of the file becomes colour 255; colour 0 stays transparent.
 * @param {ArrayBuffer} buffer file contents
 * @returns {Uint8Array} 256 RGBA entries (1024 bytes)
 */
MG.readAct = function (buffer) {
  const bytes = new Uint8Array(buffer),
    palette = new Uint8Array(1024),
    colorCount = Math.min(256, Math.floor(bytes.length / 3));
  for (let i = 0; i < colorCount; i++) {
    const destination = 255 - i;
    palette[destination * 4] = bytes[i * 3];
    palette[destination * 4 + 1] = bytes[i * 3 + 1];
    palette[destination * 4 + 2] = bytes[i * 3 + 2];
    palette[destination * 4 + 3] = destination === 0 ? 0 : 255;
  }
  return palette;
};

/**
 * Decodes a sprite's pixel data the first time it is needed
 * (v2 raw / RLE8 / RLE5 / LZ5; v1 PCX is decoded here too; PNG sprites are decoded at load time).
 * Fills `sprite.idx` (palette indices) or `sprite.rgba`, and releases the compressed source
 * unless `sprite.once` is set.
 * @param {object} [sprite] a sprite from MG.readSff
 * @returns {boolean} true when pixel data is available
 */
MG.ensure = function (sprite) {
  if (!sprite) return false;
  if (sprite.idx || sprite.rgba) return true;
  if (sprite.link) {
    if (!MG.ensure(sprite.link)) return false;
    sprite.idx = sprite.link.idx;
    sprite.rgba = sprite.link.rgba;
    sprite.w = sprite.link.w;
    sprite.h = sprite.link.h;
    return true;
  }
  if (sprite.raw1) {
    const pcx = sprite.raw1;
    sprite.idx = pcx.enc === 1 ? pcxDecode(pcx.d, sprite.w, sprite.h, pcx.bpl) : pcx.d.slice(0, sprite.w * sprite.h);
    if (!sprite.once) sprite.raw1 = null;
    return !!sprite.idx;
  }
  if (!sprite.raw) return false;
  const pixelCount = sprite.w * sprite.h,
    data = sprite.raw;
  if (sprite.fmt === 0) {
    if (sprite.depth === 8) sprite.idx = data.slice(0, pixelCount);
    else {
      // Raw true colour: 24 or 32 bits per pixel.
      const bytesPerPixel = sprite.depth / 8;
      sprite.rgba = new Uint8ClampedArray(pixelCount * 4);
      for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
        sprite.rgba[pixelIndex * 4] = data[pixelIndex * bytesPerPixel];
        sprite.rgba[pixelIndex * 4 + 1] = data[pixelIndex * bytesPerPixel + 1];
        sprite.rgba[pixelIndex * 4 + 2] = data[pixelIndex * bytesPerPixel + 2];
        sprite.rgba[pixelIndex * 4 + 3] = sprite.depth === 32 ? data[pixelIndex * 4 + 3] : 255;
      }
    }
  } else if (sprite.fmt === 2) sprite.idx = rle8(data, pixelCount);
  else if (sprite.fmt === 3) sprite.idx = rle5(data, pixelCount);
  else if (sprite.fmt === 4) sprite.idx = lz5(data, pixelCount);
  if (!sprite.once) sprite.raw = null;
  return !!(sprite.idx || sprite.rgba);
};

/* Sprite canvases are cached per palette. The cache has a byte budget and drops the least recently drawn ones. */
MG.cache = { bytes: 0, budget: 96 * 1024 * 1024, list: [], frame: 0 };

/**
 * Evicts old canvases from MG.cache until it is under 75% of its budget.
 * Sprites that are pinned or were drawn in the last 20 frames are kept.
 */
MG.trimCache = function () {
  const cache = MG.cache,
    keep = [];
  let index = 0;
  for (; index < cache.list.length && cache.bytes > cache.budget * 0.75; index++) {
    const entry = cache.list[index];
    if (entry.s.pin || entry.s.used >= cache.frame - 20) {
      keep.push(entry);
      continue;
    }
    if (entry.s.cache && entry.s.cache[entry.key]) {
      delete entry.s.cache[entry.key];
      cache.bytes -= entry.bytes;
    }
  }
  cache.list = keep.concat(cache.list.slice(index));
};

/**
 * Returns the cached canvas of a sprite for a palette choice, rendering it on first use.
 * @param {object} pkg character/stage package (provides `sff` and, for v1, `acts`)
 * @param {object} sprite sprite from MG.readSff
 * @param {number} palSlot 1-based palette slot
 * @param {boolean} [opaque] true to ignore transparency (colour 0 drawn solid)
 * @returns {HTMLCanvasElement|null} canvas or null when the sprite has no pixels
 */
MG.spriteCanvas = function (pkg, sprite, palSlot, opaque) {
  if (!sprite || !MG.ensure(sprite) || !sprite.w || !sprite.h) return null;
  sprite.used = MG.cache.frame;
  const sff = pkg.sff;
  let palette = null,
    key;
  if (sprite.rgba) key = 'rgba';
  else {
    if (sff.ver === 2) {
      // Slots > 1 swap the default palette (group 1, item 1) for palette "1,slot" when it exists.
      let paletteIndex = sprite.palidx || 0;
      const basePalette = sff.pals[paletteIndex];
      if (palSlot > 1 && basePalette && basePalette.g === 1 && basePalette.i === 1) {
        const alternative = sff.palByKey['1,' + palSlot];
        if (alternative !== undefined) paletteIndex = alternative;
      }
      palette = (sff.pals[paletteIndex] || sff.pals[0] || { rgba: new Uint8Array(1024) }).rgba;
      key = 'p' + paletteIndex;
    } else {
      // v1: an external .act file for this slot wins over the sprite's own palette.
      const act = pkg.acts && pkg.acts[palSlot];
      palette = act || sprite.pal || new Uint8Array(1024);
      key = act ? 'a' + palSlot : 'own';
    }
  }
  if (opaque && !sprite.rgba) key += 'o';
  sprite.cache = sprite.cache || {};
  if (sprite.cache[key]) return sprite.cache[key];
  const canvas = document.createElement('canvas');
  canvas.width = sprite.w;
  canvas.height = sprite.h;
  const context = canvas.getContext('2d'),
    imageData = context.createImageData(sprite.w, sprite.h),
    pixels = imageData.data;
  if (sprite.rgba) pixels.set(sprite.rgba);
  else if (sprite.idx) {
    const pixelCount = sprite.w * sprite.h,
      indices = sprite.idx;
    for (let i = 0; i < pixelCount; i++) {
      const paletteOffset = indices[i] * 4;
      pixels[i * 4] = palette[paletteOffset];
      pixels[i * 4 + 1] = palette[paletteOffset + 1];
      pixels[i * 4 + 2] = palette[paletteOffset + 2];
      pixels[i * 4 + 3] = opaque ? 255 : palette[paletteOffset + 3];
    }
  }
  context.putImageData(imageData, 0, 0);
  sprite.cache[key] = canvas;
  if (sprite.once && sprite.idx && !sprite.link) sprite.idx = null;
  const cache = MG.cache,
    bytes = sprite.w * sprite.h * 4;
  cache.bytes += bytes;
  cache.list.push({ s: sprite, key, bytes });
  if (cache.bytes > cache.budget) MG.trimCache();
  return canvas;
};

/**
 * Releases everything a loaded SFF holds (decoded pixels, canvases, source buffer).
 * @param {object} [sff] result of MG.readSff
 */
MG.freeSff = function (sff) {
  if (!sff) return;
  const cache = MG.cache;
  for (const sprite of sff.list) {
    if (sprite.cache) {
      for (const key in sprite.cache) {
        const canvas = sprite.cache[key];
        cache.bytes -= canvas.width * canvas.height * 4;
        canvas.width = canvas.height = 0;
      }
      sprite.cache = null;
    }
    sprite.idx = sprite.rgba = sprite.raw = sprite.raw1 = sprite.link = null;
  }
  cache.list = cache.list.filter(entry => entry.s.cache);
  if (cache.bytes < 0) cache.bytes = 0;
  sff.list = [];
  sff.sprites.clear();
};
