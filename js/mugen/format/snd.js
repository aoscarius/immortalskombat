/* =====================================================================
   SND reader: MUGEN sound archives ("ElecbyteSnd").

   Layout (all integers little-endian):
     0   char[12]  signature "ElecbyteSnd\0"
     12  u32       version (ignored)
     16  u32       number of sounds
     20  u32       file offset of the first sound sub-header
   Each sound sub-header is a singly linked list node:
     +0  u32       offset of the next sub-header (0 = last)
     +4  u32       length of the sound data that follows the header
     +8  u32       sound group number
     +12 u32       sound number within the group
     +16 ...       `length` bytes of RIFF/WAVE data
   A length of 0 means "same data as the previous sound".
   ===================================================================== */

/**
 * Parse an SND archive into a lookup table of raw WAV bytes.
 * @param {ArrayBuffer} buffer Whole file contents.
 * @returns {Map<string, {data: (Uint8Array|null), buf: (AudioBuffer|null)}>} Map keyed by "group,number".
 *   `data` holds the encoded WAV bytes; `buf` is filled in later by the audio layer once decoded.
 *   An unrecognised file yields an empty map.
 */
MG.readSnd = function (buffer) {
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer),
    sounds = new Map();
  if (String.fromCharCode(...bytes.subarray(0, 11)) !== 'ElecbyteSnd') return sounds;
  const soundCount = view.getUint32(16, true);
  let headerOffset = view.getUint32(20, true),
    previous = null;
  for (let index = 0; index < soundCount && headerOffset + 16 <= bytes.length; index++) {
    const nextOffset = view.getUint32(headerOffset, true),
      length = view.getUint32(headerOffset + 4, true),
      group = view.getUint32(headerOffset + 8, true),
      number = view.getUint32(headerOffset + 12, true);
    // Zero-length entries reuse the previous sound's data.
    const data = length ? bytes.slice(headerOffset + 16, headerOffset + 16 + length) : previous ? previous.data : null;
    const sound = { data, buf: null };
    sounds.set(group + ',' + number, sound);
    if (length) previous = sound;
    if (!nextOffset) break;
    headerOffset = nextOffset;
  }
  return sounds;
};
