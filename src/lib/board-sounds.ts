/**
 * Tiny synthesized interface sounds for the board: a thump when a card
 * lands, a two-note plink when a wire connects, and so on. Everything is
 * generated with the Web Audio API - no audio files, nothing fetched.
 *
 * The whole system is DELIBERATELY quiet. Sounds confirm an action the hand
 * already made; they never announce anything. Gains here are tuned so the
 * sounds sit under game audio and music, and every one is under 200ms.
 *
 * The AudioContext is created lazily on the first play, which always happens
 * inside a user gesture (a click, a drop, a wire), so autoplay policy never
 * blocks it. A per-kind throttle stops burst events (multi-delete, paste)
 * from machine-gunning; bulk changes should call `sweep` once instead.
 */

const KEY = "gtnh-factory-flow.board-sounds.v1";

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

export type BoardSoundKind =
  | "place" // a card or drawer lands on the board
  | "delete" // a card leaves the board
  | "connect" // a wire snaps in
  | "unwire" // a wire is cut
  | "open" // a board window opens
  | "close" // a board window folds to its card
  | "tick" // a button press
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
  open: 200,
  close: 200,
  tick: 45,
  sweep: 300,
};

function getContext(): AudioContext | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  if (!audioContext) {
    try {
      audioContext = new AudioContext();
      masterGain = audioContext.createGain();
      // The one master volume. Everything below is relative to this.
      masterGain.gain.value = 0.5;
      masterGain.connect(audioContext.destination);
    } catch {
      return undefined;
    }
  }
  if (audioContext.state === "suspended") {
    void audioContext.resume().catch(() => {});
  }
  return audioContext;
}

/** A short white-noise buffer, built once, reused by tick and sweep. */
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const length = Math.floor(ctx.sampleRate * 0.1);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return noiseBuffer;
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

/** One enveloped oscillator note: instant attack, exponential decay. */
function blip(ctx: AudioContext, out: AudioNode, options: BlipOptions): void {
  const t0 = ctx.currentTime + (options.delay ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  // A few cents of drift so repeated actions never sound stamped out.
  const drift = 1 + (Math.random() - 0.5) * 0.04;
  osc.type = options.type ?? "sine";
  osc.frequency.setValueAtTime(options.from * drift, t0);
  if (options.to !== options.from) {
    osc.frequency.exponentialRampToValueAtTime(options.to * drift, t0 + options.duration);
  }
  gain.gain.setValueAtTime(options.peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + options.duration);
  osc.connect(gain);
  gain.connect(out);
  osc.start(t0);
  osc.stop(t0 + options.duration + 0.02);
}

/** A filtered puff of noise: the material of ticks and swooshes. */
function puff(
  ctx: AudioContext,
  out: AudioNode,
  options: { frequency: number; q?: number; duration: number; peak: number; delay?: number },
): void {
  const t0 = ctx.currentTime + (options.delay ?? 0);
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = options.frequency;
  filter.Q.value = options.q ?? 1.2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(options.peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + options.duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  source.start(t0);
  source.stop(t0 + options.duration + 0.02);
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

  switch (kind) {
    case "place":
      // A soft low thump with a faint knock on top: a card set down.
      blip(ctx, out, { from: 150, to: 105, duration: 0.11, peak: 0.22 });
      puff(ctx, out, { frequency: 1800, duration: 0.02, peak: 0.05 });
      break;
    case "delete":
      // A falling note: something left the board.
      blip(ctx, out, { from: 300, to: 150, duration: 0.12, peak: 0.1, type: "triangle" });
      break;
    case "connect":
      // Two rising notes a beat apart: the wire snapping home.
      blip(ctx, out, { from: 660, to: 660, duration: 0.05, peak: 0.06 });
      blip(ctx, out, { from: 880, to: 880, duration: 0.07, peak: 0.07, delay: 0.06 });
      break;
    case "unwire":
      // One falling note, quieter than delete: only a wire went.
      blip(ctx, out, { from: 440, to: 300, duration: 0.08, peak: 0.06 });
      break;
    case "open":
      blip(ctx, out, { from: 220, to: 390, duration: 0.12, peak: 0.07, type: "triangle" });
      break;
    case "close":
      blip(ctx, out, { from: 390, to: 220, duration: 0.12, peak: 0.07, type: "triangle" });
      break;
    case "tick":
      // Barely there: a fingertip on a key.
      puff(ctx, out, { frequency: 2400, q: 2, duration: 0.015, peak: 0.05 });
      break;
    case "sweep":
      // One broad soft brush for a bulk change, however big it was.
      puff(ctx, out, { frequency: 500, q: 0.8, duration: 0.18, peak: 0.09 });
      blip(ctx, out, { from: 180, to: 240, duration: 0.16, peak: 0.06 });
      break;
  }
}
