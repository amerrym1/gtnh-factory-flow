"use client";

import { getFontEmbedCSS } from "html-to-image";

/**
 * The @font-face CSS an image export needs, with the font files inlined as
 * data URLs — without it the cloned board falls back from Monocraft to the
 * renderer's generic monospace, which is the "wrong font" every export used
 * to wear (skipFonts was added for speed in 2ebccca; html-to-image's font
 * scan walks every stylesheet per capture).
 *
 * Computed once per session and shared by every capture — board and summary
 * bar both — so the speed the skip bought is kept. html-to-image prefers
 * `fontEmbedCSS` over `skipFonts`, so callers pass both. A failed scan stays
 * failed quietly: the export still renders, just in the fallback font.
 */
let fontCssPromise: Promise<string | undefined> | undefined;

export function resolveExportFontCss(element: HTMLElement): Promise<string | undefined> {
  fontCssPromise ??= getFontEmbedCSS(element).catch(() => undefined);
  return fontCssPromise;
}
