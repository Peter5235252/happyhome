/**
 * Tactile & Satisfying Web Audio Synthesizer
 * Generates physical, haptic-like clicks, soft toggles, slider ticks, and harmonic chimes
 * with zero external dependencies.
 */
class SoundSynthesizer {
  private ctx: AudioContext | null = null;
  public enabled: boolean = true;
  private lastTickTime: number = 0;
  private lastSliderCallTime: number = 0;
  private lastSliderVal: number | null = null;
  private smoothedVelocity: number = 0;

  private initContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playDeepHapticTap(volMult: number = 1.0): void {
    const ctx = this.initContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      // Very deep, thick tactile thump
      osc.frequency.setValueAtTime(450, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.025);

      gain.gain.setValueAtTime(0.45 * volMult, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.04);
    } catch {
      // Ignore audio glitches
    }
  }

  /**
   * Tactile button tap sound
   */
  public playTap(): void {
    this.playDeepHapticTap(1.0);
  }

  /**
   * Toggle switch sound
   */
  public playToggle(isOn: boolean): void {
    this.playDeepHapticTap(1.0);
  }

  /**
   * Preset chime (now mapped to tactile tap)
   */
  public playPresetChime(): void {
    this.playDeepHapticTap(1.2);
  }

  /**
   * Satisfying tactile slider drag sound effect
   * Base pitch is deep and woody (~280Hz - 340Hz).
   * As the user drags faster, the pitch smoothly and proportionally rises up to ~550Hz,
   * never jumping instantly to high frequencies.
   */
  public playSliderTick(currentVal?: number): void {
    const ctx = this.initContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const callDt = Math.max(0.005, now - this.lastSliderCallTime);
      this.lastSliderCallTime = now;

      // Calculate instantaneous drag velocity
      let instantVelocity = 0;
      if (currentVal !== undefined && this.lastSliderVal !== null) {
        const delta = Math.abs(currentVal - this.lastSliderVal);
        instantVelocity = Math.min(1.0, delta / (callDt * 10));
        this.lastSliderVal = currentVal;
      } else {
        // Fallback velocity estimation from event frequency
        // Normal drags arrive around 16ms - 35ms apart
        instantVelocity = Math.min(1.0, Math.max(0, (0.07 - callDt) / 0.06));
        if (currentVal !== undefined) {
          this.lastSliderVal = currentVal;
        }
      }

      // Smooth velocity with exponential moving average to prevent sudden jumps
      this.smoothedVelocity = this.smoothedVelocity * 0.65 + instantVelocity * 0.35;

      // Dynamic rate limit: allows faster ticks during brisk drags (32ms - 55ms)
      const minInterval = Math.max(0.030, 0.055 - this.smoothedVelocity * 0.020);
      if (now - this.lastTickTime < minInterval) return;
      this.lastTickTime = now;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // Deep, tactile frequency range: 280Hz base up to ~520Hz under vigorous dragging
      const baseFreq = 280 + (this.smoothedVelocity * 240);
      const endFreq = 35 + (this.smoothedVelocity * 25);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.018);

      // Warm, tactile volume curve
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.025);
    } catch {
      // Ignore
    }
  }
}

export const sound = new SoundSynthesizer();
