/* =====================================================================
   Input: keyboard, gamepad and touch, sampled once per simulation tick
   as {up, down, left, right, lp, hp, lk, hk, z, c, bl}.
   In MUGEN terms: lp=x  hp=y  lk=a  hk=b  c=c  z=z.
   Also holds the key bindings (KEYMAP) and the 11-bit input packing used by netplay.
   ===================================================================== */
/** Keyboard bindings per player: input name -> KeyboardEvent.code. */
const KEYMAP = {
  p1: {
    up: 'KeyW',
    down: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    lp: 'KeyJ',
    hp: 'KeyK',
    lk: 'KeyN',
    hk: 'KeyM',
    bl: 'KeyL',
    z: 'KeyU',
    c: 'KeyI'
  },
  p2: {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    lp: 'Semicolon',
    hp: 'Quote',
    lk: 'Period',
    hk: 'Slash',
    bl: 'ShiftRight',
    z: 'BracketLeft',
    c: 'BracketRight'
  }
};
/** Keys currently held (codes), filled by the key listeners elsewhere. */
const keys = new Set(),
  /** Virtual (touch) buttons for player 1: input name -> pressed. */
  virt = {},
  /** Every key code bound in KEYMAP (the page should block their default action). */
  GAMEKEYS = new Set();
for (const player in KEYMAP) for (const inputName in KEYMAP[player]) GAMEKEYS.add(KEYMAP[player][inputName]);

/**
 * Returns the gamepad at a slot.
 * @param {number} padIndex Gamepad slot (0 or 1).
 * @returns {Gamepad|null} The gamepad, or null when absent or unavailable.
 */
function pad(padIndex) {
  try {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    return gamepads[padIndex] || null;
  } catch (error) {
    return null;
  }
}

/**
 * Reads the current input of one player from keyboard, touch (p1 only) and gamepad.
 * @param {'p1'|'p2'} playerKey Player to sample.
 * @returns {Object<string, number>} Map input name -> 0/1.
 */
function sample(playerKey) {
  const bindings = KEYMAP[playerKey],
    state = {};
  for (const inputName in bindings) state[inputName] = keys.has(bindings[inputName]) ? 1 : 0;
  if (playerKey === 'p1') for (const inputName in virt) if (virt[inputName]) state[inputName] = 1;
  const gamepad = pad(playerKey === 'p1' ? 0 : 1);
  if (gamepad) {
    const axisX = gamepad.axes[0] || 0,
      axisY = gamepad.axes[1] || 0,
      isPressed = buttonIndex => gamepad.buttons[buttonIndex] && gamepad.buttons[buttonIndex].pressed;
    // Left stick or d-pad (buttons 12-15).
    if (axisX < -0.5 || isPressed(14)) state.left = 1;
    if (axisX > 0.5 || isPressed(15)) state.right = 1;
    if (axisY < -0.5 || isPressed(12)) state.up = 1;
    if (axisY > 0.5 || isPressed(13)) state.down = 1;
    if (isPressed(2)) state.lp = 1;
    if (isPressed(3)) state.hp = 1;
    if (isPressed(0)) state.lk = 1;
    if (isPressed(1)) state.hk = 1;
    if (isPressed(4)) state.z = 1;
    if (isPressed(5)) state.c = 1;
  }
  return state;
}

/** Input names in bit order: bit 0 = up ... bit 10 = bl. */
const INPUT_BITS = ['up', 'down', 'left', 'right', 'lp', 'hp', 'lk', 'hk', 'z', 'c', 'bl'];

/**
 * Packs an input map into a bit mask (see INPUT_BITS).
 * @param {Object<string, number>} input Input map.
 * @returns {number} Bit mask.
 */
const packInput = input => {
  let mask = 0;
  INPUT_BITS.forEach((inputName, bit) => {
    if (input[inputName]) mask |= 1 << bit;
  });
  return mask;
};

/**
 * Expands a bit mask back into an input map.
 * @param {number} mask Bit mask from packInput.
 * @returns {Object<string, number>} Input map of 0/1 values.
 */
const unpackInput = mask => {
  const input = {};
  INPUT_BITS.forEach((inputName, bit) => {
    input[inputName] = (mask >> bit) & 1;
  });
  return input;
};
