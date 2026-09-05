const fs = require('fs');
let code = fs.readFileSync('src/audio/soundEffects.ts', 'utf8');

code = code.replace(
  'private lastTickTime: number = 0;',
  'private lastTickTime: number = 0;\n  private lastSliderCallTime: number = 0;'
);

const sliderRegex = /public playSliderTick\(\): void \{[\s\S]*?\}\n  \}/;

const newSlider = `public playSliderTick(): void {
    const ctx = this.initContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const callDt = now - this.lastSliderCallTime;
      this.lastSliderCallTime = now;
      
      // Rate limit to simulate distinct mechanical gear teeth
      if (now - this.lastTickTime < 0.035) return;
      this.lastTickTime = now;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // Faster drags emit DOM events closer together
      // callDt typically ranges from 0.008 to 0.1
      const speedFactor = Math.max(0, 0.05 - callDt) / 0.05; // 1.0 at 0ms, 0.0 at 50ms+
      const pitchMultiplier = 1.0 + (speedFactor * 1.8); // ranges 1.0x to 2.8x

      // Sharp, snappy mechanical tick
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000 * pitchMultiplier, now);
      osc.frequency.exponentialRampToValueAtTime(60 * pitchMultiplier, now + 0.015);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.02);
    } catch {
      // Ignore
    }
  }`;

code = code.replace(sliderRegex, newSlider);
fs.writeFileSync('src/audio/soundEffects.ts', code);
