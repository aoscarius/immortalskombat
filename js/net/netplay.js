/* =====================================================================
   Online play: peer-to-peer over a PeerJS data channel with lockstep
   input exchange.

   - The host creates a room; its peer id is the room code. The guest enters the code.
   - Only inputs are sent. Both machines run the same simulation (seeded RNG,
     fixed 60 Hz tick) and advance a tick only when both players' inputs for
     that tick have arrived. Inputs are applied INPUT_DELAY ticks late to hide latency.
   - Characters and stages are matched by a content id. If the other side is
     missing one, its files are sent over the same channel.
   - A state checksum is exchanged every second to detect desyncs.
   The signalling server is PeerJS's public broker by default; set Net.peerOptions
   to use your own.

   Wire messages are plain objects tagged with `t`: hello, pick, stage, need, asset,
   chunk, start, in (one tick of input), h (state hash), rematch, bye.
   ===================================================================== */

/**
 * Network id of a stage record.
 * @param {{netId: string}} rec Stage record.
 * @returns {string} The id both peers use for this stage.
 */
const stageNet = rec => rec.netId;

/**
 * Finds a stage by its network id.
 * @param {string} net Network id ('fallback' means the built-in stage).
 * @returns {object|undefined} The stage record, if this machine has it.
 */
const findStage = net => (net === 'fallback' ? FALLBACK_REC : STAGES.find(stage => stage.netId === net));

/** Online play controller: connection, asset transfer and the lockstep clock. */
const Net = {
  peerOptions: {},
  /** Ticks by which every input is delayed, to hide network latency. */
  INPUT_DELAY: 4,
  /** Size in bytes of one asset chunk sent over the channel. */
  CHUNK: 48 * 1024,
  role: null,
  slot: 0,
  peer: null,
  conn: null,
  code: '',
  active: false,
  tick: 0,
  /** Packed inputs per slot, keyed by tick (this match's buffer). */
  inp: [{}, {}],
  /** Unpacked inputs of the tick being simulated, per slot. */
  cur: [{}, {}],
  /** Next tick for which a local input has not been sent yet. */
  nextLocal: 0,
  picks: [null, null],
  stageRec: null,
  bufs: new Map(),
  seed: 0,
  hashes: [{}, {}],
  desync: false,
  stalled: 0,
  rematchVotes: [false, false],
  incoming: new Map(),
  waiting: new Map(),

  /**
   * Shows a status line in the net screen.
   * @param {string} message Text to show.
   * @param {boolean} [isError] Style it as an error.
   */
  status(message, isError) {
    const element = $('#net-status');
    if (element) {
      element.textContent = message;
      element.classList.toggle('err', !!isError);
    }
  },

  /** @returns {boolean} True when the PeerJS library loaded. */
  available() {
    return typeof Peer !== 'undefined';
  },

  /**
   * Input buffer of a match, keyed by its seed. Buffering per seed lets a fast peer's early
   * inputs survive our match setup, and keeps inputs of old matches from leaking in.
   * @param {number} seed Match seed.
   * @returns {object[]} Two per-slot maps tick -> packed input.
   */
  buf(seed) {
    if (!this.bufs.has(seed)) {
      if (this.bufs.size > 3) this.bufs.clear();
      this.bufs.set(seed, [{}, {}]);
    }
    return this.bufs.get(seed);
  },

  /** @returns {string} A random 6-character room code (no look-alike characters). */
  newCode() {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    let code = '';
    for (let index = 0; index < 6; index++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
  },

  /** Clears the per-match lockstep state (tick counter, buffers, hashes, votes). */
  reset() {
    this.active = false;
    this.tick = 0;
    this.inp = this.buf(this.seed);
    this.cur = [{}, {}];
    this.nextLocal = 0;
    this.hashes = [{}, {}];
    this.desync = false;
    this.stalled = 0;
    this.rematchVotes = [false, false];
  },

  /** Closes the connection and forgets every piece of session state. */
  close() {
    this.active = false;
    try {
      if (this.conn) this.conn.close();
    } catch (error) {}
    try {
      if (this.peer) this.peer.destroy();
    } catch (error) {}
    this.conn = null;
    this.peer = null;
    this.role = null;
    this.picks = [null, null];
    this.stageRec = null;
    this.incoming.clear();
    this.waiting.clear();
    this.bufs.clear();
    Match.net = null;
  },

  /* ---------------- connecting ---------------- */

  /** Opens a room as the host (slot 0); the peer id is derived from a fresh room code. */
  host() {
    if (!this.available())
      return this.status('The PeerJS library did not load, so online play is unavailable here.', true);
    this.close();
    this.role = 'host';
    this.slot = 0;
    // Retries with a new code if the chosen id is already taken on the broker.
    const tryOpen = () => {
      this.code = this.newCode();
      this.status('Opening a room…');
      this.peer = new Peer('ik-' + this.code, this.peerOptions);
      this.peer.on('open', () => {
        $('#net-code').textContent = this.code.toUpperCase();
        $('#net-room').hidden = false;
        this.status('Room open. Send the code to your opponent and wait for them to join.');
      });
      this.peer.on('connection', incoming => {
        // Only one guest is allowed per room.
        if (this.conn) {
          try {
            incoming.close();
          } catch (error) {}
          return;
        }
        this.attach(incoming);
      });
      this.peer.on('error', error => {
        if (error && error.type === 'unavailable-id') {
          try {
            this.peer.destroy();
          } catch (destroyError) {}
          tryOpen();
        } else this.status('Connection problem: ' + ((error && error.type) || error), true);
      });
    };
    tryOpen();
  },

  /**
   * Joins a room as the guest (slot 1).
   * @param {string} code Room code typed by the user (an "ik-" prefix is accepted).
   */
  join(code) {
    code = (code || '').trim().toLowerCase().replace(/^ik-/, '');
    if (!code) return this.status('Type the room code first.', true);
    if (!this.available())
      return this.status('The PeerJS library did not load, so online play is unavailable here.', true);
    this.close();
    this.role = 'guest';
    this.slot = 1;
    this.status('Connecting…');
    this.peer = new Peer(undefined, this.peerOptions);
    this.peer.on('open', () => {
      const connection = this.peer.connect('ik-' + code, { reliable: true });
      this.attach(connection);
    });
    this.peer.on('error', error =>
      this.status(
        error && error.type === 'peer-unavailable'
          ? 'No room with that code.'
          : 'Connection problem: ' + ((error && error.type) || error),
        true
      )
    );
  },

  /**
   * Wires up a data connection and moves both sides to the character select screen.
   * @param {object} connection PeerJS data connection.
   */
  attach(connection) {
    this.conn = connection;
    let opened = false;
    const onOpen = () => {
      if (opened) return;
      opened = true;
      this.status('Connected. Pick your fighter.');
      this.send({ t: 'hello', v: 1 });
      this.picks = [null, null];
      this.reset();
      this.openSelect();
    };
    connection.on('open', onOpen);
    // The connection may already be open when we get it.
    if (connection.open) onOpen();
    connection.on('data', message => {
      try {
        this.onData(message);
      } catch (error) {
        console.error('net', error);
      }
    });
    connection.on('close', () => this.lost());
    connection.on('error', () => this.lost());
  },

  /** Handles a lost or closed connection: back to the menu with a notice. */
  lost() {
    if (!this.conn) return;
    const wasPlaying = this.active || UI.cur === 'game' || UI.cur === 'result';
    this.close();
    if (wasPlaying || UI.cur === 'select' || UI.cur === 'net') {
      toMenu();
      const tip = $('#tip');
      if (tip) tip.hidden = true;
      alert_(wasPlaying ? 'Your opponent disconnected.' : 'The connection was closed.');
    }
  },

  /**
   * Sends a message to the peer; silently ignored when not connected.
   * @param {object} message Plain object with a `t` tag.
   */
  send(message) {
    try {
      if (this.conn && this.conn.open !== false) this.conn.send(message);
    } catch (error) {}
  },

  /** Opens the online character select; a pick is announced to the peer. */
  openSelect() {
    Match.mode = 'online';
    Sel.stageIdx = -1;
    Sel.open('online', character => {
      this.picks[this.slot] = character;
      this.send({ t: 'pick', net: character.mugen.netId, name: character.name });
      this.status('Waiting for your opponent…');
      this.maybeStart();
    });
  },

  /* ---------------- assets ---------------- */

  /**
   * Dispatches one message received from the peer.
   * @param {object} message Received object, tagged with `t`.
   */
  async onData(message) {
    switch (message.t) {
      case 'pick': {
        const character = CHARS.find(candidate => candidate.mugen.netId === message.net);
        if (character) {
          this.picks[1 - this.slot] = character;
          this.maybeStart();
        } else {
          // Unknown fighter: ask for its files and re-evaluate the pick once they arrive.
          this.pendingPick = message;
          this.need('char', message.net, message.name);
        }
        break;
      }
      case 'stage': {
        if (message.none) {
          this.stageRec = 'random';
          this.maybeStart();
          break;
        }
        const stageRecord = findStage(message.net);
        if (stageRecord) {
          this.stageRec = stageRecord;
          this.maybeStart();
        } else this.need('stage', message.net, message.name);
        break;
      }
      case 'need':
        this.sendAsset(message.kind, message.net);
        break;
      case 'asset':
        // Announces an incoming transfer: prepares one slot per file for its chunks.
        this.incoming.set(message.kind + ':' + message.net, {
          kind: message.kind,
          net: message.net,
          files: message.files.map(file => ({ path: file.path, n: file.n, parts: [] })),
          got: 0,
          total: message.files.reduce((sum, file) => sum + file.n, 0)
        });
        break;
      case 'chunk':
        this.onChunk(message);
        break;
      case 'start':
        this.beginMatch(message);
        break;
      case 'in':
        // The peer's input for tick `f` of the match with seed `s`.
        this.buf(message.s)[1 - this.slot][message.f] = message.i;
        break;
      case 'h':
        this.hashes[1][message.f] = message.h;
        this.compare(message.f);
        break;
      case 'rematch':
        this.rematchVotes[1 - this.slot] = true;
        this.maybeRematch();
        break;
      case 'bye':
        this.lost();
        break;
    }
  },

  /**
   * Asks the peer for the files of a character or stage we do not have.
   * @param {'char'|'stage'} kind Asset kind.
   * @param {string} net Network id of the asset.
   * @param {string} [name] Display name for the status line.
   */
  need(kind, net, name) {
    this.status('Receiving ' + (name || kind) + ' from your opponent…');
    this.send({ t: 'need', kind, net });
  },

  /**
   * Sends an asset's files to the peer in chunks.
   * @param {'char'|'stage'} kind Asset kind.
   * @param {string} net Network id of the asset.
   */
  async sendAsset(kind, net) {
    let asset = null; // the asset is loaded first so the list of files it uses is known
    try {
      if (kind === 'char') {
        const character = CHARS.find(candidate => candidate.mugen.netId === net);
        if (character) asset = await Roster.loadChar(character);
      } else {
        const stageRecord = STAGES.find(candidate => candidate.netId === net);
        if (stageRecord) asset = await Roster.loadStage(stageRecord);
      }
    } catch (error) {
      console.error(error);
    }
    if (!asset || !asset.usedFiles) return;
    const files = await MG.exportFiles(asset);
    this.send({ t: 'asset', kind, net, files: files.map(file => ({ path: file.path, n: file.data.length })) });
    for (const file of files) {
      let chunkIndex = 0;
      do {
        this.send({
          t: 'chunk',
          kind,
          net,
          path: file.path,
          i: chunkIndex,
          data: file.data.subarray(chunkIndex * this.CHUNK, (chunkIndex + 1) * this.CHUNK)
        });
        chunkIndex++;
      } while (chunkIndex * this.CHUNK < file.data.length);
    }
  },

  /**
   * Stores one received chunk; when the whole asset has arrived, imports it.
   * @param {object} message Chunk message ({kind, net, path, i, data}).
   */
  async onChunk(message) {
    const transfer = this.incoming.get(message.kind + ':' + message.net);
    if (!transfer) return;
    const file = transfer.files.find(candidate => candidate.path === message.path);
    if (!file) return;
    file.parts[message.i] = message.data instanceof Uint8Array ? message.data : new Uint8Array(message.data);
    transfer.got += file.parts[message.i].length;
    this.status('Receiving… ' + Math.round((100 * transfer.got) / Math.max(1, transfer.total)) + '%');
    if (transfer.got < transfer.total) return;
    this.incoming.delete(message.kind + ':' + message.net);
    // Join each file's chunks back into one byte array.
    const entries = transfer.files.map(part => {
      const length = part.parts.reduce((sum, bytes) => sum + bytes.length, 0),
        joined = new Uint8Array(length);
      let offset = 0;
      for (const bytes of part.parts) {
        joined.set(bytes, offset);
        offset += bytes.length;
      }
      return { path: part.path, data: joined };
    });
    // The sender knows this asset by `transfer.net`; make the received copy answer to the same id.
    const added = await MGUI.importVfs(await MG.vfsFromEntries(entries), true, 'net');
    if (transfer.kind === 'char') for (const character of added.chars) character.mugen.netId = transfer.net;
    else for (const stageRecord of added.stages) stageRecord.netId = transfer.net;
    this.status('Received. Waiting to start…');
    // Re-evaluate what the other side picked.
    this.recheck();
  },

  /** Replays a pick that was waiting for assets, then tries to start. */
  recheck() {
    if (this.pendingPick) {
      const pending = this.pendingPick;
      this.pendingPick = null;
      this.onData(pending);
    }
    this.maybeStart();
  },

  /* ---------------- starting ---------------- */

  /** Host only: once both fighters are picked, chooses the stage and seed and starts the match on both sides. */
  maybeStart() {
    if (this.role !== 'host') return;
    if (!this.picks[0] || !this.picks[1]) return;
    const stageRecord = pickStage(Sel.stageRec()),
      stageNetId = stageNet(stageRecord);
    const startMessage = {
      t: 'start',
      c: [this.picks[0].mugen.netId, this.picks[1].mugen.netId],
      stage: stageNetId,
      seed: (Math.random() * 4294967295) >>> 0
    };
    this.picks = [null, null];
    this.send(startMessage);
    this.beginMatch(startMessage);
  },

  /**
   * Starts a match from a 'start' message. If an asset is missing it requests it and retries shortly.
   * @param {{c: string[], stage: string, seed: number}} startMessage Fighter ids, stage id and RNG seed.
   */
  async beginMatch(startMessage) {
    const findCharacter = netId => CHARS.find(candidate => candidate.mugen.netId === netId);
    const stageRecord = findStage(startMessage.stage);
    // Guest: make sure every asset is present first.
    if (!findCharacter(startMessage.c[0]) || !findCharacter(startMessage.c[1]) || !stageRecord) {
      for (const netId of startMessage.c) if (!findCharacter(netId)) this.need('char', netId);
      if (!stageRecord) this.need('stage', startMessage.stage);
      this.pendingStart = startMessage;
      clearTimeout(this._wait);
      this._wait = setTimeout(() => this.beginMatch(startMessage), 400);
      return;
    }
    clearTimeout(this._wait);
    const seed = startMessage.seed !== undefined ? startMessage.seed : 1;
    this.seed = seed;
    this.reset();
    Match.net = this;
    // The first INPUT_DELAY ticks have no real input yet: both sides use neutral input for them.
    for (let frame = 0; frame < this.INPUT_DELAY; frame++) {
      this.inp[0][frame] = 0;
      this.inp[1][frame] = 0;
    }
    this.nextLocal = this.INPUT_DELAY;
    // The lockstep clock starts only when this side has finished loading, so a slow loader just makes the other side wait.
    Match.begin('online', findCharacter(startMessage.c[0]), findCharacter(startMessage.c[1]), stageRecord, 0, {
      net: this,
      seed,
      ready: () => {
        this.active = true;
        this.status('');
      }
    });
  },

  /**
   * Controller function for a slot: returns the input of the current tick.
   * @param {number} slot Player slot (0 or 1).
   * @returns {function(): object} Function returning the unpacked input map.
   */
  ctrl(slot) {
    return () => this.cur[slot] || {};
  },

  /* ---------------- lockstep ---------------- */

  /**
   * Tries to advance one simulation tick. Our input for tick t + INPUT_DELAY is sent now; the tick
   * runs only when both players' inputs for it are known, otherwise the simulation stalls.
   * @returns {boolean} True when the tick may be simulated, false when waiting for the peer.
   */
  step() {
    const tick = this.tick,
      mySlot = this.slot;
    // Sample and send local inputs up to INPUT_DELAY ticks ahead.
    while (this.nextLocal <= tick + this.INPUT_DELAY) {
      const packed = packInput(sample('p1'));
      this.inp[mySlot][this.nextLocal] = packed;
      this.send({ t: 'in', s: this.seed, f: this.nextLocal, i: packed });
      this.nextLocal++;
    }
    // Missing remote input: stall instead of guessing, so both machines stay identical.
    if (this.inp[0][tick] === undefined || this.inp[1][tick] === undefined) {
      this.stalled++;
      this.showStall(true);
      return false;
    }
    this.showStall(false);
    this.cur = [unpackInput(this.inp[0][tick]), unpackInput(this.inp[1][tick])];
    delete this.inp[0][tick];
    delete this.inp[1][tick];
    this.tick++;
    return true;
  },

  /** Called after each simulated tick: once per second (60 ticks) sends a state hash for the desync check. */
  afterTick() {
    const tick = this.tick;
    if (tick % 60 !== 0) return;
    const hash = G.stateHash();
    this.hashes[0][tick] = hash;
    this.send({ t: 'h', f: tick, h: hash });
    this.compare(tick);
  },

  /**
   * Compares our and the peer's state hash for a tick (once both are known) and flags a desync on mismatch.
   * @param {number} tick Tick the hashes belong to.
   */
  compare(tick) {
    const ownHash = this.hashes[0][tick],
      peerHash = this.hashes[1][tick];
    if (ownHash === undefined || peerHash === undefined) return;
    delete this.hashes[0][tick];
    delete this.hashes[1][tick];
    if (ownHash !== peerHash && !this.desync) {
      this.desync = true;
      this.status('The two games have drifted apart (desync).', true);
      const tip = $('#tip');
      if (tip) {
        tip.hidden = false;
        tip.textContent = 'DESYNC DETECTED - leave and rematch';
      }
    }
  },

  /**
   * Shows or hides the "waiting for opponent" indicator (only after 20 stalled ticks in a row).
   * @param {boolean} isStalled True while the simulation is waiting.
   */
  showStall(isStalled) {
    const element = $('#stall');
    if (element) element.hidden = !(isStalled && this.stalled > 20);
    if (!isStalled) this.stalled = 0;
  },

  /** Votes for a rematch and tells the peer. */
  rematch() {
    this.rematchVotes[this.slot] = true;
    this.send({ t: 'rematch' });
    $('#res-sub').textContent = 'Waiting for your opponent…';
    this.maybeRematch();
  },

  /** Host only: when both players voted, starts the same match again with a new seed. */
  maybeRematch() {
    if (!(this.rematchVotes[0] && this.rematchVotes[1]) || this.role !== 'host') return;
    const seed = (Math.random() * 4294967295) >>> 0,
      startMessage = {
        t: 'start',
        c: Match.c.map(fighter => fighter.mugen.netId),
        stage: stageNet(Match.stageRec),
        seed
      };
    this.send(startMessage);
    this.beginMatch(startMessage);
  }
};

/**
 * Shows a short toast notification for 4 seconds.
 * @param {string} message Text to show.
 */
function alert_(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('on');
  clearTimeout(alert_.t);
  alert_.t = setTimeout(() => toast.classList.remove('on'), 4000);
}
