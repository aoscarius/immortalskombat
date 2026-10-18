/* =====================================================================
   UI helpers: screen switching, banners, menu navigation, HUD.
   Provides show() / setHud() / banner() / clearBanner(), the tick-based
   scheduler (Sched), keyboard and mouse menu helpers (navMenu / bindMenu),
   the two-player HUD (HUD / hudInit / hudUpdate) and the loading notice.
   ===================================================================== */

/** Ids of the full-screen panels (the DOM ids are "scr-" + name). */
const SCRS = ['title', 'select', 'result', 'help', 'pause', 'net'];

/** UI state: `cur` is the visible screen ('game' when none), `helpFrom` is where Help returns to. */
const UI = { cur: 'title', helpFrom: 'title' };

/**
 * Shows one screen and hides the others. An unknown id means "in game".
 * @param {string} screenId name from SCRS, or any other value to hide every screen
 */
function show(screenId) {
  for (const name of SCRS) $('#scr-' + name).hidden = name !== screenId;
  UI.cur = SCRS.indexOf(screenId) >= 0 ? screenId : 'game';
}

/**
 * Shows or hides the in-game HUD.
 * @param {boolean} visible true to show it
 */
function setHud(visible) {
  $('#hud').hidden = !visible;
}

/**
 * Pops up the big centre banner (and optionally a smaller sub line).
 * @param {string} text main banner text
 * @param {string} [extraClasses] space separated CSS classes added to the banner
 * @param {string} [subText] smaller text shown under the banner
 * @param {boolean} [keepSub] keep the sub line on screen ("hold" class)
 */
function banner(text, extraClasses = '', subText = '', keepSub = false) {
  const bannerEl = $('#banner'),
    subEl = $('#sub');
  bannerEl.className = '';
  subEl.className = '';
  void bannerEl.offsetWidth; /* force a reflow so the CSS animation restarts */
  bannerEl.textContent = text;
  subEl.textContent = subText;
  if (extraClasses) extraClasses.split(' ').forEach(cssClass => bannerEl.classList.add(cssClass));
  bannerEl.classList.add('show');
  if (subText) {
    subEl.classList.add('show');
    if (keepSub) subEl.classList.add('hold');
  }
}

/** Hides the banner and its sub line. */
function clearBanner() {
  $('#banner').className = '';
  $('#sub').className = '';
}

/**
 * Tick-based scheduler: stepped inside the simulation tick so it stays in
 * lockstep online. Each queue entry is `{ t: ticksLeft, fn: callback }`.
 */
const Sched = {
  q: [],
  /**
   * Runs a callback after a number of simulation ticks.
   * @param {number} ticks delay in ticks
   * @param {Function} callback function to call when the delay is over
   */
  at(ticks, callback) {
    this.q.push({ t: ticks, fn: callback });
  },
  /** Drops every pending entry. */
  clear() {
    this.q = [];
  },
  /** Advances one tick and runs the entries that are due. */
  step() {
    for (const entry of this.q) entry.t--;
    const dueEntries = this.q.filter(entry => entry.t <= 0);
    this.q = this.q.filter(entry => entry.t > 0);
    dueEntries.forEach(entry => entry.fn());
  }
};

/** Scales the 960-unit-wide stage layout to the real stage element width (CSS var --u). */
function fit() {
  const stageEl = $('#stage');
  document.documentElement.style.setProperty('--u', stageEl.clientWidth / 960 + 'px');
}
new ResizeObserver(fit).observe($('#stage'));
addEventListener('resize', fit);
fit();

/**
 * Keyboard navigation of a vertical button menu (up/down move, confirm clicks).
 * @param {string} code KeyboardEvent.code of the pressed key
 * @param {HTMLElement} container element holding the `.btn` buttons
 */
function navMenu(code, container) {
  const buttons = [...container.querySelectorAll('.btn')];
  if (!buttons.length) return;
  let index = Math.max(
    0,
    buttons.findIndex(button => button.classList.contains('sel'))
  );
  if (code === 'ArrowUp' || code === 'KeyW') index = (index + buttons.length - 1) % buttons.length;
  else if (code === 'ArrowDown' || code === 'KeyS') index = (index + 1) % buttons.length;
  else if (code === 'Enter' || code === 'Space' || code === 'KeyJ' || code === 'Semicolon') {
    Snd.ok();
    buttons[index].click();
    return;
  } else return;
  buttons.forEach(button => button.classList.remove('sel'));
  buttons[index].classList.add('sel');
  Snd.ui();
}

/**
 * Makes the mouse hover highlight a menu button.
 * @param {HTMLElement} container element holding the `.btn` buttons
 */
function bindMenu(container) {
  container.addEventListener('mouseover', event => {
    const hovered = event.target.closest('.btn');
    if (hovered) {
      container.querySelectorAll('.btn').forEach(button => button.classList.remove('sel'));
      hovered.classList.add('sel');
    }
  });
}

/* ------------------------------ HUD ------------------------------ */

/** DOM handles of the two HUD halves (index 0 = player 1, index 1 = player 2). */
const HUD = [0, 1].map(index => {
  const root = $('#hud' + (index + 1));
  return {
    e: root,
    name: root.querySelector('.name'),
    port: root.querySelector('.port'),
    fill: root.querySelector('.fill'),
    lag: root.querySelector('.lag'),
    mf: root.querySelector('.mfill'),
    m: root.querySelector('.meter'),
    pips: [...root.querySelectorAll('.pips i')],
    combo: $('#combo' + (index + 1))
  };
});

/** Fills the HUD with the names and portraits of the current fighters. */
function hudInit() {
  G.fighters.forEach((fighter, index) => {
    const hud = HUD[index];
    hud.name.textContent = fighter.ch.name;
    hud.name.style.color = fighter.ch.c.accent;
    Mugen.portrait(hud.port, fighter.ch, true);
    hud.fill.style.transform = hud.lag.style.transform = 'scaleX(1)';
    hud.key = null;
  });
}

/** Refreshes bars, round pips, combo counter and timer; the DOM is touched only on change. */
function hudUpdate() {
  if ($('#hud').hidden) return;
  G.fighters.forEach((fighter, index) => {
    const hud = HUD[index],
      lifeRatio = Math.max(0, fighter.hp / fighter.maxHp),
      meterRatio = clamp(fighter.meter / 100, 0, 1),
      comboHtml =
        fighter.comboShow > 0 && fighter.comboHits > 1
          ? fighter.comboHits + ' HITS<small>' + Math.round(fighter.comboDmg) + ' DAMAGE</small>'
          : '';
    const stateKey = lifeRatio + '|' + meterRatio + '|' + Match.wins[index] + '|' + comboHtml;
    if (hud.key === stateKey) return;
    hud.key = stateKey; /* DOM is touched only when something changed */
    hud.fill.style.transform = 'scaleX(' + lifeRatio + ')';
    hud.lag.style.transform = 'scaleX(' + lifeRatio + ')';
    hud.fill.classList.toggle('low', lifeRatio < 0.25 && lifeRatio > 0);
    hud.mf.style.transform = 'scaleX(' + meterRatio + ')';
    hud.m.classList.toggle('full', fighter.meter >= 100);
    hud.pips.forEach((pip, pipIndex) => pip.classList.toggle('on', pipIndex < Match.wins[index]));
    if (comboHtml) {
      hud.combo.innerHTML = comboHtml;
      hud.combo.classList.add('on');
    } else hud.combo.classList.remove('on');
  });
  const timerEl = $('#timer'),
    timerText = Match.mode === 'practice' ? '∞' : String(Math.max(0, G.timer)).padStart(2, '0');
  if (timerEl.textContent !== timerText) {
    timerEl.textContent = timerText;
    timerEl.classList.toggle('warn', Match.mode !== 'practice' && G.timer <= 10);
  }
}

/** Loading notice shown while a fighter or stage is being read. */
const Loading = {
  /**
   * Shows the notice.
   * @param {string} message text to display
   */
  show(message) {
    const el = $('#loading');
    if (el) {
      el.textContent = message;
      el.hidden = false;
    }
  },
  /** Hides the notice. */
  hide() {
    const el = $('#loading');
    if (el) el.hidden = true;
  }
};
