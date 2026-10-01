const STALE_MS = 500;
const SILENCE = 0.001;

/** Notes played one after the other, after the cue of the shot that ended the game. */
const melody = (frequencies) =>
  frequencies.map((hz, i) => ({
    wave: "triangle",
    from: hz,
    to: hz,
    at: 0.6 + i * 0.13,
    lasts: i === frequencies.length - 1 ? 0.5 : 0.13,
    gain: 0.3,
  }));

/**
 * Each cue is a list of voices: an oscillator (`wave`) or filtered noise (`noise`, the filter
 * type) sweeping from `from` to `to` Hz. It starts `at` seconds in, at its peak `gain`, and
 * fades to silence over `lasts` seconds.
 */
export const CUES = new Map(Object.entries({
  place: [{ wave: "triangle", from: 520, to: 260, at: 0, lasts: 0.07, gain: 0.35 }],
  miss: [
    { noise: "bandpass", from: 1800, to: 400, at: 0, lasts: 0.35, gain: 0.9 },
    { wave: "sine", from: 320, to: 110, at: 0, lasts: 0.18, gain: 0.25 },
  ],
  hit: [
    { noise: "lowpass", from: 3000, to: 300, at: 0, lasts: 0.3, gain: 0.8 },
    { wave: "square", from: 170, to: 55, at: 0, lasts: 0.25, gain: 0.25 },
  ],
  sunk: [
    { noise: "lowpass", from: 3000, to: 200, at: 0, lasts: 0.9, gain: 0.7 },
    { wave: "sawtooth", from: 440, to: 55, at: 0, lasts: 0.9, gain: 0.2 },
  ],
  victory: melody([523, 659, 784, 1047]),
  defeat: melody([392, 330, 262, 196]),
}));

const noiseBuffers = new WeakMap();

/** One second of white noise, made once per context. */
function noiseBuffer(context) {
  let buffer = noiseBuffers.get(context);
  if (!buffer) {
    buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
    noiseBuffers.set(context, buffer);
  }
  return buffer;
}

/** Builds the voices of one cue on `context`, starting now, playing into `output`. */
export function schedule(context, voices, output = context.destination) {
  for (const voice of voices) {
    const start = context.currentTime + voice.at;
    const end = start + voice.lasts;
    const source = voice.noise ? context.createBufferSource() : context.createOscillator();
    // The sweep moves a tone's pitch, or the cutoff of the filter the noise goes through.
    let swept = source;
    if (voice.noise) {
      source.buffer = noiseBuffer(context);
      swept = context.createBiquadFilter();
      swept.type = voice.noise;
      source.connect(swept);
    } else {
      source.type = voice.wave;
    }
    swept.frequency.setValueAtTime(voice.from, start);
    swept.frequency.exponentialRampToValueAtTime(voice.to, end);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(voice.gain, start);
    envelope.gain.exponentialRampToValueAtTime(SILENCE, end);
    swept.connect(envelope);
    envelope.connect(output);
    source.start(start);
    source.stop(end);
  }
}

/** Plays the game's cues. Sound is decoration: nothing here throws or makes the game wait. */
export class SoundBoard {
  #muted;
  #createContext;
  // null until the first cue is played; false in a browser without Web Audio.
  #context = null;
  // What the cues play into, so that switching sound off can cut the ones still playing.
  #output = null;

  constructor({ muted = false, createContext = () => new AudioContext() } = {}) {
    this.#muted = muted;
    this.#createContext = createContext;
  }

  get muted() {
    return this.#muted;
  }

  set muted(value) {
    this.#muted = value;
    if (value) {
      this.#output?.disconnect();
      this.#output = null;
    }
  }

  play(name) {
    const voices = CUES.get(name);
    if (this.muted || !voices) return;
    const context = this.#open();
    if (!context) return;
    if (context.state === "running") {
      this.#schedule(context, voices);
      return;
    }
    // Browsers keep audio suspended until the page is used. A cue that waited long is dropped:
    // a late resume must not release a burst of old ones.
    const asked = Date.now();
    context.resume().then(
      () => {
        if (!this.muted && Date.now() - asked < STALE_MS) this.#schedule(context, voices);
      },
      () => {},
    );
  }

  #schedule(context, voices) {
    if (this.#output === null) {
      this.#output = context.createGain();
      this.#output.connect(context.destination);
    }
    schedule(context, voices, this.#output);
  }

  /**
   * Call on every user gesture. Browsers start audio only from one, and most cues answer a
   * message from the server instead; Safari also suspends the context when the page is hidden.
   */
  wake() {
    if (this.muted) return;
    const context = this.#open();
    if (context && context.state !== "running") context.resume().catch(() => {});
  }

  #open() {
    if (this.#context === null) {
      try {
        this.#context = this.#createContext();
      } catch {
        this.#context = false;
      }
    }
    return this.#context;
  }
}
