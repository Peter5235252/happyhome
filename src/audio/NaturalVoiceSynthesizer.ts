/**
 * NaturalVoiceSynthesizer
 * Hyperrealistic, natural speech synthesis engine with neural voice selection,
 * human prosody pacing, and instant interruption support.
 */

export interface VoiceSynthesizerOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
}

export class NaturalVoiceSynthesizer {
  private synth: SpeechSynthesis | null = null;
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private voicesLoaded: boolean = false;
  private isSpeaking: boolean = false;
  private currentUtterances: SpeechSynthesisUtterance[] = [];

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
      this.initVoices();
    }
  }

  private initVoices() {
    if (!this.synth) return;

    const load = () => {
      const voices = this.synth?.getVoices() || [];
      if (voices.length > 0) {
        this.voicesLoaded = true;
        this.selectedVoice = this.findBestNaturalVoice(voices);
      }
    };

    load();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = load;
    }
  }

  /**
   * Prioritize hyperrealistic neural/natural voices across Windows, macOS, ChromeOS, iOS, and Android
   */
  private findBestNaturalVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const englishVoices = voices.filter(v => v.lang.startsWith('en'));
    if (englishVoices.length === 0) return voices[0] || null;

    // Top tier priority list: Premium Natural / Neural voices
    const priorityKeywords = [
      'Natural',             // Microsoft Edge Natural (Jenny, Guy, Christopher, Aria)
      'Google US English',   // Google Cloud / Chrome Neural US
      'Google UK English Female',
      'Google UK English Male',
      'Premium',             // Apple Premium Voices (Ava, Zoe, etc.)
      'Enhanced',            // Apple Enhanced (Samantha, Daniel, Karen, Serena)
      'Samantha',
      'Karen',
      'Daniel',
      'Serena',
      'Moira',
      'Alex'
    ];

    for (const kw of priorityKeywords) {
      const match = englishVoices.find(v => v.name.includes(kw));
      if (match) {
        return match;
      }
    }

    // Fallback: any US English voice or default English voice
    const usVoice = englishVoices.find(v => v.lang === 'en-US');
    return usVoice || englishVoices[0];
  }

  /**
   * Cleans text to produce natural speech cadence without markdown, brackets, or code artifacts
   */
  private formatForSpeech(text: string): string {
    return text
      .replace(/[*_~`#\[\]\(\)]/g, '') // Remove markdown symbols
      .replace(/\[\d+,\s*\d+,\s*\d+\]/g, '') // Remove raw vector dumps like [0, 1, 2]
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Speaks the provided text with expressive natural prosody.
   */
  public speak(text: string, options: VoiceSynthesizerOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      if (!this.synth) {
        resolve();
        return;
      }

      // Stop any current utterance immediately for real-time responsiveness
      this.stop();

      const cleanedText = this.formatForSpeech(text);
      if (!cleanedText) {
        resolve();
        return;
      }

      // Make sure voices are up to date
      if (!this.selectedVoice) {
        const voices = this.synth.getVoices();
        if (voices.length > 0) {
          this.selectedVoice = this.findBestNaturalVoice(voices);
        }
      }

      const utterance = new SpeechSynthesisUtterance(cleanedText);
      if (this.selectedVoice) {
        utterance.voice = this.selectedVoice;
        utterance.lang = this.selectedVoice.lang;
      }

      // Tuned parameters for warm, remarkably human cadence
      utterance.rate = options.rate ?? 1.0;
      utterance.pitch = options.pitch ?? 1.0;
      utterance.volume = options.volume ?? 1.0;

      this.isSpeaking = true;

      utterance.onstart = () => {
        this.isSpeaking = true;
        options.onStart?.();
      };

      utterance.onend = () => {
        this.isSpeaking = false;
        options.onEnd?.();
        resolve();
      };

      utterance.onerror = (e) => {
        this.isSpeaking = false;
        options.onError?.(e);
        resolve();
      };

      this.currentUtterances.push(utterance);

      // WebKit resume bug mitigation
      if (this.synth.paused) {
        this.synth.resume();
      }

      this.synth.speak(utterance);
    });
  }

  /**
   * Instantly stops any current speech.
   */
  public stop() {
    if (this.synth) {
      try {
        this.synth.cancel();
      } catch {}
    }
    this.isSpeaking = false;
    this.currentUtterances = [];
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}

export const naturalVoice = new NaturalVoiceSynthesizer();
