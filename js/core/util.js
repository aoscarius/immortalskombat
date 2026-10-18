'use strict';
/* =====================================================================
   IMMORTALS KOMBAT - shared constants and helpers
   World units are screen pixels at 960x540. A fighter's own coordinates
   (MUGEN "localcoord") are scaled to this space by the engine.
   Provides: screen/world constants, clamp/lerp, a DOM query shortcut,
   visual-only randomness, the seeded simulation RNG (RNG), shuffle,
   base64 decoding and a string hash.
   ===================================================================== */
const W = 960,
  H = 540;
let GROUND = 462; /* y of the floor line on screen (a stage may change it) */
let STAGE_W = 1500; /* world width; the stage origin (x = 0) sits at STAGE_W / 2 */

/**
 * Limits a number to a closed range.
 * @param {number} value Number to limit.
 * @param {number} min Lower bound.
 * @param {number} max Upper bound.
 * @returns {number} `value` limited to [min, max].
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Linear interpolation between two numbers.
 * @param {number} from Value at amount 0.
 * @param {number} to Value at amount 1.
 * @param {number} amount Blend factor (0..1, not clamped).
 * @returns {number} The interpolated value.
 */
const lerp = (from, to, amount) => from + (to - from) * amount;

/**
 * Shortcut for document.querySelector.
 * @param {string} selector CSS selector.
 * @returns {Element|null} First matching element.
 */
const $ = selector => document.querySelector(selector);

/* Visual-only randomness (particles, shake). Never use this in the simulation. */

/**
 * Random float in [min, max) from Math.random (visual use only).
 * @param {number} min Lower bound.
 * @param {number} max Upper bound.
 * @returns {number} Random float.
 */
const rnd = (min, max) => min + Math.random() * (max - min);

/**
 * Random integer in [min, max] from Math.random (visual use only).
 * @param {number} min Lowest integer.
 * @param {number} max Highest integer.
 * @returns {number} Random integer.
 */
const rint = (min, max) => Math.floor(rnd(min, max + 1));

/* Simulation randomness: seeded so two peers running the same inputs stay identical. */
const RNG = {
  /** Current generator state (a 32-bit integer). */
  s: 1,
  /**
   * Seeds the generator; a zero seed is replaced by 1.
   * @param {number} seedValue Any number (reduced to 32 bits).
   */
  seed(seedValue) {
    this.s = seedValue >>> 0 || 1;
  },
  /**
   * Next pseudo-random float in [0, 1) (mulberry32 algorithm).
   * @returns {number} Random float.
   */
  next() {
    let mixed = (this.s += 0x6d2b79f5) >>> 0;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  },
  /**
   * Next pseudo-random integer in [min, max].
   * @param {number} min Lowest integer.
   * @param {number} max Highest integer.
   * @returns {number} Random integer.
   */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
};

/**
 * Returns a shuffled copy of an array (Fisher-Yates); the input is not modified.
 * @param {Array} items Items to shuffle.
 * @param {function(): number} [random] Random source returning [0, 1).
 * @returns {Array} New shuffled array.
 */
function shuffle(items, random = Math.random) {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

/**
 * Decodes a base64 string into an ArrayBuffer.
 * @param {string} base64 Base64 text.
 * @returns {ArrayBuffer} Decoded bytes.
 */
function b64ToBuf(base64) {
  const binary = atob(base64),
    bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/**
 * 32-bit FNV-1a hash of a string.
 * @param {string} text Text to hash.
 * @returns {number} Unsigned 32-bit hash.
 */
function hashStr(text) {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}
