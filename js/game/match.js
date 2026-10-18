/* =====================================================================
   Match flow: arcade ladder, local versus, practice, online.
   Round states: intro -> fight -> ko / time -> over -> next round or result.
   ===================================================================== */
/**
 * Builds the controller of a human player: a function returning the pressed-key table each tick.
 * @param {number} slot 0 for player 1 keys, 1 for player 2 keys
 * @param {boolean} single true when one person plays alone: player 2 keys are merged into player 1
 * @returns {function(): object} input sampler
 */
function humanCtrl(slot, single) {
  return () => {
    const pressed = sample(slot === 0 ? 'p1' : 'p2');
    if (single) {
      const secondPlayerKeys = sample('p2');
      for (const key in secondPlayerKeys) if (secondPlayerKeys[key]) pressed[key] = 1;
    }
    return pressed;
  };
}

/* practice dummy behaviours */
const DUMMIES = ['stand', 'crouch', 'block', 'jump', 'cpu'];

/**
 * Builds the controller of the practice dummy; its behaviour follows Match.dummy.
 * @param {object} match the Match object (read for the current dummy mode)
 * @param {function} aiController AI controller used by the 'cpu' dummy mode
 * @returns {function(object, object): object} controller taking (self, opponent)
 */
function dummyCtrl(match, aiController) {
  return (self, opponent) => {
    switch (match.dummy) {
      case 'crouch':
        return { down: 1 };
      case 'block':
        // hold the direction away from the opponent to block
        return self.face > 0 ? { left: 1 } : { right: 1 };
      case 'jump':
        return G.time % 90 === 0 ? { up: 1 } : {};
      case 'cpu':
        return aiController(self, opponent);
      default:
        return {};
    }
  };
}

/**
 * Resolves the stage record to play on; a missing record or 'random' picks one at random.
 * @param {object|string|null} stageRecord roster stage record, 'random' or nothing
 * @returns {object} stage record (the fallback room when no stage is known)
 */
function pickStage(stageRecord) {
  if (!stageRecord || stageRecord === 'random')
    stageRecord = STAGES.length ? STAGES[rint(0, STAGES.length - 1)] : FALLBACK_REC;
  return stageRecord;
}

/**
 * Builds the arcade ladder: random other fighters, padded with palette mirrors of the player.
 * @param {object} playerChar the player's roster entry
 * @param {number} count number of opponents wanted
 * @returns {object[]} opponent roster entries
 */
function opponentsFor(playerChar, count) {
  const others = shuffle(CHARS.filter(entry => entry.id !== playerChar.id)),
    opponents = others.slice(0, count);
  for (let palette = 2; opponents.length < count; palette++) opponents.push(Roster.mirrorOf(playerChar, palette));
  return opponents;
}

/** Match state and flow: rounds, wins, arcade ladder and the result screen. */
const Match = {
  mode: 'arcade',
  wins: [0, 0], // rounds won by each side
  round: 1,
  ladder: [], // arcade opponents
  lad: 0, // index into the ladder
  stageRec: null,
  dummy: 'stand',
  c: [null, null],
  lv: 1,
  net: null,
  seed: 1,
  tok: 0, // load token: a newer begin() or toMenu() invalidates a pending load

  /**
   * Loads what the match needs and starts round one.
   * @param {string} mode 'arcade', 'versus', 'practice' or 'online'
   * @param {object} char1 roster entry of player 1
   * @param {object} char2 roster entry of player 2
   * @param {object|string|null} stageRec stage record or 'random'
   * @param {number} level AI difficulty level
   * @param {{net?: object, seed?: number, ready?: function}} [opts] online session, forced RNG seed, ready callback
   */
  async begin(mode, char1, char2, stageRec, level, opts) {
    opts = opts || {};
    const token = ++this.tok;
    if (char1.id === char2.id && char1.palSlot === char2.palSlot) char2 = Roster.mirrorOf(char2, 2);
    const rec = pickStage(stageRec);
    G.paused = false;
    /* bring in only what this match needs; everything else is released */
    Loading.show('Loading…');
    try {
      await Roster.prepare([char1, char2], rec, message => Loading.show(message));
    } catch (error) {
      console.error(error);
      Loading.hide();
      if (token === this.tok) {
        toMenu();
        alert_('Could not load: ' + ((error && error.message) || error));
      }
      return;
    }
    Loading.hide();
    if (token !== this.tok) return; // superseded while loading
    this.mode = mode;
    G.mode = mode;
    Sched.clear();
    this.c = [char1, char2];
    this.lv = level;
    this.net = opts.net || null;
    this.stageRec = rec;
    this.seed = opts.seed !== undefined ? opts.seed : (Math.random() * 4294967295) >>> 0;
    RNG.seed(this.seed);
    const stage = rec.get();
    G.setStage(stage);
    G.parts = [];
    G.time = 0;
    Mugen.pause = null;
    G.showBoxes = G.showBoxes || false;
    const aiController = Mugen.makeAI(Math.max(1, level + 2));
    let controller1, controller2;
    if (mode === 'online') {
      controller1 = Net.ctrl(0);
      controller2 = Net.ctrl(1);
    } else {
      controller1 = humanCtrl(0, mode !== 'versus');
      controller2 =
        mode === 'versus' ? humanCtrl(1, false) : mode === 'practice' ? dummyCtrl(this, aiController) : aiController;
    }
    G.fighters = [
      new MugenFighter(char1, 0, controller1, char1.palSlot || 1),
      new MugenFighter(char2, 1, controller2, char2.palSlot || 1)
    ];
    this.wins = [0, 0];
    this.round = 1;
    this.dummy = 'stand';
    hudInit();
    setHud(true);
    show('game');
    this.tip();
    if (stage.music && !(this.net && false)) Snd.playStageMusic(stage.music.bytes, stage.music.vol);
    else {
      Snd.stopStageMusic();
      Snd.music(true);
    }
    if (opts.ready) opts.ready();
    this.startRound();
  },

  /** Creates/updates the practice-mode hint showing the current dummy behaviour. */
  tip() {
    let tipBox = $('#tip');
    if (!tipBox) {
      tipBox = document.createElement('div');
      tipBox.id = 'tip';
      $('#stage').appendChild(tipBox);
    }
    tipBox.hidden = this.mode !== 'practice';
    tipBox.textContent = 'PRACTICE  |  T: DUMMY = ' + this.dummy.toUpperCase();
  },

  /** Resets both fighters and the stage, then runs the intro banners and unlocks the fight after 150 ticks. */
  startRound() {
    const [fighter1, fighter2] = G.fighters,
      stage = G.stage;
    fighter1.reset(stage.p1x, 1);
    fighter2.reset(stage.p2x, -1);
    if (stage.reset) stage.reset();
    G.cam.x = clamp((stage.p1x + stage.p2x) / 2 - W / 2, stage.camMin, stage.camMax);
    G.parts = [];
    G.timer = 99;
    G.frames = 0;
    G.phase = 'intro';
    G.locked = true;
    G.slow = 0;
    G.flash = 0;
    Mugen.pause = null;
    const isFinalRound = this.wins[0] === 1 && this.wins[1] === 1;
    banner(
      isFinalRound ? 'FINAL ROUND' : 'ROUND ' + this.round,
      '',
      G.fighters[0].ch.name + '   VS   ' + G.fighters[1].ch.name
    );
    Snd.say(isFinalRound ? 'Final round' : 'Round ' + this.round);
    Sched.at(110, () => {
      banner('FIGHT!', 'fight');
      Snd.say('Fight!', 0.4, 0.9);
      Snd.boom();
    });
    Sched.at(150, () => {
      G.phase = 'fight';
      G.locked = false;
    });
  },

  /**
   * Called when a fighter is knocked out: freezes input, plays the K.O. effects and ends the round.
   * @param {object} defeated the fighter that lost all life
   * @param {object} owner the fighter credited with the win
   */
  ko(defeated, owner) {
    if (G.phase !== 'fight') return;
    G.phase = 'ko';
    G.locked = true;
    G.slow = 90;
    banner('K.O.', 'ko hold');
    Snd.ko();
    G.flash = 0.8;
    Snd.say('K O', 0.3, 0.6);
    Sched.at(190, () => this.endRound(owner));
  },

  /** Time ran out: the fighter with the higher life ratio wins, equal ratios draw. */
  timeOver() {
    if (G.phase !== 'fight') return;
    G.phase = 'time';
    G.locked = true;
    banner('TIME', 'hold');
    const [fighter1, fighter2] = G.fighters,
      ratio1 = fighter1.hp / fighter1.maxHp,
      ratio2 = fighter2.hp / fighter2.maxHp;
    Sched.at(100, () =>
      this.endRound(Math.abs(ratio1 - ratio2) < 0.001 ? null : ratio1 > ratio2 ? fighter1 : fighter2)
    );
  },

  /**
   * Scores the round, shows the winner banner and then starts the next round or the result screen.
   * @param {object|null} winner winning fighter, or null for a draw
   */
  endRound(winner) {
    const [fighter1, fighter2] = G.fighters;
    G.phase = 'over';
    G.locked = true;
    G.slow = 0;
    if (winner) {
      const winnerIndex = winner === fighter1 ? 0 : 1,
        loser = winnerIndex === 0 ? fighter2 : fighter1;
      this.wins[winnerIndex]++;
      winner.won = true;
      loser.won = false;
      banner(winner.ch.name + ' WINS', 'hold', winner.dmgTaken === 0 ? 'UNTOUCHED' : '', true);
      Snd.say(winner.ch.name + ' wins', 0.4, 0.8);
    } else banner('DRAW', 'hold');
    Sched.at(170, () => {
      if (this.mode === 'practice') {
        this.wins = [0, 0];
        this.startRound();
        return;
      }
      if (this.wins[0] >= 2 || this.wins[1] >= 2) this.finish();
      else {
        this.round++;
        this.startRound();
      }
    });
  },

  /** Match over: fills the result screen (title, winner, buttons) according to the mode and shows it. */
  finish() {
    G.phase = 'end';
    clearBanner();
    const winnerSlot = this.wins[0] >= 2 ? 0 : 1,
      winnerChar = this.c[winnerSlot],
      loserChar = this.c[1 - winnerSlot];
    const title = $('#res-title'),
      who = $('#res-who'),
      sub = $('#res-sub'),
      buttons = $('#res-btns');
    buttons.innerHTML = '';
    /** Appends one result-screen button; `selected` marks the default choice. */
    const add = (label, onClick, selected) => {
      const button = document.createElement('button');
      button.className = 'btn' + (selected ? ' sel' : '');
      button.textContent = label;
      button.onclick = () => {
        Snd.ok();
        onClick();
      };
      buttons.appendChild(button);
    };
    who.style.color = winnerChar.c.accent;
    if (this.mode === 'arcade') {
      if (winnerSlot === 0) {
        who.textContent = winnerChar.name + ' DEFEATS ' + loserChar.name;
        if (this.lad < this.ladder.length - 1) {
          title.textContent = 'VICTORY';
          sub.textContent = 'Opponent ' + (this.lad + 2) + ' of ' + this.ladder.length + ' awaits';
          add(
            'Next opponent',
            () => {
              this.lad++;
              this.begin('arcade', this.c[0], this.ladder[this.lad], 'random', this.lad + 1);
            },
            true
          );
        } else {
          title.textContent = 'CHAMPION';
          sub.textContent = 'You are the Immortal';
          Snd.say('Flawless. You are immortal.', 0.4, 0.8);
        }
        add('Main menu', toMenu, this.lad >= this.ladder.length - 1);
      } else {
        title.textContent = 'DEFEATED';
        who.textContent = winnerChar.name + ' STANDS VICTORIOUS';
        sub.textContent = 'Continue the fight?';
        add('Continue', () => this.begin('arcade', this.c[0], this.c[1], this.stageRec, this.lv), true);
        add('Main menu', toMenu);
      }
    } else if (this.mode === 'online') {
      const mine = Net.slot === winnerSlot;
      title.textContent = mine ? 'VICTORY' : 'DEFEATED';
      who.textContent = winnerChar.name + ' WINS';
      sub.textContent = 'Rounds ' + this.wins[winnerSlot] + ' - ' + this.wins[1 - winnerSlot];
      add('Rematch', () => Net.rematch(), true);
      add('Leave match', () => {
        Net.close();
        toMenu();
      });
    } else {
      title.textContent = winnerChar.name + ' WINS';
      who.textContent = 'ROUNDS ' + this.wins[winnerSlot] + ' - ' + this.wins[1 - winnerSlot];
      sub.textContent = 'Versus match complete';
      add('Rematch', () => this.begin('versus', this.c[0], this.c[1], 'random', 0), true);
      add('Fighters', () => Sel.open('versus'));
      add('Main menu', toMenu);
    }
    show('result');
    bindMenu($('#res-btns'));
  }
};
G.onKO = (defeated, owner) => Match.ko(defeated, owner);

/** Per-tick match rules: practice-mode auto refill, otherwise the round timer. */
G.onTick = () => {
  if (G.phase !== 'fight') return;
  const [fighter1, fighter2] = G.fighters;
  if (Match.mode === 'practice') {
    if (fighter1.power < fighter1.powerMax && fighter1.stateno === 0 && G.time % 90 === 0)
      fighter1.power = fighter1.powerMax;
    // a fighter standing idle for ~110 ticks is healed back to full life
    for (const fighter of [fighter1, fighter2]) {
      if ((fighter.stateno === 0 || fighter.stateno === 11) && fighter.hp < fighter.maxHp) {
        fighter._healIdle = (fighter._healIdle || 0) + 1;
        if (fighter._healIdle > 110) {
          fighter.life = fighter.maxHp;
          fighter.dmgTaken = 0;
        }
      } else fighter._healIdle = 0;
    }
    return;
  }
  if (++G.frames % 60 === 0) {
    G.timer--;
    if (G.timer <= 0) Match.timeOver();
  }
};

/** Returns to the title screen: cancels pending loads, stops sound and unloads fighters and stage. */
function toMenu() {
  Match.tok++;
  Loading.hide();
  Sched.clear();
  Snd.stopStageMusic();
  Snd.stopAll();
  Snd.music(true);
  clearBanner();
  setHud(false);
  const tipBox = $('#tip');
  if (tipBox) tipBox.hidden = true;
  if (Match.net) {
    Net.close();
  }
  G.paused = false;
  G.phase = 'menu';
  G.mode = 'menu';
  G.locked = true;
  G.slow = 0;
  Mugen.pause = null;
  /* the title screen keeps nothing loaded: no fighters, no stage bitmaps */
  G.fighters = [];
  G.parts = [];
  G.setStage(FALLBACK_STAGE);
  Roster.trim([], null);
  show('title');
}
