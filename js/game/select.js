/* =====================================================================
   Fighter and stage selection screen.
   Sel keeps one cursor per player (`c`), the lock state, the stage choice
   and builds the card grid from CHARS. It starts the match (or reports the
   pick to the online lobby) once every needed player has confirmed.
   ===================================================================== */

/** Selection screen controller. `c[p]` is the cursor index of player p, `lock[p]` its confirmed flag. */
const Sel = {
  mode: 'arcade',
  c: [0, 1],
  lock: [false, false],
  built: false,
  going: false,
  stageIdx: -1,
  onDone: null,
  /** @returns {number} number of grid columns for the current roster size */
  cols() {
    return CHARS.length > 9 ? 5 : CHARS.length > 4 ? 4 : 3;
  },
  /** (Re)builds the character card grid from CHARS and clamps the cursors. */
  build() {
    if (this.io) this.io.disconnect();
    Thumbs.q.length = 0;
    const grid = $('#grid');
    grid.innerHTML = '';
    grid.style.setProperty('--cols', this.cols());
    CHARS.forEach((ch, charIndex) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.i = charIndex;
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = Thumbs.W;
      thumbCanvas.height = Thumbs.H;
      this.lazyThumb(thumbCanvas, ch);
      card.appendChild(thumbCanvas);
      card.insertAdjacentHTML(
        'beforeend',
        '<span class="cn"></span><span class="cur a">P1</span><span class="cur b">P2</span>'
      );
      card.querySelector('.cn').textContent = ch.name;
      card.addEventListener('mouseenter', () => {
        if (this.going) return;
        const player = this.activeP();
        if (player >= 0) {
          this.c[player] = charIndex;
          this.paint();
        }
      });
      card.addEventListener('click', () => {
        const player = this.activeP();
        if (player >= 0) {
          this.c[player] = charIndex;
          this.confirm(player);
        }
      });
      grid.appendChild(card);
    });
    this.c = this.c.map(cursor => Math.min(cursor, Math.max(0, CHARS.length - 1)));
    this.built = true;
    this.paintStage();
  },
  /**
   * The picture is made only when the card scrolls into view.
   * @param {HTMLCanvasElement} thumbCanvas card canvas to draw into
   * @param {object} ch roster entry whose thumbnail is wanted
   */
  lazyThumb(thumbCanvas, ch) {
    /** Copies the finished thumbnail into the card canvas. */
    const paint = source => {
      const context = thumbCanvas.getContext('2d');
      context.drawImage(source, 0, 0);
    };
    if (!('IntersectionObserver' in window)) {
      Thumbs.request(ch, paint);
      return;
    }
    if (!this.io)
      this.io = new IntersectionObserver(
        entries => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              this.io.unobserve(entry.target);
              entry.target._go();
            }
        },
        { root: $('#grid'), rootMargin: '120px' }
      );
    thumbCanvas._go = () => Thumbs.request(ch, paint);
    this.io.observe(thumbCanvas);
  },
  /** @returns {number} index of the player whose cursor is active (the one still choosing), or -1 */
  activeP() {
    if (this.mode !== 'versus' && this.mode !== 'online') return this.lock[0] ? -1 : 0;
    if (this.mode === 'online') return this.lock[0] ? -1 : 0;
    return !this.lock[0] ? 0 : !this.lock[1] ? 1 : -1;
  },
  /**
   * Opens the selection screen.
   * @param {string} mode 'arcade' | 'versus' | 'practice' | 'online'
   * @param {Function} [onDone] online only: called with the chosen roster entry
   */
  open(mode, onDone) {
    if (!CHARS.length) {
      MGUI.status('Load at least one MUGEN character first.', true);
    }
    if (!this.built) this.build();
    this.mode = mode;
    this.onDone = onDone || null;
    this.lock = [false, false];
    this.going = false;
    if (CHARS.length > 1 && this.c[1] === this.c[0]) this.c[1] = (this.c[0] + 1) % CHARS.length;
    $('#sel-title').textContent =
      mode === 'versus'
        ? 'PLAYERS, CHOOSE YOUR FIGHTERS'
        : mode === 'practice'
          ? 'CHOOSE A TRAINING FIGHTER'
          : 'CHOOSE YOUR FIGHTER';
    $('#sel-hint').innerHTML =
      mode === 'versus'
        ? 'P1: <kbd>WASD</kbd> + <kbd>J</kbd> &nbsp; P2: <kbd>&larr;&uarr;&darr;&rarr;</kbd> + <kbd>;</kbd> &nbsp; or click'
        : 'Move <kbd>WASD</kbd> / <kbd>arrows</kbd>, select <kbd>J</kbd> / <kbd>Enter</kbd>, or click';
    $('#sel-stage').hidden = mode === 'online' && Net.role === 'guest';
    this.paint();
    this.paintStage();
    show('select');
    Snd.ui();
  },
  /** Updates the stage button label. */
  paintStage() {
    const stageButton = $('#sel-stage');
    if (stageButton)
      stageButton.textContent =
        'Stage: ' + (this.stageIdx < 0 ? 'Random' : STAGES[this.stageIdx] ? STAGES[this.stageIdx].name : 'Random');
  },
  /**
   * Moves the stage choice through "Random" and the installed stages.
   * @param {number} [direction] +1 (default) or -1
   */
  cycleStage(direction) {
    const optionCount = STAGES.length + 1;
    this.stageIdx = ((((this.stageIdx + 1 + (direction || 1)) % optionCount) + optionCount) % optionCount) - 1;
    this.paintStage();
    Snd.ui();
  },
  /** @returns {object|string} the chosen stage record, or 'random' */
  stageRec() {
    return this.stageIdx < 0 ? 'random' : STAGES[this.stageIdx];
  },
  /** Repaints the cursors, lock marks and the info panel of the fighter under the active cursor. */
  paint() {
    document.querySelectorAll('#grid .card').forEach((card, cardIndex) => {
      card.classList.toggle('p1c', this.c[0] === cardIndex);
      card.classList.toggle('p2c', this.mode === 'versus' && this.c[1] === cardIndex);
      card.classList.toggle(
        'lock',
        (this.lock[0] && this.c[0] === cardIndex) || (this.mode === 'versus' && this.lock[1] && this.c[1] === cardIndex)
      );
    });
    const info = $('#info');
    if (!CHARS.length) {
      info.innerHTML =
        '<div class="ttl">No fighters found</div><p>Nothing was found in <b></b>. Set the content folder below, or add a MUGEN folder or ZIP.</p>';
      info.querySelector('b').textContent = Content.base;
      return;
    }
    const activePlayer = this.activeP(),
      ch = CHARS[this.c[activePlayer < 0 ? 0 : activePlayer]] || CHARS[0],
      pkg = ch.mugen,
      escapeHtml = text => String(text).replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
    const rows = pkg.loaded
      ? '<li><span>LIFE</span>' +
        (pkg.consts['data.life'] ? pkg.consts['data.life'][0] : 1000) +
        '</li><li><span>SFF</span>v' +
        pkg.sff.ver +
        ' · ' +
        pkg.sff.list.length +
        ' sprites</li><li><span>AIR</span>' +
        pkg.air.size +
        ' animations</li><li><span>CMD</span>' +
        pkg.commands.length +
        ' commands · ' +
        pkg.states.size +
        ' states</li><li><span>SND</span>' +
        pkg.snd.size +
        ' sounds</li><li><span>RES</span>' +
        (pkg.local ? pkg.local.join('×') : '320×240') +
        '</li>'
      : '<li><span>FILE</span>' + escapeHtml(pkg.defPath) + '</li><li><span>LOAD</span>when the match starts</li>';
    info.innerHTML =
      '<div class="ttl">' +
      escapeHtml(ch.title || '') +
      '</div><div class="big" style="color:' +
      ch.c.accent +
      '">' +
      escapeHtml(ch.name) +
      '</div><ul>' +
      rows +
      '</ul><div class="ttl">Move list: see the fighter\'s .cmd file</div>';
  },
  /**
   * Moves a player's cursor over the grid (wrapping).
   * @param {number} player 0 or 1
   * @param {number} dx horizontal step (-1, 0, 1)
   * @param {number} dy vertical step (-1, 0, 1)
   */
  move(player, dx, dy) {
    if (this.lock[player] || this.going || !CHARS.length) return;
    const charCount = CHARS.length,
      columns = this.cols();
    let index = this.c[player];
    if (dx)
      index = Math.min(
        charCount - 1,
        Math.floor(index / columns) * columns + (((index % columns) + dx + columns) % columns)
      );
    if (dy) index = (index + dy * columns + charCount * columns) % charCount;
    this.c[player] = index;
    Snd.ui();
    this.paint();
  },
  /**
   * Locks a player's choice; starts the match when everyone needed has locked.
   * @param {number} player 0 or 1
   */
  confirm(player) {
    if (this.lock[player] || this.going || !CHARS.length) return;
    this.lock[player] = true;
    Snd.ok();
    Snd.say(CHARS[this.c[player]].name, 0.4, 0.8);
    this.paint();
    if (this.mode === 'versus' ? this.lock[0] && this.lock[1] : this.lock[0]) {
      this.going = true;
      setTimeout(() => this.go(), 700);
    }
  },
  /** Leaves the screen: starts the match for the current mode (or reports the pick online). */
  go() {
    if (UI.cur !== 'select') return;
    const player1Char = CHARS[this.c[0]];
    if (this.mode === 'online') {
      if (this.onDone) this.onDone(player1Char);
      return;
    }
    if (this.mode === 'versus') Match.begin('versus', player1Char, CHARS[this.c[1]], this.stageRec(), 0);
    else if (this.mode === 'practice')
      Match.begin('practice', player1Char, opponentsFor(player1Char, 1)[0], this.stageRec(), 0);
    else {
      Match.ladder = opponentsFor(player1Char, 3);
      Match.lad = 0;
      Match.begin('arcade', player1Char, Match.ladder[0], this.stageRec(), 1);
    }
  },
  /**
   * Handles a key press on the selection screen.
   * @param {string} code KeyboardEvent.code
   */
  key(code) {
    if (code === 'Escape') {
      if (this.mode === 'online') Net.close();
      toMenu();
      return;
    }
    const player1Moves = { KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, -1], KeyS: [0, 1] },
      player2Moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const single = this.mode !== 'versus';
    if (code === 'KeyT') {
      this.cycleStage(1);
      return;
    }
    if (player1Moves[code]) this.move(0, ...player1Moves[code]);
    else if (player2Moves[code]) this.move(single ? 0 : 1, ...player2Moves[code]);
    else if (code === 'KeyJ' || (single && (code === 'Enter' || code === 'Space' || code === 'Semicolon')))
      this.confirm(0);
    else if (code === 'Semicolon' || code === 'Enter') this.confirm(1);
  }
};
