/* =====================================================================
   MUGEN compatibility layer, part 2: trigger expression compiler.
   Compiles trigger source text into a node
   { f: fn(fighter) -> number|string, t: 'i'|'f'|'s' }
   (t = integer / float / string result type).
   Pipeline: tokenize() -> Parser (recursive descent, one method per
   precedence level) -> closure tree. Integer division, interval tests
   (= [a,b]), redirections (P2,Life) and the usual trigger set are supported.
   Everything lives inside one IIFE; only MG.compile, MG.splitArgs,
   MG.compileList and MG.exprTest are exported.
   ===================================================================== */
(function () {
  /** Operator lexemes. Longer ones come first so the tokenizer matches greedily. */
  const OPS = [
    '**',
    ':=',
    '!=',
    '<=',
    '>=',
    '&&',
    '||',
    '^^',
    '=',
    '<',
    '>',
    '+',
    '-',
    '*',
    '/',
    '%',
    '!',
    '~',
    '&',
    '|',
    '^',
    '(',
    ')',
    '[',
    ']',
    ','
  ];

  /**
   * Splits an expression into tokens: strings ('str'), numbers ('num', with
   * f = true when written as a float), identifiers ('id') and operators ('op').
   * @param {string} source expression text
   * @returns {{k: string, v: (string|number), f?: boolean}[]} token list
   */
  function tokenize(source) {
    const tokens = [];
    let pos = 0;
    while (pos < source.length) {
      const char = source[pos];
      if (/\s/.test(char)) {
        pos++;
        continue;
      }
      if (char === '"') {
        // String literal; an unterminated one runs to the end of the text.
        const closeQuote = source.indexOf('"', pos + 1),
          end = closeQuote < 0 ? source.length : closeQuote;
        tokens.push({ k: 'str', v: source.slice(pos + 1, end) });
        pos = end + 1;
        continue;
      }
      if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[pos + 1] || ''))) {
        const match = source.slice(pos).match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/);
        tokens.push({ k: 'num', v: parseFloat(match[0]), f: /[.eE]/.test(match[0]) });
        pos += match[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(char)) {
        // Identifiers may contain dots (e.g. "fall.xvel").
        const match = source.slice(pos).match(/^[A-Za-z_][A-Za-z0-9_.]*/);
        tokens.push({ k: 'id', v: match[0] });
        pos += match[0].length;
        continue;
      }
      let matched = false;
      for (const op of OPS)
        if (source.startsWith(op, pos)) {
          tokens.push({ k: 'op', v: op });
          pos += op.length;
          matched = true;
          break;
        }
      if (!matched) throw new Error('bad char ' + char);
    }
    return tokens;
  }

  /**
   * Builds an expression node.
   * @param {string} type result type: 'i' integer, 'f' float, 's' string
   * @param {function(object): (number|string)} evaluate computes the value for a fighter
   * @returns {{t: string, f: function}} node
   */
  const makeNode = (type, evaluate) => ({ t: type, f: evaluate });
  /** Coerces any evaluation result to a number (strings count as 0). */
  const toNumber = value => (typeof value === 'number' ? value : typeof value === 'string' ? 0 : +value || 0);
  /** True when the node produces a float. */
  const isFloatNode = node => node.t === 'f';

  /* ---------- trigger tables ----------
     ZERO: triggers without arguments        -> [type, fn(fighter)]
     AXIS: triggers followed by an X/Y axis  -> [type, fn(fighter, axis)]
     FN:   triggers with a (a, b, ...) list  -> [type, fn(fighter, args)]
     (type 'm' = min/max: float if any argument is a float, else integer) */
  /** ZERO table: argument-less triggers. */
  const ZERO = {
    time: ['i', fighter => fighter.time],
    statetime: ['i', fighter => fighter.time],
    stateno: ['i', fighter => fighter.stateno],
    prevstateno: ['i', fighter => fighter.prevStateno],
    anim: ['i', fighter => fighter.animNo],
    animtime: ['i', fighter => fighter.animTime()],
    life: ['i', fighter => Math.round(fighter.life)],
    lifemax: ['i', fighter => fighter.maxHp],
    power: ['i', fighter => Math.round(fighter.power)],
    powermax: ['i', fighter => fighter.powerMax],
    alive: ['i', fighter => (fighter.life > 0 ? 1 : 0)],
    ctrl: ['i', fighter => (fighter.ctrl ? 1 : 0)],
    facing: ['i', fighter => fighter.face],
    hitcount: ['i', fighter => fighter.hitCount],
    uniqhitcount: ['i', fighter => fighter.hitCount],
    hitpausetime: ['i', fighter => fighter.hitPause],
    hitshakeover: ['i', fighter => ((fighter.getHit.hitshaketime | 0) <= 0 ? 1 : 0)],
    hitover: ['i', fighter => (fighter.hitTime <= 0 ? 1 : 0)],
    hitfall: ['i', fighter => (fighter.getHit.fall ? 1 : 0)],
    fall: ['i', fighter => (fighter.getHit.fall ? 1 : 0)],
    movecontact: ['i', fighter => (fighter.moveContact ? 1 : 0)],
    movehit: ['i', fighter => (fighter.moveHit ? 1 : 0)],
    moveguarded: ['i', fighter => (fighter.moveGuarded ? 1 : 0)],
    movereversed: ['i', fighter => 0],
    inguarddist: ['i', fighter => (fighter.inGuardDist() ? 1 : 0)],
    canrecover: [
      'i',
      fighter =>
        fighter.getHit['fall.recover'] &&
        (fighter.getHit.fallTime | 0) >= (fighter.getHit['fall.recovertime'] | 0) &&
        fighter.life > 0
          ? 1
          : 0
    ],
    ishelper: ['i', fighter => (fighter.isHelper ? 1 : 0)],
    isbound: ['i', fighter => (fighter.bound > 0 ? 1 : 0)],
    isHomeTeam: ['i', fighter => 1],
    roundstate: ['i', fighter => MGR.roundState()],
    roundno: ['i', fighter => MGR.roundNo()],
    matchno: ['i', fighter => 1],
    roundsexisted: ['i', fighter => MGR.roundNo() - 1],
    win: ['i', fighter => (fighter.won ? 1 : 0)],
    winko: ['i', fighter => (fighter.won && fighter.opponent && fighter.opponent.life <= 0 ? 1 : 0)],
    wintime: ['i', fighter => 0],
    winperfect: ['i', fighter => (fighter.won && fighter.dmgTaken === 0 ? 1 : 0)],
    lose: ['i', fighter => (fighter.opponent && fighter.opponent.won ? 1 : 0)],
    loseko: ['i', fighter => (fighter.opponent && fighter.opponent.won && fighter.life <= 0 ? 1 : 0)],
    losetime: ['i', fighter => 0],
    drawgame: ['i', fighter => 0],
    matchover: ['i', fighter => (MGR.matchOver() ? 1 : 0)],
    random: ['i', fighter => Math.floor(MG.rand() * 1000)],
    gametime: ['i', fighter => Math.floor(G.time)],
    ailevel: ['i', fighter => fighter.aiLevel | 0],
    teammode: ['i', fighter => 0],
    teamside: ['i', fighter => fighter.idx + 1],
    playeridexist: ['i', fighter => 1],
    numtarget: ['i', fighter => (fighter.target && fighter.target.life > 0 ? 1 : 0)],
    numhelper: ['i', fighter => fighter.root.helpers.length],
    numexplod: ['i', fighter => fighter.explods.length],
    numproj: ['i', fighter => fighter.projs.length],
    numpartner: ['i', fighter => 0],
    numenemy: ['i', fighter => 1],
    id: ['i', fighter => fighter.uid],
    palno: ['i', fighter => fighter.palSlot],
    hitdefisactive: ['i', fighter => (fighter.hitdef ? 1 : 0)],
    hitdefattr: ['s', fighter => ''],
    statetype: ['s', fighter => fighter.type.toLowerCase()],
    movetype: ['s', fighter => fighter.movetype.toLowerCase()],
    physics: ['s', fighter => fighter.physics.toLowerCase()],
    p2statetype: ['s', fighter => (fighter.opponent ? fighter.opponent.type.toLowerCase() : 'n')],
    p2movetype: ['s', fighter => (fighter.opponent ? fighter.opponent.movetype.toLowerCase() : 'n')],
    p2stateno: ['i', fighter => (fighter.opponent ? fighter.opponent.stateno : 0)],
    p2life: ['i', fighter => (fighter.opponent ? Math.round(fighter.opponent.life) : 0)],
    p2name: ['s', fighter => (fighter.opponent ? fighter.opponent.name.toLowerCase() : '')],
    name: ['s', fighter => fighter.name.toLowerCase()],
    authorname: ['s', fighter => (fighter.pkg.author || '').toLowerCase()],
    frontedgedist: ['f', fighter => fighter.edgeDist(true, false)],
    backedgedist: ['f', fighter => fighter.edgeDist(false, false)],
    frontedgebodydist: ['f', fighter => fighter.edgeDist(true, true)],
    backedgebodydist: ['f', fighter => fighter.edgeDist(false, true)],
    e: ['f', fighter => Math.E],
    pi: ['f', fighter => Math.PI],
    mugenversion: ['f', fighter => 1.1],
    const240p: ['i', fighter => 0],
    numtext: ['i', fighter => 0],
    envshake: ['i', fighter => 0]
  };
  /** AXIS table: triggers followed by an X/Y axis. */
  const AXIS = {
    pos: ['f', (fighter, axis) => (axis === 'x' ? fighter.posX : axis === 'y' ? fighter.posY : 0)],
    vel: ['f', (fighter, axis) => (axis === 'x' ? fighter.velX : axis === 'y' ? fighter.velY : 0)],
    p2dist: [
      'f',
      (fighter, axis) =>
        fighter.opponent
          ? axis === 'x'
            ? fighter.distX(fighter.opponent)
            : axis === 'y'
              ? fighter.distY(fighter.opponent)
              : 0
          : 0
    ],
    p2bodydist: [
      'f',
      (fighter, axis) =>
        fighter.opponent
          ? axis === 'x'
            ? fighter.distX(fighter.opponent) -
              fighter.frontW() -
              (fighter.opponent.frontW() * fighter.opponent.s) / fighter.s
            : fighter.distY(fighter.opponent)
          : 0
    ],
    screenpos: ['f', (fighter, axis) => (axis === 'x' ? (fighter.wx - G.cam.x) / fighter.s : -fighter.wy / fighter.s)],
    parentdist: [
      'f',
      (fighter, axis) =>
        fighter.parent ? (axis === 'x' ? fighter.distX(fighter.parent) : fighter.distY(fighter.parent)) : 0
    ],
    rootdist: [
      'f',
      (fighter, axis) =>
        fighter.isHelper ? (axis === 'x' ? fighter.distX(fighter.root) : fighter.distY(fighter.root)) : 0
    ],
    p1dist: ['f', (fighter, axis) => 0],
    targetdist: [
      'f',
      (fighter, axis) =>
        fighter.target ? (axis === 'x' ? fighter.distX(fighter.target) : fighter.distY(fighter.target)) : 0
    ]
  };
  /** FN table: triggers called with an argument list. */
  const FN = {
    abs: ['f', (fighter, args) => Math.abs(args[0])],
    sin: ['f', (fighter, args) => Math.sin(args[0])],
    cos: ['f', (fighter, args) => Math.cos(args[0])],
    tan: ['f', (fighter, args) => Math.tan(args[0])],
    asin: ['f', (fighter, args) => Math.asin(args[0])],
    acos: ['f', (fighter, args) => Math.acos(args[0])],
    atan: ['f', (fighter, args) => Math.atan(args[0])],
    exp: ['f', (fighter, args) => Math.exp(args[0])],
    ln: ['f', (fighter, args) => (args[0] > 0 ? Math.log(args[0]) : 0)],
    log: ['f', (fighter, args) => (args[0] > 0 && args[1] > 0 ? Math.log(args[1]) / Math.log(args[0]) : 0)],
    sqrt: ['f', (fighter, args) => Math.sqrt(Math.max(0, args[0]))],
    floor: ['i', (fighter, args) => Math.floor(args[0])],
    ceil: ['i', (fighter, args) => Math.ceil(args[0])],
    min: ['m', (fighter, args) => Math.min(args[0], args[1])],
    max: ['m', (fighter, args) => Math.max(args[0], args[1])],
    animelemtime: ['i', (fighter, args) => fighter.animElemTime(args[0])],
    animelemno: ['i', (fighter, args) => fighter.animElemNo(args[0])],
    animexist: ['i', (fighter, args) => (fighter.animExist(args[0], true) ? 1 : 0)],
    selfanimexist: ['i', (fighter, args) => (fighter.animExist(args[0], false) ? 1 : 0)],
    numexplod: ['i', (fighter, args) => fighter.explods.filter(explod => explod.id === args[0]).length],
    numtarget: ['i', (fighter, args) => (fighter.target && fighter.target.life > 0 ? 1 : 0)],
    numprojid: ['i', (fighter, args) => fighter.projs.filter(proj => proj.id === args[0]).length],
    projcontacttime: ['i', (fighter, args) => fighter.projContactTime(args[0])],
    projhittime: ['i', (fighter, args) => fighter.projContactTime(args[0], 'hit')],
    projguardedtime: ['i', (fighter, args) => fighter.projContactTime(args[0], 'guard')],
    projcontact: ['i', (fighter, args) => (fighter.projContactTime(args[0]) >= 0 ? 1 : 0)],
    playeridexist: ['i', (fighter, args) => 1],
    sysvar: ['i', (fighter, args) => fighter.sysvars[args[0] | 0] | 0],
    sysfvar: ['f', (fighter, args) => fighter.sysfvars[args[0] | 0] || 0],
    var: ['i', (fighter, args) => fighter.vars[args[0] | 0] | 0],
    fvar: ['f', (fighter, args) => fighter.fvars[args[0] | 0] || 0],
    stateno: ['i', (fighter, args) => fighter.stateno],
    numhelper: ['i', (fighter, args) => fighter.root.helpers.filter(helper => helper.hid === args[0]).length],
    helper: ['i', (fighter, args) => (fighter.root.helpers.some(helper => helper.hid === args[0]) ? 1 : 0)],
    ishelper: ['i', (fighter, args) => (fighter.isHelper && fighter.hid === args[0] ? 1 : 0)],
    const240p: ['f', (fighter, args) => (args[0] * (540 / 240)) / fighter.s],
    const480p: ['f', (fighter, args) => (args[0] * (540 / 480)) / fighter.s],
    const720p: ['f', (fighter, args) => (args[0] * (540 / 720)) / fighter.s]
  };
  /** Redirection keyword -> kind of target resolveRedirection() should look up ('none' = unsupported, always 0). */
  const REDIR = {
    p2: 'opp',
    enemy: 'opp',
    enemynear: 'opp',
    p1: 'self',
    self: 'self',
    root: 'root',
    parent: 'parent',
    target: 'target',
    helper: 'helper',
    partner: 'none',
    playerid: 'none'
  };
  /**
   * Resolves who a redirection points at (null when it does not exist, which makes the whole trigger 0).
   * @param {string} kind redirection kind (see REDIR) or 'playerid'
   * @param {object} fighter the fighter evaluating the trigger
   * @param {number} [id] the (id) of Helper(id) / PlayerID(id)
   * @returns {object|null} the redirected fighter or null
   */
  const resolveRedirection = (kind, fighter, id) => {
    switch (kind) {
      case 'opp':
        return fighter.opponent;
      case 'self':
        return fighter;
      case 'target':
        return fighter.target;
      case 'root':
        return fighter.root || fighter;
      case 'parent':
        return fighter.parent || null;
      case 'helper':
        return (fighter.root || fighter).helpers.find(helper => id === undefined || helper.hid === id) || null;
      case 'playerid':
        return (
          G.fighters.flatMap(candidate => [candidate, ...candidate.helpers]).find(candidate => candidate.uid === id) ||
          null
        );
      default:
        return null;
    }
  };
  /** GetHitVar(key): the value from the fighter's get-hit data, 0 when unset. */
  const getHitVarValue = (fighter, key) => {
    const value = fighter.getHit[key];
    return value === undefined ? 0 : value;
  };
  /** GetHitVar keys whose values are floats (all others are integers). */
  const GETHITVAR_FLOAT_KEYS = {
    xvel: 1,
    yvel: 1,
    yaccel: 1,
    'fall.xvel': 1,
    'fall.yvel': 1,
    xveladd: 1,
    yveladd: 1,
    'down.xvel': 1,
    'down.yvel': 1
  };
  /** Const(...) keys whose values are floats. */
  const CONST_FLOAT_RE = /^(velocity|movement)\.(?!airjump\.num)|^size\.(xscale|yscale)$/;

  /** Recursive-descent parser turning a token list into an expression node. */
  class Parser {
    /** @param {object[]} tokens output of tokenize() */
    constructor(tokens) {
      this.t = tokens; // token list
      this.p = 0; // index of the next unread token
    }
    /** Returns the token `offset` positions ahead without consuming it. */
    peek(offset = 0) {
      return this.t[this.p + offset];
    }
    /** True when the token at `offset` is the operator `op`. */
    isOp(op, offset = 0) {
      const token = this.t[this.p + offset];
      return token && token.k === 'op' && token.v === op;
    }
    /** Consumes operator `op` or throws. */
    eat(op) {
      if (!this.isOp(op)) throw new Error('expected ' + op);
      this.p++;
    }
    /** Parses a whole expression. */
    parseTop() {
      const node = this.bin(0);
      return node;
    }
    /**
     * Parses a left-associative binary level; level 0 is the loosest (:=), the last the tightest (* / %).
     * @param {number} level index into the precedence table below
     */
    bin(level) {
      const LEVELS = [
        [':='],
        ['||'],
        ['^^'],
        ['&&'],
        ['|'],
        ['^'],
        ['&'],
        ['=', '!='],
        ['<', '>', '<=', '>='],
        ['+', '-'],
        ['*', '/', '%']
      ];
      if (level >= LEVELS.length) return this.pow();
      let left = this.bin(level + 1);
      for (;;) {
        const token = this.peek();
        if (!token || token.k !== 'op' || LEVELS[level].indexOf(token.v) < 0) break;
        const op = token.v;
        this.p++;
        if (op === ':=') {
          // Assignment (right-associative): only var()/fvar()/... nodes carry an `assign` hook.
          const right = this.bin(level);
          if (!left.assign) throw new Error('bad :=');
          const assign = left.assign;
          left = makeNode(right.t, fighter => {
            const value = right.f(fighter);
            assign(fighter, value);
            return value;
          });
          continue;
        }
        if (op === '=' || op === '!=') {
          left = this.equality(left, op === '!=');
          continue;
        }
        const right = this.bin(level + 1);
        left = this.makeBinary(op, left, right);
      }
      return left;
    }
    /**
     * Parses the right side of = / != : either an interval ([a,b], (a,b), [a,b) ...) or a single value.
     * @param {object} left already parsed left operand
     * @param {boolean} negate true for !=
     */
    equality(left, negate) {
      if (this.isOp('[') || this.isOp('(')) {
        const savedPos = this.p,
          openBracket = this.t[this.p].v;
        this.p++;
        // Look ahead for a top-level comma: its presence distinguishes an interval from a parenthesised value.
        let depth = 0,
          hasComma = false;
        for (let scanIndex = this.p; scanIndex < this.t.length; scanIndex++) {
          const token = this.t[scanIndex];
          if (token.k !== 'op') continue;
          if (token.v === '(' || token.v === '[') depth++;
          else if (token.v === ')' || token.v === ']') {
            if (depth === 0) break;
            depth--;
          } else if (token.v === ',' && depth === 0) {
            hasComma = true;
            break;
          }
        }
        if (hasComma) {
          const low = this.bin(1);
          this.eat(',');
          const high = this.bin(1);
          const closeToken = this.t[this.p];
          if (!closeToken || closeToken.k !== 'op' || (closeToken.v !== ']' && closeToken.v !== ')'))
            throw new Error('bad interval');
          this.p++;
          // '[' / ']' include the bound, '(' / ')' exclude it.
          const lowInclusive = openBracket === '[',
            highInclusive = closeToken.v === ']';
          return makeNode('i', fighter => {
            const value = toNumber(left.f(fighter)),
              lowValue = toNumber(low.f(fighter)),
              highValue = toNumber(high.f(fighter));
            const inside =
              (lowInclusive ? value >= lowValue : value > lowValue) &&
              (highInclusive ? value <= highValue : value < highValue);
            return (negate ? !inside : inside) ? 1 : 0;
          });
        }
        this.p = savedPos; // not an interval: rewind and parse as a plain value
      }
      const right = this.bin(8);
      return makeNode('i', fighter => {
        const leftValue = left.f(fighter),
          rightValue = right.f(fighter);
        let equal;
        // String comparison is case-insensitive.
        if (typeof leftValue === 'string' || typeof rightValue === 'string')
          equal = String(leftValue).toLowerCase() === String(rightValue).toLowerCase();
        else equal = leftValue === rightValue;
        return (negate ? !equal : equal) ? 1 : 0;
      });
    }
    /**
     * Builds the node of a binary operator. The result is a float when either side is; '/' truncates on integers.
     * @param {string} op operator
     * @param {object} left left node
     * @param {object} right right node
     */
    makeBinary(op, left, right) {
      const isFloat = isFloatNode(left) || isFloatNode(right),
        type = isFloat ? 'f' : 'i';
      switch (op) {
        case '+':
          return makeNode(type, fighter => toNumber(left.f(fighter)) + toNumber(right.f(fighter)));
        case '-':
          return makeNode(type, fighter => toNumber(left.f(fighter)) - toNumber(right.f(fighter)));
        case '*':
          return makeNode(type, fighter => toNumber(left.f(fighter)) * toNumber(right.f(fighter)));
        case '/':
          return makeNode(type, fighter => {
            const divisor = toNumber(right.f(fighter));
            if (!divisor) return 0; // division by zero yields 0 instead of throwing
            const dividend = toNumber(left.f(fighter));
            return isFloat ? dividend / divisor : Math.trunc(dividend / divisor);
          });
        case '%':
          return makeNode('i', fighter => {
            const divisor = toNumber(right.f(fighter)) | 0;
            return divisor ? (toNumber(left.f(fighter)) | 0) % divisor : 0;
          });
        case '<':
          return makeNode('i', fighter => (toNumber(left.f(fighter)) < toNumber(right.f(fighter)) ? 1 : 0));
        case '>':
          return makeNode('i', fighter => (toNumber(left.f(fighter)) > toNumber(right.f(fighter)) ? 1 : 0));
        case '<=':
          return makeNode('i', fighter => (toNumber(left.f(fighter)) <= toNumber(right.f(fighter)) ? 1 : 0));
        case '>=':
          return makeNode('i', fighter => (toNumber(left.f(fighter)) >= toNumber(right.f(fighter)) ? 1 : 0));
        case '&&':
          return makeNode('i', fighter => (toNumber(left.f(fighter)) && toNumber(right.f(fighter)) ? 1 : 0));
        case '||':
          return makeNode('i', fighter => (toNumber(left.f(fighter)) || toNumber(right.f(fighter)) ? 1 : 0));
        case '^^':
          return makeNode('i', fighter =>
            (toNumber(left.f(fighter)) !== 0) !== (toNumber(right.f(fighter)) !== 0) ? 1 : 0
          );
        case '&':
          return makeNode('i', fighter => (toNumber(left.f(fighter)) | 0) & (toNumber(right.f(fighter)) | 0));
        case '|':
          return makeNode('i', fighter => toNumber(left.f(fighter)) | 0 | (toNumber(right.f(fighter)) | 0));
        case '^':
          return makeNode('i', fighter => (toNumber(left.f(fighter)) | 0) ^ (toNumber(right.f(fighter)) | 0));
      }
      throw new Error('op ' + op);
    }
    /** Parses exponentiation (**), which is right-associative and binds tighter than * / %. */
    pow() {
      const base = this.unary();
      if (this.isOp('**')) {
        this.p++;
        const exponent = this.pow();
        const isFloat = isFloatNode(base) || isFloatNode(exponent);
        return makeNode(isFloat ? 'f' : 'i', fighter => {
          const baseValue = toNumber(base.f(fighter)),
            exponentValue = toNumber(exponent.f(fighter));
          const result = Math.pow(baseValue, exponentValue);
          return isFloat ? result : Math.trunc(result);
        });
      }
      return base;
    }
    /** Parses the prefix operators ! - ~ + and then a primary. */
    unary() {
      const token = this.peek();
      if (token && token.k === 'op') {
        if (token.v === '!') {
          this.p++;
          const operand = this.unary();
          return makeNode('i', fighter => (toNumber(operand.f(fighter)) ? 0 : 1));
        }
        if (token.v === '-') {
          this.p++;
          const operand = this.unary();
          return makeNode(operand.t, fighter => -toNumber(operand.f(fighter)));
        }
        if (token.v === '~') {
          this.p++;
          const operand = this.unary();
          return makeNode('i', fighter => ~(toNumber(operand.f(fighter)) | 0));
        }
        if (token.v === '+') {
          this.p++;
          return this.unary();
        }
      }
      return this.primary();
    }
    /** Parses a comma separated argument list; the opening '(' is already consumed. */
    args() {
      const args = [];
      if (this.isOp(')')) {
        this.p++;
        return args;
      }
      for (;;) {
        args.push(this.bin(1));
        if (this.isOp(',')) {
          this.p++;
          continue;
        }
        this.eat(')');
        return args;
      }
    }
    /** Parses literals, parenthesised expressions, redirections and every trigger form. */
    primary() {
      const token = this.peek();
      if (!token) throw new Error('unexpected end');
      if (token.k === 'num') {
        this.p++;
        const value = token.v;
        return makeNode(token.f ? 'f' : 'i', () => value);
      }
      if (token.k === 'str') {
        this.p++;
        const value = token.v.toLowerCase();
        return makeNode('s', () => value);
      }
      if (token.k === 'op') {
        if (token.v === '(') {
          this.p++;
          const inner = this.bin(0);
          this.eat(')');
          return inner;
        }
        throw new Error('unexpected ' + token.v);
      }
      /* identifier */
      this.p++;
      const name = token.v.toLowerCase();
      /* redirection: P2, Target, ... */
      if (REDIR[name] && this.isOp(',')) {
        this.p++;
        const inner = this.unary(),
          kind = REDIR[name];
        return makeNode(inner.t, fighter => {
          const redirected = resolveRedirection(kind, fighter);
          return redirected ? inner.f(redirected) : 0;
        });
      }
      /* Helper(id),trigger and PlayerID(id),trigger */
      if ((name === 'helper' || name === 'playerid') && this.isOp('(')) {
        this.p++;
        const idNode = this.bin(0);
        this.eat(')');
        this.eat(',');
        const inner = this.unary();
        return makeNode(inner.t, fighter => {
          const redirected = resolveRedirection(name, fighter, toNumber(idNode.f(fighter)) | 0);
          return redirected ? inner.f(redirected) : 0;
        });
      }
      /* Target(id),trigger: this engine tracks only the last target */
      if (name === 'target' && this.isOp('(')) {
        this.p++;
        this.bin(0);
        this.eat(')');
        this.eat(',');
        const inner = this.unary();
        return makeNode(inner.t, fighter => {
          const target = fighter.target;
          return target && target.life >= 0 ? inner.f(target) : 0;
        });
      }
      /* indexed redirection, e.g. EnemyNear(1),Alive or Enemy(0),Pos X: this is a 1-vs-1 engine, so only index 0 exists */
      if ((name === 'enemy' || name === 'enemynear') && this.isOp('(')) {
        this.p++;
        const indexNode = this.bin(0);
        this.eat(')');
        this.eat(',');
        const inner = this.unary();
        return makeNode(inner.t, fighter => {
          const opponent = fighter.opponent;
          return opponent && (toNumber(indexNode.f(fighter)) | 0) === 0 ? inner.f(opponent) : 0;
        });
      }
      /* Command = "name" / Command != "name" */
      if (name === 'command') {
        if (this.isOp('=') || this.isOp('!=')) {
          const negate = this.peek().v === '!=';
          this.p++;
          const nameToken = this.peek();
          this.p++;
          const commandName = (nameToken && (nameToken.k === 'str' ? nameToken.v : nameToken.v)) || '';
          return makeNode('i', fighter => (fighter.cmdActive(commandName) ? 1 : 0) ^ (negate ? 1 : 0));
        }
        return makeNode('i', () => 0);
      }
      if (name === 'animelem') {
        if (this.isOp('=') || this.isOp('!=')) {
          /* AnimElem = n [, op t]. Some content leaves out the comma ("AnimElem = 1 > 0"), so n is parsed above the comparison level */
          const negate = this.peek().v === '!=';
          this.p++;
          const elemNode = this.bin(9);
          const COMPARISONS = ['=', '!=', '<', '>', '<=', '>='],
            nextToken = this.peek();
          if (this.isOp(',') || (nextToken && nextToken.k === 'op' && COMPARISONS.indexOf(nextToken.v) >= 0)) {
            if (this.isOp(',')) this.p++;
            let compareToken = this.peek();
            if (compareToken && compareToken.k === 'op' && COMPARISONS.indexOf(compareToken.v) >= 0) this.p++;
            else compareToken = { v: '=' }; // no operator written: default to equality
            const timeNode = this.bin(9);
            return makeNode('i', fighter => {
              const elemTime = fighter.animElemTime(toNumber(elemNode.f(fighter))),
                wanted = toNumber(timeNode.f(fighter));
              let result;
              switch (compareToken.v) {
                case '=':
                  result = elemTime === wanted;
                  break;
                case '!=':
                  result = elemTime !== wanted;
                  break;
                case '<':
                  result = elemTime < wanted;
                  break;
                case '>':
                  result = elemTime > wanted;
                  break;
                case '<=':
                  result = elemTime <= wanted;
                  break;
                default:
                  result = elemTime >= wanted;
              }
              return result ? 1 : 0;
            });
          }
          return makeNode(
            'i',
            fighter => (fighter.animElemTime(toNumber(elemNode.f(fighter))) === 0 ? 1 : 0) ^ (negate ? 1 : 0)
          );
        }
        return makeNode('i', () => 0);
      }
      /* HitDefAttr = SCA, NA, SA, HA ... : matches the active HitDef's attribute list */
      if (name === 'hitdefattr') {
        let negate = false;
        if (this.isOp('!=')) negate = true;
        if (this.isOp('=') || this.isOp('!=')) this.p++;
        const attrs = [];
        for (;;) {
          const attrToken = this.peek();
          if (attrToken && attrToken.k === 'id') {
            attrs.push(attrToken.v.toUpperCase());
            this.p++;
            if (this.isOp(',') && this.peek(1) && this.peek(1).k === 'id') {
              this.p++;
              continue;
            }
          }
          break;
        }
        return makeNode('i', fighter => {
          const matches = fighter.hitdef && fighter.hitdef.attrMatch ? fighter.hitdef.attrMatch(attrs) : false;
          return (negate ? !matches : matches) ? 1 : 0;
        });
      }
      /* Const(key) and GetHitVar(key): the key is a single identifier token */
      if (name === 'const' || name === 'gethitvar') {
        this.eat('(');
        const keyToken = this.peek();
        this.p++;
        let key = (keyToken.v + '').toLowerCase();
        this.eat(')');
        if (name === 'const') {
          const isFloat = CONST_FLOAT_RE.test(key);
          return makeNode(isFloat ? 'f' : 'i', fighter => fighter.const(key));
        }
        return makeNode(GETHITVAR_FLOAT_KEYS[key] ? 'f' : 'i', fighter => getHitVarValue(fighter, key));
      }
      /* var(n) / fvar(n) / sysvar(n) / sysfvar(n): readable and assignable variable slots */
      if (name === 'var' || name === 'fvar' || name === 'sysvar' || name === 'sysfvar') {
        this.eat('(');
        const indexNode = this.bin(0);
        this.eat(')');
        const isFloat = name === 'fvar' || name === 'sysfvar',
          isSystem = name[0] === 's';
        const slots = fighter =>
          isSystem ? (isFloat ? fighter.sysfvars : fighter.sysvars) : isFloat ? fighter.fvars : fighter.vars;
        const node = makeNode(isFloat ? 'f' : 'i', fighter => {
          const value = slots(fighter)[toNumber(indexNode.f(fighter)) | 0];
          return value || 0;
        });
        node.assign = (fighter, value) => {
          const index = toNumber(indexNode.f(fighter)) | 0;
          if (index >= 0 && index < 64) slots(fighter)[index] = isFloat ? toNumber(value) : Math.trunc(toNumber(value));
        };
        /* var(n) := expr binds tighter than || and && in real content ("1||var(40):=var(40)-1") */
        if (this.isOp(':=')) {
          this.p++;
          const right = this.bin(7),
            assign = node.assign;
          return makeNode(right.t, fighter => {
            const value = right.f(fighter);
            assign(fighter, value);
            return value;
          });
        }
        return node;
      }
      /* Cond(test, a, b) / IfElse(test, a, b) */
      if (name === 'cond' || name === 'ifelse') {
        this.eat('(');
        const args = this.args();
        if (args.length < 3) throw new Error('cond');
        return makeNode(isFloatNode(args[1]) || isFloatNode(args[2]) ? 'f' : args[1].t === 's' ? 's' : 'i', fighter =>
          toNumber(args[0].f(fighter)) ? args[1].f(fighter) : args[2].f(fighter)
        );
      }
      /* axis triggers: Pos X, Vel Y, P2Dist X ... */
      if (AXIS[name] && this.peek() && this.peek().k === 'id' && /^[xyz]$/i.test(this.peek().v)) {
        const axis = this.peek().v.toLowerCase();
        this.p++;
        const [type, evaluate] = AXIS[name];
        return makeNode(type, fighter => evaluate(fighter, axis));
      }
      /* function-style triggers: Abs(x), AnimElemTime(n), Min(a,b) ... */
      if (FN[name] && this.isOp('(')) {
        this.p++;
        const args = this.args(),
          [type, evaluate] = FN[name],
          resultType = type === 'm' ? (args.some(isFloatNode) ? 'f' : 'i') : type;
        return makeNode(resultType, fighter =>
          evaluate(
            fighter,
            args.map(arg => toNumber(arg.f(fighter)))
          )
        );
      }
      /* plain argument-less triggers: Time, Life, Alive ... */
      if (ZERO[name] && !this.isOp('(')) {
        const [type, evaluate] = ZERO[name];
        return makeNode(type, evaluate);
      }
      if (this.isOp('(')) {
        // Unknown function-style trigger: skip its arguments, warn and evaluate to 0.
        this.p++;
        this.args();
        MG.warn('Unsupported trigger: ' + name + '()');
        return makeNode('i', () => 0);
      }
      /* bare word: treated as a string constant (S, C, A, L, I, H, U, NA, ...) */
      return makeNode(
        's',
        (() => {
          const value = name;
          return () => value;
        })()
      );
    }
  }
  /** Compiled expressions by source text. */
  const COMPILE_CACHE = new Map();
  /**
   * Compiles trigger source text into a node (cached). On a syntax error it warns and returns a node that is always 0.
   * @param {string} source expression text
   * @returns {{t: string, f: function(object): (number|string)}} compiled node
   */
  MG.compile = function (source) {
    if (COMPILE_CACHE.has(source)) return COMPILE_CACHE.get(source);
    let node;
    try {
      const parser = new Parser(tokenize(source));
      node = parser.parseTop();
      // A trailing top-level comma is tolerated (it separates arguments in some controllers).
      if (parser.p < parser.t.length && !(parser.t[parser.p].k === 'op' && parser.t[parser.p].v === ','))
        MG.warn('Trailing text in expression: ' + source);
    } catch (error) {
      MG.warn('Bad expression "' + source + '" (' + error.message + ')');
      node = makeNode('i', () => 0);
    }
    COMPILE_CACHE.set(source, node);
    return node;
  };
  /* the comma of a redirection ("P2,Life", "PlayerID(var(3)),Pos X") is part of the expression, not an argument separator */
  const REDIR_TAIL =
    /(?:^|[^A-Za-z0-9_.])(?:p1|p2|self|root|parent|target|helper|playerid|enemy|enemynear|partner)(?:\s*\((?:[^()]|\([^()]*\))*\))?\s*$/i;
  /**
   * Splits "a, b, c" at top-level commas (ignores commas inside brackets, quotes and redirection prefixes).
   * @param {string} text argument list text
   * @returns {string[]} trimmed arguments
   */
  MG.splitArgs = function (text) {
    const parts = [];
    let depth = 0,
      inQuotes = false,
      current = '';
    for (const char of text) {
      if (char === '"') inQuotes = !inQuotes;
      if (!inQuotes) {
        if (char === '(' || char === '[') depth++;
        else if (char === ')' || char === ']') depth--;
        else if (char === ',' && depth === 0 && !REDIR_TAIL.test(current)) {
          parts.push(current.trim());
          current = '';
          continue;
        }
      }
      current += char;
    }
    if (current.trim() !== '' || parts.length) parts.push(current.trim());
    return parts;
  };
  /** Compiles every comma separated argument of `text`; returns an array of nodes. */
  MG.compileList = text => MG.splitArgs(text).map(part => MG.compile(part));
  /** Compiles and evaluates `source` for `fighter` (test helper). */
  MG.exprTest = function (source, fighter) {
    return MG.compile(source).f(fighter);
  };
})();
