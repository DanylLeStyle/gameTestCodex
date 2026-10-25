/** Small, asset-free soundscape. Audio is created only after a user gesture. */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.55;
    this.muted = false;
    this.disposed = false;
    this.seenEvents = new Set();
    this.roomCode = null;
    this.elapsed = 0;
    this.stepClock = 0;
    this.crowdClock = 0;
    this.birdClock = 7;
    this.ambientSources = [];
  }

  async unlock() {
    if (this.disposed) return false;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    try {
      if (!this.ctx) this._createContext(AudioContext);
      if (this.ctx.state !== "running") await this.ctx.resume();
      return this.ctx.state === "running";
    } catch {
      // A device or autoplay restriction should never stop the game.
      return false;
    }
  }

  _createContext(AudioContext) {
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -15;
    limiter.knee.value = 12;
    limiter.ratio.value = 5;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);
    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const samples = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

    // A quiet open-air bed: water in the square and a low breeze.
    this.fountainGain = ctx.createGain();
    this.fountainGain.gain.value = 0.009;
    this.fountainGain.connect(this.master);
    this._ambientNoise("lowpass", 1800, this.fountainGain);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.015;
    this.windGain.connect(this.master);
    this._ambientNoise("lowpass", 280, this.windGain);

    // A restrained musical bed, kept far below footsteps and action cues.
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padGain.connect(this.master);
    [130.8128, 196, 261.6256, 329.6276].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      osc.detune.value = i % 2 ? 3 : -3;
      gain.gain.value = i === 0 ? 0.8 : 0.36;
      osc.connect(gain);
      gain.connect(this.padGain);
      osc.start();
      this.ambientSources.push(osc);
    });
  }

  _ambientNoise(type, frequency, destination) {
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    filter.type = type;
    filter.frequency.value = frequency;
    source.connect(filter);
    filter.connect(destination);
    source.start();
    this.ambientSources.push(source);
  }

  setVolume(value) {
    if (!Number.isFinite(Number(value))) return;
    this.volume = Math.max(0, Math.min(1, Number(value)));
    this._applyVolume();
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this._applyVolume();
  }

  _applyVolume() {
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.06,
      );
    }
  }

  _output(position, listener, gain = 1) {
    const output = this.ctx.createGain();
    if (
      position &&
      listener &&
      Number.isFinite(position.x) &&
      Number.isFinite(listener.x)
    ) {
      const dx = position.x - listener.x;
      const dz = position.z - listener.z;
      const distance = Math.hypot(dx, dz);
      gain *= Math.max(0.05, 1 / (1 + distance * 0.12));
      if (this.ctx.createStereoPanner) {
        const pan = this.ctx.createStereoPanner();
        const yaw = listener.yaw || 0;
        pan.pan.value = Math.max(
          -0.85,
          Math.min(
            0.85,
            (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(4, distance),
          ),
        );
        output.gain.value = gain;
        output.connect(pan);
        pan.connect(this.master);
        return output;
      }
    }
    output.gain.value = gain;
    output.connect(this.master);
    return output;
  }

  _tone(frequency, duration, volume, destination, options = {}) {
    const ctx = this.ctx;
    const start = ctx.currentTime + (options.delay || 0);
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = options.wave || "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    if (options.end)
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, options.end),
        start + duration,
      );
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, volume),
      start + Math.min(0.02, duration * 0.15),
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }

  _noise(duration, volume, destination, options = {}) {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const start = ctx.currentTime + (options.delay || 0);
    source.buffer = this.noiseBuffer;
    filter.type = options.type || "bandpass";
    filter.frequency.setValueAtTime(options.frequency || 1000, start);
    filter.Q.value = options.q || 0.8;
    if (options.end)
      filter.frequency.exponentialRampToValueAtTime(
        options.end,
        start + duration,
      );
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(volume, 0.0002),
      start + 0.006,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(start, Math.random());
    source.stop(start + duration + 0.03);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  play(name, position, listener) {
    if (!this.ctx || this.ctx.state !== "running" || this.disposed) return;
    const out = this._output(position, listener);
    // Disconnect the short-lived mix bus after its final sound completes.
    const cleanup = this.ctx.createOscillator();
    const silence = this.ctx.createGain();
    silence.gain.value = 0;
    cleanup.connect(silence);
    silence.connect(out);
    cleanup.start();
    cleanup.stop(this.ctx.currentTime + 3);
    cleanup.onended = () => {
      cleanup.disconnect();
      silence.disconnect();
      out.disconnect();
    };
    switch (name) {
      case "click":
        this._tone(650, 0.055, 0.06, out, { end: 850 });
        this._noise(0.035, 0.022, out, { frequency: 2000 });
        break;
      case "confirm":
      case "start":
        [392, 523.25, 783.99].forEach((f, i) =>
          this._tone(f, 0.28, 0.1, out, { delay: i * 0.085 }),
        );
        break;
      case "pulse":
        this._tone(145, 0.7, 0.32, out, { end: 35 });
        this._noise(0.62, 0.3, out, {
          type: "lowpass",
          frequency: 3600,
          end: 160,
        });
        this._tone(740, 0.34, 0.08, out, { delay: 0.045, end: 240 });
        break;
      case "tag":
        this._noise(0.15, 0.13, out, { frequency: 2300, end: 600 });
        this._tone(230, 0.12, 0.13, out, { end: 70, wave: "triangle" });
        break;
      case "caught":
        this._noise(0.2, 0.14, out, { type: "lowpass", frequency: 1200 });
        [523.25, 659.25, 783.99].forEach((f, i) =>
          this._tone(f, 0.42, 0.1, out, { delay: i * 0.09 }),
        );
        break;
      case "mistake":
        this._tone(185, 0.36, 0.12, out, { wave: "triangle", end: 155 });
        this._tone(174, 0.38, 0.08, out, { delay: 0.08, end: 146 });
        break;
      case "decoy":
        this._tone(470, 0.3, 0.11, out, { end: 300 });
        this._noise(0.15, 0.05, out, { frequency: 3200 });
        this._tone(590, 0.23, 0.07, out, { delay: 0.18, end: 410 });
        break;
      case "step":
        this._noise(0.07, 0.075 + Math.random() * 0.025, out, {
          frequency: 650 + Math.random() * 600,
          q: 0.5,
        });
        this._tone(85 + Math.random() * 25, 0.09, 0.045, out, { end: 45 });
        break;
      case "crowd-step":
        this._noise(0.08, 0.055, out, { frequency: 950, q: 0.5 });
        break;
      case "bird":
        [0, 0.15, 0.36].forEach((delay, i) =>
          this._tone(2600 + i * 240, 0.11, 0.022, out, {
            delay,
            end: 3400 + i * 170,
          }),
        );
        break;
      case "loss":
        [329.63, 293.66, 220].forEach((f, i) =>
          this._tone(f, 0.65, 0.09, out, { delay: i * 0.19 }),
        );
        break;
      case "win":
      case "end":
        [392, 493.88, 587.33, 783.99].forEach((f, i) =>
          this._tone(f, 0.75, 0.1, out, { delay: i * 0.14 }),
        );
        break;
      default:
        break;
    }
  }

  update(room, me, dt = 0, moving = false) {
    if (!room) return;
    dt = Math.max(0, Math.min(0.1, Number(dt) || 0));
    if (room.code !== this.roomCode) {
      this.roomCode = room.code;
      this.seenEvents.clear();
    }
    const enabled = this.ctx && this.ctx.state === "running" && !this.disposed;
    for (const event of room.events || []) {
      const key = event.id ?? `${event.type}:${event.at}:${event.x}:${event.z}`;
      if (this.seenEvents.has(key)) continue;
      this.seenEvents.add(key);
      if (!enabled || (event.at && Date.now() - event.at > 7000)) continue;
      const name =
        event.type === "end" && event.winner && me
          ? event.winner === me.role
            ? "win"
            : "loss"
          : event.type;
      this.play(name, Number.isFinite(event.x) ? event : undefined, me);
    }
    if (this.seenEvents.size > 600)
      this.seenEvents = new Set([...this.seenEvents].slice(-300));
    if (!enabled) return;
    const now = this.ctx.currentTime;
    this.elapsed += dt;
    this.padGain.gain.setTargetAtTime(
      room.phase === "playing" ? 0.012 : 0.024,
      now,
      2,
    );
    const fountainDistance = me ? Math.hypot(me.x, me.z) : 16;
    this.fountainGain.gain.setTargetAtTime(
      0.008 + 0.065 / (1 + fountainDistance * 0.3),
      now,
      0.5,
    );
    this.windGain.gain.setTargetAtTime(
      0.012 + Math.sin(this.elapsed * 0.15) * 0.003,
      now,
      1,
    );
    this.stepClock -= dt;
    this.crowdClock -= dt;
    this.birdClock -= dt;
    if (moving && me?.alive !== false && room.phase === "playing") {
      if (this.stepClock <= 0) {
        this.play("step");
        this.stepClock =
          me.state === "panic" || me.state === "sprint" ? 0.27 : 0.44;
      }
    } else this.stepClock = 0.1;
    if (me && this.crowdClock <= 0) {
      const near = (room.npcs || []).filter(
        (n) =>
          n.alive !== false &&
          n.state !== "idle" &&
          n.state !== "interact" &&
          Math.hypot(n.x - me.x, n.z - me.z) < 9,
      );
      if (near.length)
        this.play(
          "crowd-step",
          near[Math.floor(Math.random() * near.length)],
          me,
        );
      this.crowdClock = 0.48 + Math.random() * 0.6;
    }
    if (this.birdClock <= 0) {
      this.play("bird", { x: 14, z: -17 }, me);
      this.birdClock = 9 + Math.random() * 14;
    }
  }

  dispose() {
    this.disposed = true;
    for (const source of this.ambientSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.ambientSources.length = 0;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.seenEvents.clear();
  }
}
