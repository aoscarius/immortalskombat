/* =====================================================================
   Audio: a small synthesiser for menus, announcer and fall-back effects,
   plus playback of sounds that come out of MUGEN .snd files and stage music.
   All sound goes through one AudioContext: oscillators and noise feed the
   `sfx` bus, stage music feeds the `mus` bus, and both end in `master`.
   ===================================================================== */

/** Global audio engine (Web Audio synth, sample playback and music). */
const Snd = {
  ctx: null,
  on: true,
  step: 0,
  timer: 0,
  musicOn: false,
  stageMusic: null,
  channels: new Map(),

  /** Creates the audio graph on first use (needs a user gesture) or resumes a suspended context. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 1;
      this.sfx.connect(this.master);
      this.mus = this.ctx.createGain();
      this.mus.gain.value = 1;
      this.mus.connect(this.master);
      // One second of white noise, reused by every noise effect.
      const sampleCount = this.ctx.sampleRate,
        noiseBuffer = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate),
        channelData = noiseBuffer.getChannelData(0);
      for (let index = 0; index < sampleCount; index++) channelData[index] = Math.random() * 2 - 1;
      this.nbuf = noiseBuffer;
    } catch (error) {
      this.ctx = null;
    }
  },

  /**
   * Plays a synthesised tone with a fast decay.
   * @param {number} frequency Start frequency in Hz.
   * @param {number} duration Length in seconds.
   * @param {OscillatorType} [waveType] Oscillator waveform.
   * @param {number} [volume] Start gain.
   * @param {number} [slide] Hz added to the frequency by the end (exponential glide).
   * @param {number} [delay] Seconds from now until the tone starts.
   */
  tone(frequency, duration, waveType = 'square', volume = 0.2, slide = 0, delay = 0) {
    if (!this.ctx || !this.on) return;
    const startTime = this.ctx.currentTime + delay,
      oscillator = this.ctx.createOscillator(),
      gainNode = this.ctx.createGain();
    oscillator.type = waveType;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency + slide), startTime + duration);
    gainNode.gain.setValueAtTime(volume, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    oscillator.connect(gainNode);
    gainNode.connect(this.sfx);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.03);
  },

  /**
   * Plays a burst of band-passed noise.
   * @param {number} duration Length in seconds.
   * @param {number} [volume] Start gain.
   * @param {number} [frequency] Filter centre frequency in Hz.
   * @param {number} [resonance] Filter Q.
   * @param {number} [delay] Seconds from now until the burst starts.
   * @param {number} [sweep] Hz added to the filter frequency by the end.
   */
  noise(duration, volume = 0.3, frequency = 1200, resonance = 0.8, delay = 0, sweep = 0) {
    if (!this.ctx || !this.on) return;
    const startTime = this.ctx.currentTime + delay,
      source = this.ctx.createBufferSource(),
      filter = this.ctx.createBiquadFilter(),
      gainNode = this.ctx.createGain();
    source.buffer = this.nbuf;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(frequency, startTime);
    filter.Q.value = resonance;
    if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(60, frequency + sweep), startTime + duration);
    gainNode.gain.setValueAtTime(volume, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.sfx);
    source.start(startTime, Math.random() * 0.5);
    source.stop(startTime + duration + 0.03);
  },

  /** Hit impact effect. @param {number} [power] Strength; above 1.5 adds a deep thud. */
  hit(power = 1) {
    this.noise(0.14, 0.5, 700 + power * 100, 0.7);
    this.tone(150, 0.16, 'sine', 0.55, -90);
    if (power > 1.5) this.tone(70, 0.3, 'sine', 0.6, -30);
  },

  /** Blocked-hit effect. */
  block() {
    this.noise(0.08, 0.35, 2500, 2);
    this.tone(260, 0.08, 'triangle', 0.25, -80);
  },

  /** Swish of a moving limb. @param {number} [pitchScale] Multiplies the filter frequency. */
  whoosh(pitchScale = 1) {
    this.noise(0.18, 0.22, 600 * pitchScale, 1.2, 0, 1400);
  },

  /** Deep explosion. */
  boom() {
    this.tone(90, 0.6, 'sine', 0.7, -60);
    this.noise(0.5, 0.5, 300, 0.5);
  },

  /** Knock-out effect. */
  ko() {
    this.boom();
    this.tone(55, 1.2, 'sawtooth', 0.3, -20, 0.05);
  },

  /** Menu move blip. */
  ui() {
    this.tone(520, 0.06, 'square', 0.12, 200);
  },

  /** Menu confirm jingle. */
  ok() {
    this.tone(330, 0.08, 'square', 0.15);
    this.tone(660, 0.14, 'square', 0.15, 0, 0.07);
  },

  /**
   * Speaks a line with the browser speech synthesiser (announcer).
   * @param {string} text Text to speak.
   * @param {number} [pitch] Voice pitch.
   * @param {number} [rate] Speaking rate.
   */
  say(text, pitch = 0.5, rate = 0.8) {
    if (!this.on) return;
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.pitch = pitch;
      utterance.rate = rate;
      utterance.volume = 0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    } catch (error) {}
  },

  /**
   * Starts or stops the menu music: a tiny bass line, replaced by the stage's own track when it has one.
   * @param {boolean} on True to play, false to stop.
   */
  music(on) {
    this.musicOn = on;
    clearInterval(this.timer);
    if (!on || !this.ctx || this.stageMusic) return;
    const bassLine = [55, 55, 65.4, 55, 49, 49, 61.7, 73.4],
      leadLine = [220, 0, 261.6, 0, 329.6, 0, 293.7, 261.6];
    this.step = 0;
    let nextNoteTime = this.ctx.currentTime + 0.1;
    // Look-ahead scheduler: queue every note that falls in the next 0.3 s.
    this.timer = setInterval(() => {
      if (!this.ctx || !this.on) return;
      while (nextNoteTime < this.ctx.currentTime + 0.3) {
        const noteIndex = this.step % 8,
          delay = nextNoteTime - this.ctx.currentTime;
        this.tone(bassLine[noteIndex], 0.26, 'sawtooth', 0.09, 0, delay);
        if (noteIndex % 2 === 0) this.tone(70, 0.12, 'sine', 0.22, -40, delay);
        else if (noteIndex === 3 || noteIndex === 7) this.noise(0.08, 0.12, 5000, 1, delay);
        // The lead melody joins in the second half of every 32-step cycle.
        if (this.step % 32 >= 16 && leadLine[noteIndex])
          this.tone(leadLine[noteIndex], 0.2, 'triangle', 0.05, 0, delay);
        this.step++;
        nextNoteTime += 0.2;
      }
    }, 90);
  },

  /* ---- decoded sample playback (MUGEN .snd) ---- */

  /**
   * Decodes a sound entry to an AudioBuffer, cached on the entry; never throws.
   * @param {{data: Uint8Array, buf?: AudioBuffer, pending?: Promise, failed?: boolean}} entry Sound entry.
   * @returns {Promise<AudioBuffer|null>} The buffer, or null when decoding failed or audio is unavailable.
   */
  decode(entry) {
    if (entry.buf) return Promise.resolve(entry.buf);
    if (entry.failed || !this.ctx) return Promise.resolve(null);
    if (!entry.pending) {
      const bytes = entry.data;
      // Copy out exactly the entry's bytes: decodeAudioData takes ownership of the buffer.
      entry.pending = this.ctx
        .decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
        .then(
          audioBuffer => {
            entry.buf = audioBuffer;
            return audioBuffer;
          },
          () => {
            entry.failed = true;
            return null;
          }
        );
    }
    return entry.pending;
  },

  /**
   * Plays a MUGEN sound entry.
   * @param {object} entry Sound entry with `data` (and optionally a cached `buf`).
   * @param {{vol?: number, freq?: number, pan?: number, channel?: number, loop?: boolean, lowpriority?: boolean}} [options]
   *   vol 0..3 gain, freq playback-rate multiplier, pan -1..1, channel number (a new sound on the same
   *   channel stops the old one), loop, lowpriority (do not interrupt a sound still playing on the channel).
   */
  play(entry, options) {
    if (!this.ctx || !this.on || !entry || !entry.data) return;
    options = options || {};
    const startPlayback = audioBuffer => {
      if (!audioBuffer) return;
      try {
        if (options.channel !== undefined && options.channel >= 0) {
          const previous = this.channels.get(options.channel);
          if (previous) {
            if (options.lowpriority && previous.playing) return;
            try {
              previous.src.stop();
            } catch (error) {}
          }
        }
        const source = this.ctx.createBufferSource(),
          gainNode = this.ctx.createGain();
        source.buffer = audioBuffer;
        source.loop = !!options.loop;
        if (options.freq > 0) source.playbackRate.value = options.freq;
        gainNode.gain.value = clamp(options.vol === undefined ? 1 : options.vol, 0, 3) * 0.9;
        if (options.pan && this.ctx.createStereoPanner) {
          const panner = this.ctx.createStereoPanner();
          panner.pan.value = clamp(options.pan, -1, 1);
          source.connect(panner);
          panner.connect(gainNode);
        } else source.connect(gainNode);
        gainNode.connect(this.sfx);
        source.start();
        const record = { src: source, playing: true };
        source.onended = () => {
          record.playing = false;
        };
        if (options.channel !== undefined && options.channel >= 0) this.channels.set(options.channel, record);
        this.lastPlayed = (this.lastPlayed || 0) + 1;
      } catch (error) {}
    };
    if (entry.buf) startPlayback(entry.buf);
    else this.decode(entry).then(startPlayback);
  },

  /** Stops the sound playing on a channel, if any. @param {number} channel Channel number. */
  stopChannel(channel) {
    const record = this.channels.get(channel);
    if (record) {
      try {
        record.src.stop();
      } catch (error) {}
    }
  },

  /** Stops every channel and forgets them. */
  stopAll() {
    for (const record of this.channels.values()) {
      try {
        record.src.stop();
      } catch (error) {}
    }
    this.channels.clear();
  },

  /* ---- long-form music from a stage (mp3 / ogg / wav bytes) ---- */

  /**
   * Plays looping stage music, replacing any current track; falls back to the menu music on failure.
   * @param {Uint8Array} bytes Encoded audio file.
   * @param {number} [volume] Gain 0..1.5 (default 0.8).
   * @returns {Promise<void>}
   */
  async playStageMusic(bytes, volume) {
    this.stopStageMusic();
    if (!this.ctx || !bytes) return;
    try {
      const audioBuffer = await this.ctx.decodeAudioData(bytes.slice(0));
      const source = this.ctx.createBufferSource(),
        gainNode = this.ctx.createGain();
      source.buffer = audioBuffer;
      source.loop = true;
      gainNode.gain.value = clamp(volume === undefined ? 0.8 : volume, 0, 1.5);
      source.connect(gainNode);
      gainNode.connect(this.mus);
      source.start();
      this.stageMusic = { src: source, gain: gainNode };
      clearInterval(this.timer); // the menu music gives way to the stage track
    } catch (error) {
      this.stageMusic = null;
      if (this.musicOn) this.music(true);
    }
  },

  /** Stops the stage music track, if one is playing. */
  stopStageMusic() {
    if (this.stageMusic) {
      try {
        this.stageMusic.src.stop();
      } catch (error) {}
      this.stageMusic = null;
    }
  },

  /** Turns all sound on or off by muting the master gain. @param {boolean} enabled New state. */
  setOn(enabled) {
    this.on = enabled;
    if (this.master) this.master.gain.value = enabled ? 0.55 : 0;
  }
};
