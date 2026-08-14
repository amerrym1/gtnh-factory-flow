import { describe, expect, it } from "vitest";
import { composeExportSvg, computeCompositeLayout } from "./export-composite";

describe("computeCompositeLayout", () => {
  it("scales the bar to the board's width", () => {
    const layout = computeCompositeLayout(2400, 1200, 1200, 150);
    expect(layout.footerScale).toBe(2);
    expect(layout.totalHeight).toBe(1200 + 300);
  });

  it("collapses to the bare board when there is no bar", () => {
    const layout = computeCompositeLayout(2400, 1200, 0, 0);
    expect(layout.footerScale).toBe(0);
    expect(layout.totalHeight).toBe(1200);
  });

  it("treats a bar with no measured height as absent", () => {
    const layout = computeCompositeLayout(2400, 1200, 1200, 0);
    expect(layout.totalHeight).toBe(1200);
    expect(layout.footerWidth).toBe(0);
  });
});

describe("composeExportSvg", () => {
  const layout = computeCompositeLayout(1000, 500, 800, 100);
  const boardSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500"><rect/></svg>`;
  const footerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="100"><g/></svg>`;

  it("returns the board alone when there is no bar", () => {
    expect(composeExportSvg({ boardSvg, layout })).toBe(boardSvg);
  });

  it("nests board and bar in an outer document sized for both", () => {
    const composed = composeExportSvg({ boardSvg, footerSvg, layout, background: "#141414" });
    expect(composed).toContain(`viewBox="0 0 1000 625"`);
    expect(composed).toContain(`<rect width="100%" height="100%" fill="#141414"/>`);
    // The bar sits under the board, scaled from its 800px design width via
    // a viewBox that maps it onto the board's 1000px.
    expect(composed).toContain(
      `<svg x="0" y="500" width="1000" height="125" viewBox="0 0 800 100">`,
    );
    expect(composed).toContain(boardSvg);
    expect(composed).toContain(footerSvg);
  });

  it("keeps a transparent composite free of any background rect", () => {
    const composed = composeExportSvg({ boardSvg, footerSvg, layout });
    expect(composed).not.toContain(`<rect width="100%"`);
  });

  it("strips an XML prolog so the nested documents stay valid", () => {
    const composed = composeExportSvg({
      boardSvg: `<?xml version="1.0"?>\n${boardSvg}`,
      footerSvg,
      layout,
    });
    expect(composed.startsWith("<svg")).toBe(true);
    expect(composed).not.toContain("<?xml");
  });
});
