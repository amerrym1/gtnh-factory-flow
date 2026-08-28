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
  | "open" // a board window opens
  | "close" // a board window folds to its card
  | "adjust" // a setting on a card changed: machine count, drain pill, config
  | "sweep"; // one sound for a bulk change (paste, arrange, import)

let audioContext: AudioContext | undefined;
let masterGain: GainNode | undefined;
let noiseBuffer: AudioBuffer | undefined;
const lastPlayedAt = new Map<BoardSoundKind, number>();

/** Burst events may repeat a sound no faster than this. */
const THROTTLE_MS: Record<BoardSoundKind, number> = {
  place: 90,
  delete: 90,
  connect: 120,
  unwire: 120,
  error: 250,
  open: 200,
  close: 200,
  adjust: 70,
  sweep: 300,
};

/** Every note fades in over this long; instant attacks click. */
const ATTACK = 0.005;

function getContext(): AudioContext | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  if (!audioContext) {
    try {
      audioContext = new AudioContext();
      masterGain = audioContext.createGain();
      // The one master volume. Everything below is relative to this.
      masterGain.gain.value = getBoardSoundVolume();
      // A soft roof over the whole mix: synthesized edges above ~3kHz are
      // what makes little UI notes sound cheap and spitty.
      const roof = audioContext.createBiquadFilter();
      roof.type = "lowpass";
      roof.frequency.value = 3200;
      masterGain.connect(roof);
      roof.connect(audioContext.destination);
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

/** Fade in over ATTACK, decay to silence, end at true zero. */
function shapeEnvelope(gain: AudioParam, t0: number, peak: number, duration: number): void {
  gain.setValueAtTime(0.0001, t0);
  gain.linearRampToValueAtTime(peak, t0 + ATTACK);
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
  const t0 = ctx.currentTime + (options.delay ?? 0);
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
  const t0 = ctx.currentTime + (options.delay ?? 0);
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

function schedule(kind: BoardSoundKind, ctx: AudioContext, out: AudioNode): void {
  switch (kind) {
    case "place":
      // A round thump with a soft knock on top: a card set down.
      blip(ctx, out, { from: 240, to: 150, duration: 0.12, peak: 0.5 });
      puff(ctx, out, { frequency: 1400, duration: 0.04, peak: 0.12 });
      break;
    case "delete":
      // A falling note: something left the board.
      blip(ctx, out, { from: 330, to: 165, duration: 0.14, peak: 0.3, type: "triangle" });
      break;
    case "connect":
      // Two rising notes a beat apart: the wire snapping home.
      blip(ctx, out, { from: 587, to: 587, duration: 0.07, peak: 0.22 });
      blip(ctx, out, { from: 880, to: 880, duration: 0.1, peak: 0.25, delay: 0.07 });
      break;
    case "unwire":
      // One falling note, softer than delete: only a wire went.
      blip(ctx, out, { from: 494, to: 330, duration: 0.1, peak: 0.22 });
      break;
    case "error":
      // Two low notes stepping DOWN a minor third: a gentle "no".
      blip(ctx, out, { from: 311, to: 311, duration: 0.08, peak: 0.25, type: "triangle" });
      blip(ctx, out, { from: 262, to: 262, duration: 0.12, peak: 0.25, delay: 0.09, type: "triangle" });
      break;
    case "open":
      blip(ctx, out, { from: 262, to: 440, duration: 0.13, peak: 0.2, type: "triangle" });
      break;
    case "close":
      blip(ctx, out, { from: 440, to: 262, duration: 0.13, peak: 0.2, type: "triangle" });
      break;
    case "adjust":
      // A neutral mid tap: a knob turned, a pill cycled, a count stepped.
      blip(ctx, out, { from: 520, to: 520, duration: 0.05, peak: 0.14, type: "triangle" });
      break;
    case "sweep":
      // One broad soft brush for a bulk change, however big it was.
      puff(ctx, out, { frequency: 600, q: 0.8, duration: 0.2, peak: 0.25 });
      blip(ctx, out, { from: 220, to: 294, duration: 0.18, peak: 0.15 });
      break;
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
  if (last !== undefined && now - last < THROTTLE_MS[kind]) {
    return;
  }
  lastPlayedAt.set(kind, now);

  const ctx = getContext();
  const out = masterGain;
  if (!ctx || !out) {
    return;
  }
  if (ctx.state !== "running") {
    // Never schedule against a suspended clock: resume first, play in the
    // callback. Sounds fire from user gestures, so the resume succeeds.
    void ctx
      .resume()
      .then(() => schedule(kind, ctx, out))
      .catch(() => {});
    return;
  }
  schedule(kind, ctx, out);
}
