"use client";

/**
 * Stitching a board capture and its summary bar into one finished image.
 *
 * The board arrives photographed at its own size; the bar is photographed at
 * a fixed design width (720 to 1600 CSS px, see ExportFooter) and scaled to
 * the board's width here. Scaling the BAR rather than designing it at board
 * width is the point: a sprawling factory exports thousands of pixels wide,
 * and a bar that grew with it would keep its font size and shrink into a
 * hairline once Discord fits the image on screen. Scaled, the bar holds a
 * constant fraction of the image and stays readable at any factory size.
 */

export interface CompositeLayout {
  /** Board capture, CSS px. */
  boardWidth: number;
  boardHeight: number;
  /** The bar's design size, CSS px; zero when there is no bar. */
  footerWidth: number;
  footerHeight: number;
  /** Factor that brings the bar to the board's width. */
  footerScale: number;
  /** Board plus scaled bar, CSS px. */
  totalHeight: number;
}

export function computeCompositeLayout(
  boardWidth: number,
  boardHeight: number,
  footerWidth: number,
  footerHeight: number,
): CompositeLayout {
  const hasFooter = footerWidth > 0 && footerHeight > 0;
  const footerScale = hasFooter ? boardWidth / footerWidth : 0;
  return {
    boardWidth,
    boardHeight,
    footerWidth: hasFooter ? footerWidth : 0,
    footerHeight: hasFooter ? footerHeight : 0,
    footerScale,
    totalHeight: boardHeight + (hasFooter ? footerHeight * footerScale : 0),
  };
}

/**
 * Draws board over bar on one canvas at the board's pixel density and
 * returns it as a PNG. `background` fills the seam and any rounding slack;
 * absent, the composite stays transparent where the layers are.
 */
export async function compositeExportPng(options: {
  boardBlob: Blob;
  footerBlob?: Blob;
  layout: CompositeLayout;
  pixelRatio: number;
  background?: string;
}): Promise<Blob> {
  const { boardBlob, footerBlob, layout, pixelRatio, background } = options;
  if (!footerBlob) {
    return boardBlob;
  }

  const [board, footer] = await Promise.all([
    createImageBitmap(boardBlob),
    createImageBitmap(footerBlob),
  ]);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(layout.boardWidth * pixelRatio);
    canvas.height = Math.round(layout.totalHeight * pixelRatio);
    const context = canvas.getContext("2d");
    if (!context) {
      return boardBlob;
    }

    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(board, 0, 0);
    const footerTop = Math.round(layout.boardHeight * pixelRatio);
    context.drawImage(footer, 0, footerTop, canvas.width, canvas.height - footerTop);

    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob ?? boardBlob), "image/png");
    });
  } finally {
    board.close();
    footer.close();
  }
}

/**
 * The SVG counterpart: both captures are full <svg> documents (html-to-image
 * renders DOM through a foreignObject), and SVG happily nests them. The board
 * rides at its natural size; the bar is wrapped in an <svg> whose viewBox is
 * the bar's design size and whose width is the board's, which is the same
 * scale-to-fit the PNG path does on canvas.
 */
export function composeExportSvg(options: {
  boardSvg: string;
  footerSvg?: string;
  layout: CompositeLayout;
  background?: string;
}): string {
  const { boardSvg, footerSvg, layout, background } = options;
  const board = stripXmlProlog(boardSvg);
  if (!footerSvg) {
    return board;
  }

  const footer = stripXmlProlog(footerSvg);
  const width = layout.boardWidth;
  const height = layout.totalHeight;
  const footerScaledHeight = layout.footerHeight * layout.footerScale;
  const backgroundRect = background
    ? `<rect width="100%" height="100%" fill="${background}"/>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    backgroundRect +
    board +
    `<svg x="0" y="${layout.boardHeight}" width="${width}" height="${footerScaledHeight}" ` +
    `viewBox="0 0 ${layout.footerWidth} ${layout.footerHeight}">` +
    footer +
    `</svg>` +
    `</svg>`
  );
}

function stripXmlProlog(svgText: string): string {
  return svgText.replace(/^\s*<\?xml[^>]*\?>\s*/i, "");
}
