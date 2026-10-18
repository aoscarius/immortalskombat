/* =====================================================================
   MUGEN compatibility layer: text file formats and the shared MG namespace.

   MUGEN content is described by INI-like text files. They all share one
   syntax (see MG.parseIni): "[Section name]" headers, "key = value" lines and
   ";" comments. This file turns each flavour into plain JS data:

   DEF  character / stage descriptor ([Info], [Files], ...)        -> MG.parseDef
   AIR  animations: "[Begin Action n]" followed by frames
        "group, index, x, y, ticks, flip, trans, xscale, yscale" and
        Clsn1/Clsn2 collision boxes                                -> MG.parseAir
   CNS  constants ([Data], [Size], [Velocity], [Movement]) and
        state definitions "[Statedef n]" with "[State n, label]"
        controllers (type, triggerall, triggerN, parameters)       -> MG.parseCns
   CMD  "[Command]" sections (name, command string, time) plus
        "[Defaults]"; the state part of a CMD uses the CNS syntax  -> MG.parseCommands

   Expressions inside triggers and parameters stay as raw strings here; they
   are compiled lazily by expr.js.

   `MG` is the global namespace that every other MUGEN module attaches to.
   ===================================================================== */
const MG = {
  /** Shared pseudo-random source (deterministic RNG so netplay stays in sync). */
  rand: () => RNG.next(),
  /** Warnings already reported, used to de-duplicate console output. */
  log: [],
  /**
   * Report a content problem once.
   * @param {string} message Human readable warning.
   */
  warn(message) {
    if (MG.log.indexOf(message) < 0) {
      MG.log.push(message);
      try {
        console.warn('[MUGEN] ' + message);
      } catch (error) {}
    }
  }
};

/* ------------------------------ text helpers ------------------------------ */

/**
 * Decode a text file of unknown encoding.
 * MUGEN files are often saved as Windows-1252 or Shift-JIS rather than UTF-8,
 * so try strict UTF-8 first and otherwise guess between Shift-JIS and Windows-1252.
 * @param {ArrayBuffer} buffer Raw file bytes.
 * @returns {string} Decoded text without a leading byte-order mark.
 */
MG.decodeText = function (buffer) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    const bytes = new Uint8Array(buffer);
    // A Shift-JIS double-byte sequence: lead byte 0x81-0x9F followed by trail byte 0x40-0xFC.
    let looksShiftJis = false;
    for (let i = 0; i < bytes.length - 1; i++)
      if (bytes[i] >= 0x81 && bytes[i] <= 0x9f && bytes[i + 1] >= 0x40 && bytes[i + 1] <= 0xfc) {
        looksShiftJis = true;
        break;
      }
    try {
      text = new TextDecoder(looksShiftJis ? 'shift_jis' : 'windows-1252').decode(buffer);
    } catch (decoderError) {
      text = new TextDecoder('utf-8').decode(buffer);
    }
  }
  // Drop the UTF-8 byte-order mark if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
};

/**
 * Remove a trailing ";" comment, ignoring semicolons inside double quotes.
 * @param {string} line One source line.
 * @returns {string} The line without its comment.
 */
function stripComment(line) {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ';' && !inQuotes) return line.slice(0, i);
  }
  return line;
}

/**
 * INI-style parse shared by every MUGEN text format.
 * Keys are lower-cased; a line without "=" becomes a key with an empty value.
 * @param {string} text File contents.
 * @returns {{name: string, items: Array<[string, string]>, map: Object<string, string>}[]}
 *   Sections in file order. The first one (empty name) holds anything before the first header.
 *   `items` keeps duplicates and order, `map` keeps the last value of each key.
 */
MG.parseIni = function (text) {
  const sections = [];
  let current = { name: '', items: [], map: {} };
  sections.push(current);
  for (const rawLine of text.split(/\r?\n|\r/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    if (line[0] === '[') {
      const header = line.match(/^\[([^\]]*)\]/);
      if (header) {
        current = { name: header[1].trim(), items: [], map: {} };
        sections.push(current);
        continue;
      }
    }
    const equalsIndex = line.indexOf('=');
    if (equalsIndex < 0) {
      current.items.push([line.toLowerCase(), '']);
      continue;
    }
    const key = line.slice(0, equalsIndex).trim().toLowerCase(),
      value = line.slice(equalsIndex + 1).trim();
    current.items.push([key, value]);
    current.map[key] = value;
  }
  return sections;
};

/**
 * Strip one pair of surrounding double quotes.
 * @param {string} [text] Possibly quoted value.
 * @returns {string} Unquoted text ('' for undefined).
 */
const unquote = text => (text || '').replace(/^"(.*)"$/, '$1');

/**
 * Parse a comma separated list of numbers, silently skipping non-numeric items.
 * @param {string} [text] e.g. "320, 240".
 * @returns {number[]} Parsed numbers.
 */
const parseNumberList = text =>
  (text || '')
    .split(',')
    .map(item => parseFloat(item))
    .filter(value => !isNaN(value));

/* ------------------------------ DEF ------------------------------ */

/**
 * Parse a DEF descriptor (character or stage).
 * @param {string} text DEF file contents.
 * @returns {{name: string, author: string, localcoord: number[], palDefaults: number[],
 *   files: Object<string, string>, sections: Object}} Summary of [Info]/[Files] plus every
 *   section indexed by lower-cased name.
 */
MG.parseDef = function (text) {
  const sections = MG.parseIni(text),
    byName = {};
  for (const section of sections) byName[section.name.toLowerCase()] = section;
  const info = (byName['info'] || { map: {} }).map,
    files = (byName['files'] || { map: {} }).map;
  const localCoord = parseNumberList(info['localcoord']);
  return {
    name: unquote(info['displayname'] || info['name'] || 'Unnamed'),
    author: unquote(info['author'] || ''),
    localcoord: localCoord.length >= 2 ? localCoord : [320, 240],
    palDefaults: parseNumberList(info['pal.defaults']),
    files,
    sections: byName
  };
};

/* ------------------------------ AIR ------------------------------ */

/**
 * Parse an AIR animation file.
 * Collision boxes work like this: "Clsn1Default"/"Clsn2Default" boxes apply to every
 * following frame, plain "Clsn1"/"Clsn2" boxes apply to the next frame only.
 * @param {string} text AIR file contents.
 * @returns {Map<number, Object>} Actions by number. Each action has `no`, `frames`, `loopStart`
 *   (frame index of the Loopstart marker), `start` (tick at which each frame begins), `inf`
 *   (ends in a -1 "forever" frame), `total` (length in ticks) and `loopTick`.
 *   Each frame has `g,i` (sprite), `x,y` (offset), `time`, `fh,fv` (flips), `trans`, `xs,ys`
 *   (scale) and `c1,c2` (attack / hurt boxes as [x1,y1,x2,y2]).
 */
MG.parseAir = function (text) {
  const actions = new Map();
  let currentAction = null,
    currentBoxGroup = null,
    defaultBoxes1 = null,
    defaultBoxes2 = null,
    nextBoxes1 = null,
    nextBoxes2 = null,
    loopFrameIndex = -1;
  // Store the action being built (if any) together with its loop point.
  const finishAction = () => {
    if (currentAction) {
      currentAction.loopStart = loopFrameIndex >= 0 ? loopFrameIndex : 0;
      actions.set(currentAction.no, currentAction);
    }
  };
  for (const rawLine of text.split(/\r?\n|\r/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    let match = line.match(/^\[\s*begin\s+action\s+(-?\d+)\s*\]/i);
    if (match) {
      finishAction();
      currentAction = { no: +match[1], frames: [], loopStart: 0 };
      defaultBoxes1 = defaultBoxes2 = null;
      nextBoxes1 = nextBoxes2 = null;
      currentBoxGroup = null;
      loopFrameIndex = -1;
      continue;
    }
    if (!currentAction) continue;
    // "Clsn1: 2" / "Clsn2Default: 1" announces a box list.
    match = line.match(/^clsn([12])(default)?\s*:\s*(\d+)/i);
    if (match) {
      currentBoxGroup = { which: +match[1], isDefault: !!match[2], want: +match[3], list: [] };
      if (currentBoxGroup.isDefault) {
        if (currentBoxGroup.which === 1) defaultBoxes1 = currentBoxGroup.list;
        else defaultBoxes2 = currentBoxGroup.list;
      } else {
        if (currentBoxGroup.which === 1) nextBoxes1 = currentBoxGroup.list;
        else nextBoxes2 = currentBoxGroup.list;
      }
      continue;
    }
    // "Clsn1[0] = x1, y1, x2, y2": normalise so that (x1,y1) is the top-left corner.
    match = line.match(/^clsn[12](default)?\s*\[\s*\d+\s*\]\s*=\s*(.*)$/i);
    if (match && currentBoxGroup) {
      const coords = parseNumberList(match[2]);
      if (coords.length >= 4) {
        const x1 = Math.min(coords[0], coords[2]),
          x2 = Math.max(coords[0], coords[2]),
          y1 = Math.min(coords[1], coords[3]),
          y2 = Math.max(coords[1], coords[3]);
        currentBoxGroup.list.push([x1, y1, x2, y2]);
      }
      continue;
    }
    if (/^loopstart/i.test(line)) {
      loopFrameIndex = currentAction.frames.length;
      continue;
    }
    // Frame line: "group, index, x, y, time[, flip[, trans[, xscale[, yscale]]]]".
    if (/^[-\d]/.test(line) && line.indexOf('=') < 0) {
      const fields = line.split(',').map(field => field.trim());
      if (fields.length < 5) continue;
      const flipFlags = (fields[5] || '').toUpperCase();
      const frame = {
        g: +fields[0],
        i: +fields[1],
        x: +fields[2] || 0,
        y: +fields[3] || 0,
        time: parseInt(fields[4], 10),
        fh: flipFlags.indexOf('H') >= 0,
        fv: flipFlags.indexOf('V') >= 0,
        trans: (fields[6] || '').toUpperCase(),
        xs: fields[7] !== undefined && fields[7] !== '' ? +fields[7] : 1,
        ys: fields[8] !== undefined && fields[8] !== '' ? +fields[8] : 1,
        c1: nextBoxes1 || defaultBoxes1 || [],
        c2: nextBoxes2 || defaultBoxes2 || []
      };
      if (isNaN(frame.time)) frame.time = 1;
      nextBoxes1 = nextBoxes2 = null;
      currentAction.frames.push(frame);
    }
  }
  finishAction();
  // Derived timing: start tick of every frame and total length.
  for (const action of actions.values()) {
    let tick = 0;
    action.start = [];
    action.inf = false;
    for (const frame of action.frames) {
      action.start.push(tick);
      // A negative duration holds the frame forever, so nothing after it is reachable.
      if (frame.time < 0) {
        action.inf = true;
        break;
      }
      tick += frame.time;
    }
    action.total = tick;
    action.loopTick =
      action.frames.length && action.loopStart < action.start.length ? action.start[action.loopStart] : 0;
  }
  return actions;
};

/* ------------------------------ CNS / CMD ------------------------------ */

/**
 * Parse a CNS (or the state part of a CMD) file.
 * @param {string} text File contents.
 * @returns {{consts: Object<string, (number[]|string)>, states: Map<number, Object>}}
 *   `consts` maps "section.key" (data/size/velocity/movement/quotes) to numeric arrays
 *   (strings for quotes). `states` maps a state number to
 *   `{no, params, ctrls}` where `params` are the Statedef keys and each controller in `ctrls` is
 *   `{type, all (triggerall expressions), groups (triggerN -> expressions), params, persistent,
 *   ignorehp (ignorehitpause), label, id}`.
 */
MG.parseCns = function (text) {
  const sections = MG.parseIni(text),
    result = { consts: {}, states: new Map() };
  let currentState = null;
  for (const section of sections) {
    const sectionName = section.name.toLowerCase();
    let match;
    if ((match = sectionName.match(/^statedef\s+(-?\d+)/))) {
      currentState = { no: +match[1], params: {}, ctrls: [] };
      for (const [key, value] of section.items) currentState.params[key] = value;
      result.states.set(currentState.no, currentState);
    } else if ((match = sectionName.match(/^state\s+(-?\d+)\s*(?:,(.*))?$/))) {
      // The number in [State n, label] is only a label: a controller always belongs to the last Statedef.
      const targetState = currentState;
      if (!targetState) continue;
      const controller = {
        type: '',
        all: [],
        groups: {},
        params: {},
        persistent: 1,
        ignorehp: false,
        label: (match[2] || '').trim(),
        id: 0
      };
      for (const [key, value] of section.items) {
        let triggerMatch;
        if (key === 'type') controller.type = value.toLowerCase();
        else if (key === 'persistent') controller.persistent = parseInt(value, 10);
        else if (key === 'ignorehitpause') controller.ignorehp = parseInt(value, 10) !== 0;
        else if (key === 'triggerall') controller.all.push(value);
        else if ((triggerMatch = key.match(/^trigger(\d+)$/)))
          (controller.groups[+triggerMatch[1]] = controller.groups[+triggerMatch[1]] || []).push(value);
        else controller.params[key] = value;
      }
      if (isNaN(controller.persistent)) controller.persistent = 1;
      targetState.ctrls.push(controller);
    } else if (['data', 'size', 'velocity', 'movement', 'quotes'].indexOf(sectionName) >= 0) {
      for (const [key, value] of section.items)
        result.consts[sectionName + '.' + key] = sectionName === 'quotes' ? unquote(value) : parseNumberList(value);
    }
  }
  return result;
};

/** The eight direction keys; used to recognise repeated directions such as "F, F". */
const DIRS = { B: 1, DB: 1, D: 1, DF: 1, F: 1, UF: 1, U: 1, UB: 1 };

/**
 * Parse one key of a command, e.g. "/$D", "~30B" or ">a".
 * Prefix modifiers: "/" hold, "~" release (optionally followed by the charge time in ticks),
 * "$" either-direction ($D matches D, DB and DF), ">" must follow immediately.
 * @param {string} token Key text without surrounding spaces.
 * @returns {{slash: boolean, tilde: boolean, dollar: boolean, greater: boolean, charge: number, key: string}}
 *   Modifier flags plus the bare key name (directions are upper-cased).
 */
function parseKeyToken(token) {
  let i = 0,
    parsed = { slash: false, tilde: false, dollar: false, greater: false, charge: 0, key: '' };
  for (; i < token.length; i++) {
    const char = token[i];
    if (char === '/') parsed.slash = true;
    else if (char === '~') {
      parsed.tilde = true;
      let digits = '';
      while (/\d/.test(token[i + 1] || '')) digits += token[++i];
      if (digits) parsed.charge = parseInt(digits, 10);
    } else if (char === '$') parsed.dollar = true;
    else if (char === '>') parsed.greater = true;
    else break;
  }
  parsed.key = token.slice(i);
  if (/^(B|DB|D|DF|F|UF|U|UB)$/i.test(parsed.key) && DIRS[parsed.key.toUpperCase()])
    parsed.key = parsed.key.toUpperCase();
  return parsed;
}

/**
 * Parse the [Command] sections of a CMD file.
 * @param {string} text File contents.
 * @returns {{name: string, steps: Object[], time: number, buf: number, done: boolean[],
 *   curTime: number, curBuf: number}[]} Commands in file order. Each step is
 *   `{keys, greater}` (keys pressed together); `time` is the input window, `buf` the buffer
 *   time, and `done/curTime/curBuf` are runtime matching state initialised here.
 */
MG.parseCommands = function (text) {
  const sections = MG.parseIni(text),
    commands = [];
  let defaultTime = 15,
    defaultBufferTime = 1;
  for (const section of sections) {
    const sectionName = section.name.toLowerCase();
    if (sectionName === 'defaults') {
      if (section.map['command.time']) defaultTime = parseInt(section.map['command.time'], 10);
      if (section.map['command.buffer.time']) defaultBufferTime = parseInt(section.map['command.buffer.time'], 10);
    }
    if (sectionName !== 'command') continue;
    const name = unquote(section.map['name'] || ''),
      rawCommand = unquote(section.map['command'] || '');
    if (!name || !rawCommand) continue;
    const time = section.map['time'] !== undefined ? parseInt(section.map['time'], 10) : defaultTime,
      bufferTime =
        section.map['buffer.time'] !== undefined ? parseInt(section.map['buffer.time'], 10) : defaultBufferTime;
    // "a, b" are consecutive steps; "a+b" are keys that must be down together.
    const steps = rawCommand
      .split(',')
      .map(stepText => {
        const keys = stepText
          .trim()
          .split('+')
          .map(keyText => parseKeyToken(keyText.trim()))
          .filter(parsedKey => parsedKey.key);
        return { keys, greater: keys.some(parsedKey => parsedKey.greater) };
      })
      .filter(step => step.keys.length);
    // Auto ">" for repeated single directions (F, F  ->  F, >~F, >F).
    const expandedSteps = [];
    steps.forEach((step, stepIndex) => {
      const previousStep = steps[stepIndex - 1];
      if (
        previousStep &&
        step.keys.length === 1 &&
        previousStep.keys.length === 1 &&
        DIRS[step.keys[0].key] &&
        previousStep.keys[0].key === step.keys[0].key &&
        !step.keys[0].tilde &&
        !previousStep.keys[0].tilde
      ) {
        expandedSteps.push({
          keys: [Object.assign({}, step.keys[0], { tilde: true, greater: true })],
          greater: true
        });
        expandedSteps.push({ keys: [Object.assign({}, step.keys[0], { greater: true })], greater: true });
      } else expandedSteps.push(step);
    });
    // A command made only of held ("/") keys needs no input buffer.
    const holdOnly = expandedSteps.length && expandedSteps.every(step => step.keys.every(key => key.slash));
    commands.push({
      name,
      steps: expandedSteps,
      time: Math.max(1, time),
      buf: holdOnly ? 1 : Math.max(1, bufferTime),
      done: expandedSteps.map(() => false),
      curTime: 0,
      curBuf: 0
    });
  }
  return commands;
};
