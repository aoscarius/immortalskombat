/* =====================================================================
   Online play test.
   Two pages talk through a mock PeerJS bridged in Node. Checks lockstep
   start, fighter transfer over the channel, and that the state hashes of
   both sides stay identical (no desync).
   ===================================================================== */
const path = require('path'),
  { ROOT, REF, open, pass } = require('./lib');

/**
 * Init script run inside each page before the game: installs a fake `Peer`
 * class whose traffic is forwarded to the other page through window.__out
 * (and received through window.__in). Uint8Array payloads survive the
 * JSON bridge by being wrapped as { __u8: [...] }.
 */
const installMockPeer = () => {
  /** Makes a value JSON-safe by wrapping typed arrays. */
  const encodeValue = value =>
    value instanceof Uint8Array
      ? { __u8: Array.from(value) }
      : Array.isArray(value)
        ? value.map(encodeValue)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, encodeValue(inner)]))
          : value;
  /** Reverses encodeValue. */
  const decodeValue = value =>
    value && value.__u8
      ? new Uint8Array(value.__u8)
      : Array.isArray(value)
        ? value.map(decodeValue)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, decodeValue(inner)]))
          : value;
  /** Calls every handler registered on `emitter` for `eventName`. */
  const emit = (emitter, eventName, ...args) => (emitter._h[eventName] || []).forEach(handler => handler(...args));
  window.__peers = {};
  window.__conns = {};
  let connectionCounter = 0;

  /** One end of a fake data connection. */
  class Conn {
    /**
     * @param {object} peer the Peer that owns this end
     * @param {string} remote id of the remote peer
     * @param {string} id connection id shared by both ends
     */
    constructor(peer, remote, id) {
      this._h = {};
      this.peer = remote;
      this.open = false;
      this.id = id;
      this.owner = peer;
      window.__conns[id] = this;
    }
    /** Registers an event handler. */
    on(eventName, handler) {
      (this._h[eventName] = this._h[eventName] || []).push(handler);
    }
    /** Sends a message to the other page. */
    send(message) {
      window.__out({ k: 'data', id: this.id, m: encodeValue(message) });
    }
    /** Closes the connection on the other page too. */
    close() {
      window.__out({ k: 'close', id: this.id });
    }
  }

  /** Fake PeerJS Peer. */
  window.Peer = class {
    /** @param {string} [id] wanted peer id (random when omitted) */
    constructor(id) {
      this._h = {};
      this.id = id || 'g' + Math.random().toString(36).slice(2, 8);
      window.__peers[this.id] = this;
      setTimeout(() => emit(this, 'open', this.id), 20);
    }
    /** Registers an event handler. */
    on(eventName, handler) {
      (this._h[eventName] = this._h[eventName] || []).push(handler);
    }
    /** Nothing to release in the mock. */
    destroy() {}
    /**
     * Opens a connection to a remote peer.
     * @param {string} remoteId id of the peer to reach
     * @returns {Conn} the local end of the connection
     */
    connect(remoteId) {
      const connectionId = 'c' + ++connectionCounter + '-' + this.id;
      const connection = new Conn(this, remoteId, connectionId);
      window.__out({ k: 'connect', id: connectionId, to: remoteId, from: this.id });
      setTimeout(() => {
        connection.open = true;
        emit(connection, 'open');
      }, 30);
      return connection;
    }
  };

  /** Receives a message forwarded from the other page. */
  window.__in = message => {
    if (message.k === 'connect') {
      const peer = window.__peers[message.to];
      if (!peer) return;
      const connection = new Conn(peer, message.from, message.id);
      connection.open = true;
      emit(peer, 'connection', connection);
      setTimeout(() => emit(connection, 'open'), 10);
    } else if (message.k === 'data') {
      const connection = window.__conns[message.id];
      if (connection) emit(connection, 'data', decodeValue(message.m));
    } else if (message.k === 'close') {
      const connection = window.__conns[message.id];
      if (connection) emit(connection, 'close');
    }
  };
};

(async () => {
  const url = 'file://' + ROOT + '/dist/immortals-kombat.html';
  let hostPage, guestPage;
  /** Builds the function a page calls to hand a message to the other page. */
  const bridgeTo = getTargetPage => message =>
    getTargetPage()
      .evaluate(payload => window.__in(payload), message)
      .catch(() => {});
  hostPage = await open(url, { init: installMockPeer, expose: { __out: bridgeTo(() => guestPage) } });
  guestPage = await open(url, { init: installMockPeer, expose: { __out: bridgeTo(() => hostPage) } });
  /* the host has an extra fighter (Kaelith is bundled on both sides; the second is only on the host, so it must travel over the channel) */
  const hasExtraFighter = require('fs').existsSync(path.join(REF, 'chars/kfm'));
  let hostFighterName = 'Kaelith';
  if (hasExtraFighter) {
    await hostPage.evaluate(() => IK.toMenu());
    await hostPage.setInputFiles('#mg-dir', path.join(REF, 'chars/kfm'));
    await hostPage.waitForFunction(() => IK.CHARS.length === 2, null, { timeout: 15000 });
    hostFighterName = 'Kung Fu Man';
  }
  await hostPage.evaluate(() => {
    document.querySelector('[data-act=online]').click();
    document.querySelector('#net-host').click();
  });
  await hostPage.waitForFunction(
    () =>
      document.querySelector('#net-code').textContent.trim().length === 6 && !document.querySelector('#net-room').hidden
  );
  const roomCode = await hostPage.evaluate(() => document.querySelector('#net-code').textContent);
  await guestPage.evaluate(code => {
    document.querySelector('[data-act=online]').click();
    document.querySelector('#net-join-code').value = code;
    document.querySelector('#net-join').click();
  }, roomCode);
  await hostPage.waitForFunction(() => IK.Net.conn && UI.cur === 'select', null, { timeout: 10000 });
  await hostPage.evaluate(wantedName => {
    IK.Sel.c[0] = IK.CHARS.findIndex(ch => ch.name === wantedName);
    IK.Sel.confirm(0);
  }, hostFighterName);
  await guestPage.evaluate(() => {
    IK.Sel.c[0] = IK.CHARS.findIndex(ch => ch.name === 'Kaelith');
    IK.Sel.confirm(0);
  });
  for (const page of [hostPage, guestPage])
    await page.waitForFunction(() => (IK.Net.active && IK.G.phase === 'intro') || IK.G.phase === 'fight', null, {
      timeout: 30000
    });
  pass(
    'both sides start the match' + (hasExtraFighter ? ' (guest received the fighter over the channel)' : ''),
    (await guestPage.evaluate(() => IK.CHARS.map(ch => ch.name))).includes(hostFighterName)
  );
  await hostPage.waitForTimeout(3500);
  await hostPage.keyboard.down('KeyD');
  await guestPage.keyboard.down('KeyA');
  await hostPage.waitForTimeout(900);
  await hostPage.keyboard.press('KeyJ');
  await guestPage.keyboard.press('KeyJ');
  await hostPage.waitForTimeout(5000);
  await hostPage.keyboard.up('KeyD');
  await guestPage.keyboard.up('KeyA');
  /* hashes are compared by the game every 60 ticks; here: no desync flag, same seed, and the state at one tick is identical on both sides */
  const takeSnapshot = page =>
    page.evaluate(() => ({ tick: IK.Net.tick, desync: IK.Net.desync, seed: IK.Match.seed, hist: window.__h }));
  await Promise.all(
    [hostPage, guestPage].map(page =>
      page.evaluate(() => {
        window.__h = {};
        const originalUpdate = IK.G.update;
        IK.G.update = function () {
          originalUpdate.apply(this, arguments);
          if (IK.Net.tick % 30 === 0) __h[IK.Net.tick] = IK.G.stateHash();
        };
      })
    )
  );
  await hostPage.waitForTimeout(2500);
  const [hostSnapshot, guestSnapshot] = [await takeSnapshot(hostPage), await takeSnapshot(guestPage)],
    sharedTicks = Object.keys(hostSnapshot.hist).filter(tick => tick in guestSnapshot.hist);
  pass(
    'same seed and no desync flag',
    hostSnapshot.seed === guestSnapshot.seed && !hostSnapshot.desync && !guestSnapshot.desync,
    'ticks ' + hostSnapshot.tick + '/' + guestSnapshot.tick
  );
  pass(
    'state hashes match at every shared tick',
    sharedTicks.length > 3 && sharedTicks.every(tick => hostSnapshot.hist[tick] === guestSnapshot.hist[tick]),
    sharedTicks.length + ' shared ticks'
  );
  pass(
    'no page errors',
    hostPage.errs.length + guestPage.errs.length === 0,
    [...hostPage.errs, ...guestPage.errs].join('; ')
  );
  await hostPage.close2();
  await guestPage.close2();
})();
