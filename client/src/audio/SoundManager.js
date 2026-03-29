// Procedural sound effects using Web Audio API (no external files needed)
class SoundManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._initialized = false;
  }

  init() {
    if (this._initialized) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._initialized = true;
    } catch (e) {
      console.warn('Web Audio not supported');
    }
  }

  // Must call on user gesture to unlock audio on mobile
  unlock() {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setMuted(muted) {
    this.muted = muted;
  }

  // --- Sound Effects ---

  dash() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    // Swoosh: short noise burst with descending filter
    const dur = 0.15;
    const noise = this._createNoise(dur);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + dur);
    filter.Q.value = 2;
    const gain = this._createGain(0.3, dur);
    noise.connect(filter).connect(gain).connect(this.ctx.destination);
    noise.start(t);
    noise.stop(t + dur);
  }

  boneTaken() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    // Bright chime: two quick ascending tones
    this._playTone(880, 0.08, 0.25, t);
    this._playTone(1320, 0.1, 0.2, t + 0.08);
  }

  boneDropped() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    // Thud + descending tone
    const dur = 0.2;
    const noise = this._createNoise(dur);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    const gain = this._createGain(0.4, dur);
    noise.connect(filter).connect(gain).connect(this.ctx.destination);
    noise.start(t);
    noise.stop(t + dur);
    this._playTone(200, 0.15, 0.3, t, 'triangle');
  }

  win() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    // Victory arpeggio: C-E-G-C ascending
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      this._playTone(freq, 0.2, 0.25, t + i * 0.15, 'triangle');
    });
  }

  pickup() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    this._playTone(660, 0.06, 0.15, t);
  }

  collision() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    // Short impact: noise burst + low triangle
    const dur = 0.08;
    const noise = this._createNoise(dur);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const gain = this._createGain(0.2, dur);
    noise.connect(filter).connect(gain).connect(this.ctx.destination);
    noise.start(t);
    noise.stop(t + dur);
    this._playTone(150, 0.08, 0.15, t, 'triangle');
  }

  elimination() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    // Dramatic descending sawtooth
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.3);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  countdown() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    this._playTone(1000, 0.05, 0.15, t);
  }

  spawn() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    // Rising two-tone
    this._playTone(440, 0.08, 0.2, t, 'triangle');
    this._playTone(660, 0.1, 0.2, t + 0.07, 'triangle');
  }

  gameStart() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    // Short fanfare: C5-E5-G5
    this._playTone(523, 0.12, 0.2, t, 'triangle');
    this._playTone(659, 0.12, 0.2, t + 0.12, 'triangle');
    this._playTone(784, 0.2, 0.25, t + 0.24, 'triangle');
  }

  // --- Helpers ---

  _canPlay() {
    return this._initialized && this.ctx && !this.muted;
  }

  _playTone(freq, dur, vol = 0.2, startTime = 0, type = 'sine') {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + dur + 0.05);
  }

  _createNoise(dur) {
    const bufferSize = this.ctx.sampleRate * dur;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    return source;
  }

  _createGain(vol, dur) {
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    return gain;
  }
}

export default new SoundManager();
