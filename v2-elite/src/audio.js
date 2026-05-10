// Procedural spatial-ish audio. No external assets required.
// All sounds are synthesized with WebAudio.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.ambGain = null;
    this._ambientNodes = [];
    this._musicNodes = [];
    this._musicState = 'calm';
    this._listenerPos = { x: 0, y: 0, z: 0 };
    this._listenerFwd = { x: 0, y: 0, z: -1 };
    this._tension = 0; // 0..1
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    this.ambGain = this.ctx.createGain();
    this.ambGain.gain.value = 0.55;
    this.ambGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.connect(this.master);

    this._startAmbient();
    this._startMusic();
  }

  resume() { this.ctx?.resume(); }

  setListener(pos, fwd) {
    this._listenerPos.x = pos.x; this._listenerPos.y = pos.y; this._listenerPos.z = pos.z;
    this._listenerFwd.x = fwd.x; this._listenerFwd.y = fwd.y; this._listenerFwd.z = fwd.z;
  }

  // Compute volume & stereo pan from 3D position
  _spatial(pos, maxDist = 40) {
    const dx = pos.x - this._listenerPos.x;
    const dy = pos.y - this._listenerPos.y;
    const dz = pos.z - this._listenerPos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const vol = Math.max(0, 1 - d / maxDist);
    // Stereo pan using right-vector (cross of fwd and up=Y)
    const fx = this._listenerFwd.x, fz = this._listenerFwd.z;
    const rx = -fz, rz = fx; // right = fwd x up (Y)
    const rlen = Math.hypot(rx, rz) || 1;
    const pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / (rlen * Math.max(d, 0.0001))));
    return { vol: vol * vol, pan, d };
  }

  _playBuffer(makeBuf, { gain = 1, pos = null, pan = 0, maxDist = 40 } = {}) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = makeBuf();
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    let finalVol = gain;
    let finalPan = pan;
    if (pos) {
      const s = this._spatial(pos, maxDist);
      finalVol *= s.vol;
      finalPan = s.pan;
      if (s.vol <= 0.001) return;
    }
    g.gain.value = finalVol;
    src.connect(g);
    if (p) { g.connect(p); p.pan.value = finalPan; p.connect(this.sfxGain); }
    else { g.connect(this.sfxGain); }
    src.start();
  }

  // --- Buffer generators ---

  _gunshotBuf() {
    const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sr * 0.32);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      // crack: sharp white noise burst
      const env = Math.exp(-t * 18);
      const noise = (Math.random() * 2 - 1);
      // low body thump
      const body = Math.sin(2 * Math.PI * 80 * t) * Math.exp(-t * 9) * 0.7;
      d[i] = (noise * env + body) * 0.9;
    }
    return buf;
  }

  _emptyClickBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.08);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 60) * 0.6;
    }
    return b;
  }

  _reloadBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.9);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    // two clicks: mag out, mag in
    const clickAt = (start, dur, amp) => {
      const s = Math.floor(start * sr), e = Math.min(len, s + Math.floor(dur * sr));
      for (let i = s; i < e; i++) {
        const t = (i - s) / sr;
        d[i] += (Math.random() * 2 - 1) * Math.exp(-t * 45) * amp;
      }
    };
    clickAt(0.05, 0.08, 0.7);
    clickAt(0.55, 0.10, 0.9);
    clickAt(0.78, 0.05, 0.6);
    return b;
  }

  _swooshBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.35);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.sin(Math.PI * Math.min(1, t / 0.3)) * Math.exp(-t * 5);
      // bandpass noise
      d[i] = (Math.random() * 2 - 1) * env * 0.55;
    }
    // simple one-pole
    let prev = 0;
    for (let i = 0; i < len; i++) { prev = prev * 0.85 + d[i] * 0.15; d[i] = prev * 1.3; }
    return b;
  }

  _bowBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.45);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const twang = Math.sin(2 * Math.PI * (120 - 60 * t) * t) * Math.exp(-t * 9);
      const air = (Math.random() * 2 - 1) * Math.exp(-t * 5) * 0.3;
      d[i] = (twang * 0.6 + air) * 0.7;
    }
    return b;
  }

  _arrowHitBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.22);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] = ((Math.random() * 2 - 1) * Math.exp(-t * 35) + Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 22) * 0.6) * 0.7;
    }
    return b;
  }

  _hitFleshBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.18);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] = ((Math.random() * 2 - 1) * 0.6 + Math.sin(2 * Math.PI * 60 * t) * 0.5) * Math.exp(-t * 15);
    }
    return b;
  }

  _bonesBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.5);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const crack = (Math.random() * 2 - 1) * Math.exp(-t * 12);
      const tone = Math.sin(2 * Math.PI * (160 + Math.random() * 40) * t) * Math.exp(-t * 6) * 0.3;
      d[i] = (crack + tone) * 0.7;
    }
    return b;
  }

  _skeletonGroanBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 1.5);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const f = 70 + Math.sin(t * 6) * 8;
      const env = Math.sin(Math.PI * Math.min(1, t / 1.3));
      d[i] = (Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(2 * Math.PI * f * 1.5 * t) * 0.15) * env * 0.5;
      d[i] += (Math.random() * 2 - 1) * env * 0.06;
    }
    return b;
  }

  _dropBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.25);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] = (Math.sin(2 * Math.PI * (220 + 200 * Math.random()) * t) + (Math.random() * 2 - 1) * 0.5) * Math.exp(-t * 20) * 0.8;
    }
    return b;
  }

  _engineStartBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 2.5);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const chug = Math.sin(2 * Math.PI * (40 + 30 * Math.min(1, t / 2)) * t);
      const rumble = Math.sin(2 * Math.PI * 80 * t) * 0.4;
      const noise = (Math.random() * 2 - 1) * 0.2;
      const env = Math.min(1, t / 0.2) * Math.max(0, 1 - Math.max(0, t - 2) / 0.5);
      d[i] = (chug + rumble + noise) * 0.4 * env;
    }
    return b;
  }

  // --- High-level API ---
  gunshot(pos)      { this._playBuffer(() => this._gunshotBuf(), { pos, gain: 1.1, maxDist: 70 }); }
  emptyClick(pos)   { this._playBuffer(() => this._emptyClickBuf(), { pos, gain: 0.7, maxDist: 20 }); }
  reload(pos)       { this._playBuffer(() => this._reloadBuf(), { pos, gain: 0.9, maxDist: 15 }); }
  swoosh(pos)       { this._playBuffer(() => this._swooshBuf(), { pos, gain: 0.75, maxDist: 20 }); }
  bow(pos)          { this._playBuffer(() => this._bowBuf(), { pos, gain: 0.85, maxDist: 60 }); }
  arrowHit(pos)     { this._playBuffer(() => this._arrowHitBuf(), { pos, gain: 0.9, maxDist: 35 }); }
  hitFlesh(pos)     { this._playBuffer(() => this._hitFleshBuf(), { pos, gain: 0.95, maxDist: 25 }); }
  bones(pos)        { this._playBuffer(() => this._bonesBuf(), { pos, gain: 0.9, maxDist: 35 }); }
  groan(pos)        { this._playBuffer(() => this._skeletonGroanBuf(), { pos, gain: 0.8, maxDist: 30 }); }
  drop(pos)         { this._playBuffer(() => this._dropBuf(), { pos, gain: 0.9, maxDist: 40 }); }
  engine(pos)       { this._playBuffer(() => this._engineStartBuf(), { pos, gain: 1.0, maxDist: 80 }); }

  // Footstep variations
  step(pos, type = 'concrete') {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.12);
    const buf = this.ctx.createBuffer(1, len, sr); const d = buf.getChannelData(0);
    const baseFreq = type === 'metal' ? 450 : type === 'dirt' ? 120 : 220;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] = ((Math.random() * 2 - 1) * 0.6 + Math.sin(2 * Math.PI * baseFreq * t) * 0.2) * Math.exp(-t * 22);
    }
    this._playBuffer(() => buf, { pos, gain: 0.35, maxDist: 18 });
  }

  // --- Ambient ---
  _startAmbient() {
    const ctx = this.ctx;
    // Wind noise: pink-ish noise through lowpass + slow LFO
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nd.length; i++) {
      const w = (Math.random() * 2 - 1);
      last = last * 0.97 + w * 0.03;
      nd[i] = last * 4;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0.2;
    src.connect(filt); filt.connect(g); g.connect(this.ambGain);
    src.start();

    // Slow LFO for wind gusts
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.12;
    lfo.connect(lfoGain); lfoGain.connect(g.gain); lfo.start();

    // Metallic creaks: periodic random pings
    const scheduleCreak = () => {
      if (!this.ctx) return;
      const t = ctx.currentTime + 2 + Math.random() * 7;
      const osc = ctx.createOscillator(); osc.type = 'triangle';
      osc.frequency.setValueAtTime(180 + Math.random() * 220, t);
      osc.frequency.exponentialRampToValueAtTime(60 + Math.random() * 40, t + 1.2);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      osc.connect(og); og.connect(this.ambGain);
      osc.start(t); osc.stop(t + 1.3);
      setTimeout(scheduleCreak, 1500 + Math.random() * 6000);
    };
    scheduleCreak();

    // Distant drip
    const scheduleDrip = () => {
      if (!this.ctx) return;
      const t = ctx.currentTime + 3 + Math.random() * 6;
      const osc = ctx.createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(900 + Math.random() * 300, t);
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.15);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(og); og.connect(this.ambGain);
      osc.start(t); osc.stop(t + 0.35);
      setTimeout(scheduleDrip, 1800 + Math.random() * 5000);
    };
    scheduleDrip();
  }

  // --- Adaptive music ---
  _startMusic() {
    const ctx = this.ctx;
    // Deep drone pad (two oscillators)
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55 * 1.005;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    const g = ctx.createGain(); g.gain.value = 0.0;
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.musicGain);
    o1.start(); o2.start();
    this._musicNodes.push({ o1, o2, lp, g });

    // Tension layer: high detuned sine cluster
    const t1 = ctx.createOscillator(); t1.type = 'sine'; t1.frequency.value = 330;
    const t2 = ctx.createOscillator(); t2.type = 'sine'; t2.frequency.value = 495;
    const tg = ctx.createGain(); tg.gain.value = 0.0;
    t1.connect(tg); t2.connect(tg); tg.connect(this.musicGain);
    t1.start(); t2.start();
    this._musicNodes.push({ t1, t2, g: tg });

    // Percussive pulse (combat)
    const p = ctx.createOscillator(); p.type = 'sine'; p.frequency.value = 44;
    const pg = ctx.createGain(); pg.gain.value = 0.0;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 2.0;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.35;
    lfo.connect(lfoG); lfoG.connect(pg.gain);
    p.connect(pg); pg.connect(this.musicGain);
    p.start(); lfo.start();
    this._musicNodes.push({ p, pg, lfo });

    // Start gently fading in the drone
    this.musicGain.gain.setTargetAtTime(0.35, ctx.currentTime + 1, 4);
  }

  setTension(t) {
    // t: 0..1, blends layers smoothly
    if (!this.ctx) return;
    this._tension = t;
    const now = this.ctx.currentTime;
    const [drone, tension, pulse] = this._musicNodes;
    drone.g.gain.setTargetAtTime(0.25 + 0.15 * (1 - t), now, 1.2);
    tension.g.gain.setTargetAtTime(0.0 + 0.08 * Math.max(0, t - 0.2), now, 1.0);
    pulse.pg.gain.setTargetAtTime(0.0 + 0.18 * Math.max(0, t - 0.55), now, 0.6);
    // faster pulse when combat more intense
    pulse.lfo.frequency.setTargetAtTime(1.6 + 2.8 * t, now, 0.8);
  }
}
