/**
 * gifenc ships no types. Only the surface the GIF export uses is declared;
 * option semantics worth knowing: `delay` is milliseconds (the encoder
 * rounds to centiseconds itself), and `repeat: 0` on the first frame writes
 * the NETSCAPE loop block for "forever".
 */
declare module "gifenc" {
  export type GifPaletteColor = [number, number, number] | [number, number, number, number];

  export interface GifWriteFrameOptions {
    palette?: GifPaletteColor[];
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    colorDepth?: number;
    dispose?: number;
    first?: boolean;
  }

  export interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifWriteFrameOptions,
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(options?: {
    initialCapacity?: number;
    auto?: boolean;
  }): GifEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: "rgb565" | "rgb444" | "rgba4444"; oneBitAlpha?: boolean | number },
  ): GifPaletteColor[];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPaletteColor[],
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;
}
