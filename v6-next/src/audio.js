// Procedural WebAudio engine. No external sound assets required.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.ambGain = null;
    this.musicGain = null;
    this._musicNodes = [];
    this._listenerPos = { x: 0, y: 0, z: 0 };
    this._listenerFwd = { x: 0, y: 0, z: -1 };
    this._tension = 0;
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.95; this.sfxGain.connect(this.master);
    this.ambGain = this.ctx.createGain(); this.ambGain.gain.value = 0.5; this.ambGain.connect(this.master);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.0; this.musicGain.connect(this.master);
    this._startAmbient();
    this._startMusic();
  }
  resume() { this.ctx?.resume(); }

  setListener(pos, fwd) {
    this._listenerPos.x = pos.x; this._listenerPos.y = pos.y; this._listenerPos.z = pos.z;
    this._listenerFwd.x = fwd.x; this._listenerFwd.y = fwd.y; this._listenerFwd.z = fwd.z;
  }

  _spatial(pos, maxDist = 40) {
    const dx = pos.x - this._listenerPos.x;
    const dy = pos.y - this._listenerPos.y;
    const dz = pos.z - this._listenerPos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const vol = Math.max(0, 1 - d / maxDist);
    const fx = this._listenerFwd.x, fz = this._listenerFwd.z;
    const rx = -fz, rz = fx;
    const rlen = Math.hypot(rx, rz) || 1;
    const pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / (rlen * Math.max(d, 0.0001))));
    return { vol: vol * vol, pan, d };
  }

  _play(makeBuf, { gain = 1, pos = null, maxDist = 40 } = {}) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = makeBuf();
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    let v = gain, pan = 0;
    if (pos) {
      const s = this._spatial(pos, maxDist);
      if (s.vol <= 0.001) return;
      v *= s.vol; pan = s.pan;
    }
    g.gain.value = v;
    src.connect(g);
    if (p) { g.connect(p); p.pan.value = pan; p.connect(this.sfxGain); }
    else { g.connect(this.sfxGain); }
    src.start();
  }

  // --- Buffers ---
  _gunshotBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.38);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 16);
      const noise = (Math.random() * 2 - 1);
      const body = Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 7) * 0.85;
      const crack = Math.sin(2 * Math.PI * 1600 * t) * Math.exp(-t * 40) * 0.4;
      d[i] = (noise * env + body + crack) * 0.95;
    }
    return b;
  }
  _bowBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.55);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const twang = Math.sin(2 * Math.PI * (140 - 85 * t) * t) * Math.exp(-t * 7);
      const air = (Math.random() * 2 - 1) * Math.exp(-t * 4) * 0.3;
      d[i] = (twang * 0.7 + air) * 0.75;
    }
    return b;
  }
  _drawBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.8);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const creak = Math.sin(2 * Math.PI * (40 + 15 * t) * t) * Math.exp(-Math.abs(t - 0.4) * 3) * 0.3;
      const tension = (Math.random() * 2 - 1) * Math.exp(-Math.abs(t - 0.35) * 4) * 0.15;
      d[i] = (creak + tension) * 0.8;
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
  _emptyBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.08);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) { const t = i / sr; d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 60) * 0.6; }
    return b;
  }
  _reloadBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 1.1);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    const clickAt = (start, dur, amp) => {
      const s = Math.floor(start * sr), e = Math.min(len, s + Math.floor(dur * sr));
      for (let i = s; i < e; i++) { const t = (i - s) / sr; d[i] += (Math.random() * 2 - 1) * Math.exp(-t * 40) * amp; }
    };
    clickAt(0.05, 0.08, 0.7);
    clickAt(0.55, 0.10, 0.85);
    clickAt(0.88, 0.05, 0.55);
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
  _fleshBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.2);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] = ((Math.random() * 2 - 1) * 0.6 + Math.sin(2 * Math.PI * 60 * t) * 0.5) * Math.exp(-t * 14);
    }
    return b;
  }
  _engineBuf() {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 2.7);
    const b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const chug = Math.sin(2 * Math.PI * (40 + 30 * Math.min(1, t / 2)) * t);
      const rumble = Math.sin(2 * Math.PI * 80 * t) * 0.4;
      const noise = (Math.random() * 2 - 1) * 0.2;
      const env = Math.min(1, t / 0.2) * Math.max(0, 1 - Math.max(0, t - 2.2) / 0.4);
      d[i] = (chug + rumble + noise) * 0.4 * env;
    }
    return b;
  }

  gunshot(pos)    { this._play(() => this._gunshotBuf(), { pos, gain: 1.1, maxDist: 80 }); }
  bow(pos)        { this._play(() => this._bowBuf(), { pos, gain: 0.95, maxDist: 65 }); }
  bowDraw(pos)    { this._play(() => this._drawBuf(), { pos, gain: 0.55, maxDist: 20 }); }
  arrowHit(pos)   { this._play(() => this._arrowHitBuf(), { pos, gain: 0.9, maxDist: 40 }); }
  emptyClick(pos) { this._play(() => this._emptyBuf(), { pos, gain: 0.7, maxDist: 20 }); }
  reload(pos)     { this._play(() => this._reloadBuf(), { pos, gain: 0.9, maxDist: 15 }); }
  bones(pos)      { this._play(() => this._bonesBuf(), { pos, gain: 0.95, maxDist: 40 }); }
  hitFlesh(pos)   { this._play(() => this._fleshBuf(), { pos, gain: 0.95, maxDist: 25 }); }
  engine(pos)     { this._play(() => this._engineBuf(), { pos, gain: 1.1, maxDist: 100 }); }

  step(pos, type = 'concrete') {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate, len = Math.floor(sr * 0.12);
    const buf = this.ctx.createBuffer(1, len, sr); const d = buf.getChannelData(0);
    const base = type === 'metal' ? 450 : type === 'dirt' ? 110 : type === 'grass' ? 90 : 220;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      d[i] = ((Math.random() * 2 - 1) * 0.6 + Math.sin(2 * Math.PI * base * t) * 0.2) * Math.exp(-t * 22);
    }
    this._play(() => buf, { pos, gain: 0.4, maxDist: 20 });
  }

  // Birdsong for sunny daytime ambience.
  _scheduleBirds() {
    const ctx = this.ctx;
    const schedule = () => {
      if (!this.ctx) return;
      const t = ctx.currentTime + 3 + Math.random() * 8;
      const osc = ctx.createOscillator(); osc.type = 'sine';
      const f0 = 1200 + Math.random() * 800;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * 1.6, t + 0.07);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + 0.15);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(og); og.connect(this.ambGain);
      osc.start(t); osc.stop(t + 0.22);
      setTimeout(schedule, 2500 + Math.random() * 9000);
    };
    schedule();
  }

  _startAmbient() {
    const ctx = this.ctx;
    // Pink wind.
    const nbuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const nd = nbuf.getChannelData(0); let last = 0;
    for (let i = 0; i < nd.length; i++) {
      const w = (Math.random() * 2 - 1);
      last = last * 0.97 + w * 0.03;
      nd[i] = last * 4;
    }
    const src = ctx.createBufferSource(); src.buffer = nbuf; src.loop = true;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 480;
    const g = ctx.createGain(); g.gain.value = 0.18;
    src.connect(filt); filt.connect(g); g.connect(this.ambGain);
    src.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.1;
    lfo.connect(lfoGain); lfoGain.connect(g.gain); lfo.start();
    this._scheduleBirds();
  }

  _startMusic() {
    const ctx = this.ctx;
    // Drone layer.
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55 * 1.005;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    const g = ctx.createGain(); g.gain.value = 0.0;
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.musicGain);
    o1.start(); o2.start();
    this._musicNodes.push({ g });
    // Tension layer.
    const t1 = ctx.createOscillator(); t1.type = 'sine'; t1.frequency.value = 330;
    const t2 = ctx.createOscillator(); t2.type = 'sine'; t2.frequency.value = 495;
    const tg = ctx.createGain(); tg.gain.value = 0.0;
    t1.connect(tg); t2.connect(tg); tg.connect(this.musicGain);
    t1.start(); t2.start();
    this._musicNodes.push({ g: tg });
    // Percussive combat pulse.
    const p = ctx.createOscillator(); p.type = 'sine'; p.frequency.value = 44;
    const pg = ctx.createGain(); pg.gain.value = 0.0;
    const plfo = ctx.createOscillator(); plfo.type = 'square'; plfo.frequency.value = 2.0;
    const plg = ctx.createGain(); plg.gain.value = 0.35;
    plfo.connect(plg); plg.connect(pg.gain);
    p.connect(pg); pg.connect(this.musicGain);
    p.start(); plfo.start();
    this._musicNodes.push({ g: pg, lfo: plfo });
    this.musicGain.gain.setTargetAtTime(0.35, ctx.currentTime + 1, 4);
  }

  setTension(t) {
    if (!this.ctx) return;
    this._tension = t;
    const now = this.ctx.currentTime;
    const [drone, tension, pulse] = this._musicNodes;
    drone.g.gain.setTargetAtTime(0.22 + 0.12 * (1 - t), now, 1.2);
    tension.g.gain.setTargetAtTime(0.0 + 0.1 * Math.max(0, t - 0.2), now, 1.0);
    pulse.g.gain.setTargetAtTime(0.0 + 0.2 * Math.max(0, t - 0.5), now, 0.6);
    pulse.lfo?.frequency.setTargetAtTime(1.6 + 3.0 * t, now, 0.8);
  }
}
