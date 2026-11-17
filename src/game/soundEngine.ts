/**
 * QQ飞车程序化音效引擎：
 * 连续追踪转速换挡声浪、漂移轮胎啸叫、小喷/氮气/CWW 涡轮爆破音、撞墙金属声、
 * 氮气集满提示音及起跑倒计时音效。
 */
export class RacingAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  private screechFilter: BiquadFilterNode | null = null;
  private screechGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.7;

  public unlock(): void {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);

      // Noise buffer
      const sr = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, sr * 2, sr);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;

      // Continuous Dual-Oscillator Engine Synth
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 380;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0;

      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 65;

      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'triangle';
      this.engineOsc2.frequency.value = 130;

      this.engineOsc.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.engineOsc.start();
      this.engineOsc2.start();

      // Continuous Drift Screech Noise Loop
      const screechSrc = this.ctx.createBufferSource();
      screechSrc.buffer = buf;
      screechSrc.loop = true;

      this.screechFilter = this.ctx.createBiquadFilter();
      this.screechFilter.type = 'bandpass';
      this.screechFilter.frequency.value = 1950;
      this.screechFilter.Q.value = 4.2;

      this.screechGain = this.ctx.createGain();
      this.screechGain.gain.value = 0;

      screechSrc.connect(this.screechFilter);
      this.screechFilter.connect(this.screechGain);
      this.screechGain.connect(this.masterGain);
      screechSrc.start();
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    }
  }

  public updateContinuous(
    active: boolean,
    speedKmh: number,
    isDrifting: boolean,
    isGrounded: boolean,
    boostTier: 0 | 1 | 2 | 3
  ): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;

    if (!active) {
      this.engineGain?.gain.setTargetAtTime(0, t, 0.06);
      this.screechGain?.gain.setTargetAtTime(0, t, 0.05);
      return;
    }

    // Simulated 5-speed transmission sawtooth RPM curve
    const speedNorm = Math.min(1, speedKmh / 315);
    const gearMod = (speedKmh % 68) / 68;
    const rpmFreq = 58 + speedNorm * 115 + gearMod * 42 + boostTier * 22;

    this.engineOsc?.frequency.setTargetAtTime(rpmFreq, t, 0.04);
    this.engineOsc2?.frequency.setTargetAtTime(rpmFreq * 1.98, t, 0.04);
    this.engineFilter?.frequency.setTargetAtTime(340 + speedNorm * 950 + boostTier * 360, t, 0.05);
    this.engineGain?.gain.setTargetAtTime(0.08 + speedNorm * 0.07, t, 0.05);

    const screechVol = isDrifting && isGrounded && speedKmh > 55 ? Math.min(0.16, (speedKmh / 220) * 0.14) : 0;
    this.screechGain?.gain.setTargetAtTime(screechVol, t, 0.04);
  }

  public playMiniBoost(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(760, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.36);

    this.playNoiseBurst(0.32, 1600, 0.22);
  }

  public playNitro(isCombo: boolean): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(isCombo ? 1120 : 840, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.68);

    this.playNoiseBurst(0.7, 900, 0.32);
  }

  public playNitroReady(): void {
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const freqs = [659.25, 987.77];
    freqs.forEach((f, idx) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t + idx * 0.06);
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.16, t + idx * 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.06 + 0.16);
      osc.connect(g);
      g.connect(this.masterGain!);
      osc.start(t + idx * 0.06);
      osc.stop(t + idx * 0.06 + 0.18);
    });
  }

  public playCountdown(go: boolean): void {
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(go ? 1046.5 : 523.25, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.24, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (go ? 0.38 : 0.18));
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  public playWallHit(): void {
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  public playFinish(): void {
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t + i * 0.09);
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.22, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.4);
      osc.connect(g);
      g.connect(this.masterGain!);
      osc.start(t + i * 0.09);
      osc.stop(t + i * 0.09 + 0.42);
    });
  }

  private playNoiseBurst(dur: number, freq: number, gainPeak: number): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 0.85;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainPeak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}
