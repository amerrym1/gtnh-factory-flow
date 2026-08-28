/**
 * Synthesized interface sounds for the board - no audio files, everything
 * built from Web Audio oscillators and filtered noise.
 *
 * Sounds mark EVENTS THAT CHANGED THE PLAN (a card landing, a wire snapping
 * in or refusing, a knob turning), never raw UI interaction: a global
 * every-button tick was tried and rejected as noise. The vocabulary lives in
 * `playBoardSound`'s switch; who calls what is the watcher's business
 * (`use-board-sound-effects.ts`) plus the one gesture hook for refusals.
 *
 * Three hard-won rules keep them clean:
 * - Every envelope RAMPS in over a few ms and ramps fully out. A gain that
 *   steps straight to its peak is a click stacked on the note - that was
 *   the first version's "clicky" sound.
 * - Nothing is scheduled against a suspended AudioContext. The context
 *   suspends whenever the tab loses focus or autoplay policy holds it, and
 *   notes scheduled while suspended play late, clipped, or not at all -
 *   that was the "sometimes I don't hear it" bug. `playBoardSound` resumes
 *   first and schedules in the resume callback.
 * - The output stream is KEPT HOT. Chrome (Windows especially) parks the
 *   hardware audio stream after a few seconds of silence while
 *   `currentTime` keeps running, and a 100ms note scheduled into the
 *   wake-up gap is clipped or lost entirely - which reads as "the first
 *   sound played, then nothing". An inaudible constant source holds the
 *   stream open, and every note starts a beat after "now" so it never
 *   begins mid-wakeup.
 * - Fundamentals sit at 200Hz+ (laptop speakers roll off below), and the
 *   whole mix runs through one gentle lowpass so nothing spits.
 */

const KEY = "gtnh-factory-flow.board-sounds.v1";
const VOLUME_KEY = "gtnh-factory-flow.board-sounds-volume.v1";

/** The default master volume; the settings slider works in this scale. */
export const DEFAULT_BOARD_SOUND_VOLUME = 0.5;

export function areBoardSoundsEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setBoardSoundsEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.removeItem(KEY);
    } else {
      window.localStorage.setItem(KEY, "off");
    }
  } catch {
    // A blocked quota must never break the app.
  }
}

/** Master volume, 0..1. Applied live: a slider drag is audible immediately. */
export function getBoardSoundVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw === null) {
      return DEFAULT_BOARD_SOUND_VOLUME;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_BOARD_SOUND_VOLUME;
  } catch {
    return DEFAULT_BOARD_SOUND_VOLUME;
  }
}

export function setBoardSoundVolume(volume: number): void {
  const clamped = Math.min(1, Math.max(0, volume));
  try {
    if (clamped === DEFAULT_BOARD_SOUND_VOLUME) {
      window.localStorage.removeItem(VOLUME_KEY);
    } else {
      window.localStorage.setItem(VOLUME_KEY, String(clamped));
    }
  } catch {
    // A blocked quota must never break the app.
  }
  if (masterGain) {
    masterGain.gain.value = clamped;
  }
}

export type BoardSoundKind =
  | "place" // a card or drawer lands on the board
  | "delete" // a card leaves the board
  | "connect" // a wire snaps in
  | "unwire" // a wire is cut
  | "error" // a wire drop was refused
  | "open" // a board window unfolds from its summary card
  | "close" // a board window folds to its summary card
  | "adjust" // a setting on a card changed: machine count, drain pill, config
  | "sweep"; // one sound for a bulk change (paste, arrange, import)

let audioContext: AudioContext | undefined;
let masterGain: GainNode | undefined;
let noiseBuffer: AudioBuffer | undefined;
const lastPlayedAt = new Map<BoardSoundKind, number>();

/**
 * RETRIGGER STEALS, never stacks and never drops. Playing a kind that is
 * already sounding fades the old voice out in a few ms and starts fresh -
 * the way every game UI does it. The alternatives both failed in use: let
 * voices overlap and rapid deletes SUM their 250ms tails into a crescendo;
 * throttle repeats away and rapid deletes lose their feedback entirely
 * ("some sounds don't play"). One live voice per kind, so a burst of the
 * same action sounds like a fast drum roll at one volume.
 */
const activeVoices = new Map<BoardSoundKind, GainNode>();

/** Only a same-frame duplicate is dropped outright. */
const DEDUPE_MS = 30;

/** How fast a stolen voice gets out of the way. */
const STEAL_FADE = 0.015;

/**
 * Fast REPEATS duck. Even with stealing, a burst of full-volume retriggers
 * (wheel-scrolling a tier chip) reads two or three times louder than one
 * note - the ear sums repeated pulses inside ~200ms. So repeats inside
 * this window play progressively quieter, like an OS scroll tick, and the
 * first note after a pause is back at full voice. The window is deliberately
 * TIGHT: wheel steps arrive every 30-80ms, but two deliberate actions in
 * quick succession can be 150ms apart, and ducking those read as broken
 * volume rather than as a scroll tick.
 */
const REPEAT_WINDOW_MS = 120;
const REPEAT_DUCK = 0.6;
const REPEAT_DUCK_FLOOR = 3;
const repeatStreak = new Map<BoardSoundKind, number>();

/**
 * Every note fades in over this long; instant attacks click, and even a
 * clean 5ms onset reads as hard-edged - 10ms is where the notes stop
 * sounding struck and start sounding placed.
 */
const ATTACK = 0.01;

/**
 * Notes start this far after "now". Scheduling AT currentTime asks the
 * graph to begin a 5ms attack in the past by the time it renders, which
 * eats the front of the note.
 */
const SCHEDULE_AHEAD = 0.03;

function getContext(): AudioContext | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  // A context can die under us (device switch, "closed" state); a dead one
  // is discarded and rebuilt rather than silently swallowing every note.
  if (audioContext && audioContext.state === "closed") {
    audioContext = undefined;
    masterGain = undefined;
    noiseBuffer = undefined;
    // These voices belong to the dead context; stealing them from the new
    // one would schedule ramps on a foreign clock.
    activeVoices.clear();
  }
  if (!audioContext) {
    try {
      audioContext = new AudioContext();
      masterGain = audioContext.createGain();
      // The one master volume. Everything below is relative to this.
      masterGain.gain.value = getBoardSoundVolume();
      // A soft roof over the whole mix: synthesized edges high up are what
      // makes little UI notes sound cheap and spitty. 5.5kHz keeps the
      // presence band (1-4kHz) intact - loudness LIVES there, and an
      // earlier 3.2kHz roof was part of why everything read as faint.
      const roof = audioContext.createBiquadFilter();
      roof.type = "lowpass";
      roof.frequency.value = 4500;
      // Overload protection must be STATELESS. A DynamicsCompressor here
      // made identical actions play at different volumes: its ~100ms
      // release meant a sound landing shortly after another went through
      // partially-engaged gain reduction while an isolated one did not.
      // A tanh soft-clip shapes each sample on its own - no memory, so
      // the same note is always the same loudness, and a rare overlap
      // rounds off instead of clipping.
      const softClip = audioContext.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i += 1) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        // Unity slope at zero (transparent at normal levels), saturating
        // toward ~0.83 as overlaps push past full scale.
        curve[i] = Math.tanh(x * 1.2) / 1.2;
      }
      softClip.curve = curve;
      softClip.oversample = "2x";
      masterGain.connect(roof);
      roof.connect(softClip);
      softClip.connect(audioContext.destination);
      // The keep-alive: an inaudible DC-ish hum that never stops, so the
      // hardware output stream never parks between sounds. Routed straight
      // to the destination - it must survive the master volume at zero.
      const keepAlive = audioContext.createConstantSource();
      const keepAliveGain = audioContext.createGain();
      keepAliveGain.gain.value = 0.0001;
      keepAlive.connect(keepAliveGain);
      keepAliveGain.connect(audioContext.destination);
      keepAlive.start();
    } catch {
      return undefined;
    }
  }
  return audioContext;
}

/** A short white-noise buffer, built once, reused by every puff. */
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const length = Math.floor(ctx.sampleRate * 0.25);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return noiseBuffer;
}

/**
 * Fade in over ATTACK, decay with a BODY, end at true zero. The body stage
 * (down to a third of peak at mid-duration, then out) matters for loudness:
 * the ear integrates over ~150ms, so a note that is all attack measures
 * loud on a scope and still sounds like a faint tap.
 */
function shapeEnvelope(gain: AudioParam, t0: number, peak: number, duration: number): void {
  gain.setValueAtTime(0.0001, t0);
  gain.linearRampToValueAtTime(peak, t0 + ATTACK);
  gain.exponentialRampToValueAtTime(peak * 0.35, t0 + duration * 0.45);
  gain.exponentialRampToValueAtTime(0.002, t0 + duration);
  gain.linearRampToValueAtTime(0, t0 + duration + 0.015);
}

interface BlipOptions {
  /** Start frequency in Hz. */
  from: number;
  /** End frequency; equal to `from` for a flat note. */
  to: number;
  /** Seconds from the scheduled start. */
  delay?: number;
  duration: number;
  peak: number;
  type?: OscillatorType;
}

/** One enveloped oscillator note. */
function blip(ctx: AudioContext, out: AudioNode, options: BlipOptions): void {
  const t0 = ctx.currentTime + SCHEDULE_AHEAD + (options.delay ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  // A few cents of drift so repeated actions never sound stamped out.
  const drift = 1 + (Math.random() - 0.5) * 0.03;
  osc.type = options.type ?? "sine";
  osc.frequency.setValueAtTime(options.from * drift, t0);
  if (options.to !== options.from) {
    osc.frequency.exponentialRampToValueAtTime(options.to * drift, t0 + options.duration);
  }
  shapeEnvelope(gain.gain, t0, options.peak, options.duration);
  osc.connect(gain);
  gain.connect(out);
  osc.start(t0);
  osc.stop(t0 + options.duration + 0.03);
}

/** A filtered puff of noise: the knock and brush material. */
function puff(
  ctx: AudioContext,
  out: AudioNode,
  options: { frequency: number; q?: number; duration: number; peak: number; delay?: number },
): void {
  const t0 = ctx.currentTime + SCHEDULE_AHEAD + (options.delay ?? 0);
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx);
  // A random start point so two puffs never replay the identical grains.
  const offset = Math.random() * 0.1;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = options.frequency;
  filter.Q.value = options.q ?? 1.2;
  const gain = ctx.createGain();
  shapeEnvelope(gain.gain, t0, options.peak, options.duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  source.start(t0, offset);
  source.stop(t0 + options.duration + 0.03);
}

/**
 * The voices. Tuning lesson learned the hard way: short pure sines below
 * 300Hz are perceptually near-silent whatever their amplitude. Loudness
 * needs duration (the body stage of the envelope), harmonics (triangle
 * over sine), and some energy above 500Hz. Every voice carries all three.
 */
function schedule(kind: BoardSoundKind, ctx: AudioContext, out: AudioNode): void {
  switch (kind) {
    case "place":
      // A round thump, its octave for body, a knock for the touch.
      blip(ctx, out, { from: 196, to: 140, duration: 0.22, peak: 0.42 });
      blip(ctx, out, { from: 392, to: 280, duration: 0.15, peak: 0.13, type: "triangle" });
      puff(ctx, out, { frequency: 1400, duration: 0.05, peak: 0.18 });
      break;
    case "delete":
      // A small settling step down - removed, not mourned. The octave
      // plunge this used to be made every cleanup sound like a loss.
      blip(ctx, out, { from: 311, to: 233, duration: 0.18, peak: 0.34, type: "triangle" });
      break;
    case "connect":
      // Two rising notes a beat apart: the wire snapping home.
      blip(ctx, out, { from: 587, to: 587, duration: 0.12, peak: 0.28, type: "triangle" });
      blip(ctx, out, { from: 698, to: 698, duration: 0.16, peak: 0.3, delay: 0.08, type: "triangle" });
      break;
    case "unwire":
      // One falling note, softer than delete: only a wire went.
      blip(ctx, out, { from: 440, to: 330, duration: 0.16, peak: 0.28, type: "triangle" });
      break;
    case "error":
      // Two notes stepping DOWN a whole tone: a gentle "no".
      blip(ctx, out, { from: 294, to: 294, duration: 0.14, peak: 0.32, type: "triangle" });
      blip(ctx, out, { from: 262, to: 262, duration: 0.2, peak: 0.32, delay: 0.1, type: "triangle" });
      break;
    case "open":
      blip(ctx, out, { from: 262, to: 440, duration: 0.2, peak: 0.28, type: "triangle" });
      break;
    case "close":
      blip(ctx, out, { from: 440, to: 262, duration: 0.2, peak: 0.28, type: "triangle" });
      break;
    case "adjust":
      // A neutral mid tap: a knob turned, a pill cycled, a count stepped.
      blip(ctx, out, { from: 523, to: 523, duration: 0.08, peak: 0.2, type: "triangle" });
      break;
    case "sweep":
      // One broad soft brush for a bulk change, however big it was.
      puff(ctx, out, { frequency: 700, q: 0.9, duration: 0.3, peak: 0.34 });
      blip(ctx, out, { from: 233, to: 311, duration: 0.28, peak: 0.2 });
      break;
  }
}

/**
 * Builds and resumes the context ahead of the first real sound, so it never
 * plays into a cold output stream. Call from any early user gesture.
 */
export function primeBoardSounds(): void {
  if (typeof window === "undefined" || !areBoardSoundsEnabled()) {
    return;
  }
  const ctx = getContext();
  if (ctx && ctx.state !== "running") {
    void ctx.resume().catch(() => {});
  }
}

export function playBoardSound(kind: BoardSoundKind): void {
  if (typeof window === "undefined" || !areBoardSoundsEnabled()) {
    return;
  }
  if (typeof document !== "undefined" && document.hidden) {
    return;
  }
  const now = performance.now();
  const last = lastPlayedAt.get(kind);
  if (last !== undefined && now - last < DEDUPE_MS) {
    return;
  }
  const streak =
    last !== undefined && now - last < REPEAT_WINDOW_MS ? (repeatStreak.get(kind) ?? 0) + 1 : 0;
  repeatStreak.set(kind, streak);
  lastPlayedAt.set(kind, now);
  const duck = Math.pow(REPEAT_DUCK, Math.min(streak, REPEAT_DUCK_FLOOR));

  const ctx = getContext();
  const out = masterGain;
  if (!ctx || !out) {
    return;
  }
  const play = () => {
    // Steal, don't stack: fade any live voice of this kind out fast.
    const previous = activeVoices.get(kind);
    if (previous) {
      const t = ctx.currentTime;
      previous.gain.setValueAtTime(previous.gain.value, t);
      previous.gain.linearRampToValueAtTime(0.0001, t + STEAL_FADE);
    }
    // One gain node PER SOUND, so the whole sound (all its notes and
    // puffs) can be stolen as a unit by the next retrigger.
    const voice = ctx.createGain();
    voice.gain.value = duck;
    voice.connect(out);
    activeVoices.set(kind, voice);
    schedule(kind, ctx, voice);
    window.setTimeout(() => {
      if (activeVoices.get(kind) === voice) {
        activeVoices.delete(kind);
      }
      voice.disconnect();
    }, 1000);
  };
  if (ctx.state !== "running") {
    // Never schedule against a suspended clock: resume first, play in the
    // callback. Sounds fire from user gestures, so the resume succeeds.
    void ctx.resume().then(play).catch(() => {});
    return;
  }
  play();
}
