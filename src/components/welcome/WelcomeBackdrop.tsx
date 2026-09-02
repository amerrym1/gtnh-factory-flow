"use client";

import { useEffect, useRef } from "react";

/**
 * The Welcome page's backdrop: a field of ASCII texture that lives in the
 * corners and leaves the middle, where the words are, clear.
 *
 * A grid of monospace glyphs, denser and brighter towards the corners
 * (a vignette in reverse), most cells blank. It barely moves: a few cells
 * re-roll every tick, so it shimmers like a terminal at rest rather than
 * animating. Only the changed cells are repainted. One still frame under
 * reduced motion; stops while the tab is hidden.
 */

const CELL_W = 11;
const CELL_H = 16;
/** Glyphs, weighted: the light ones several times over. */
const GLYPHS = "··········::::----++||==##░░▒▓";
const ACCENT_CHANCE = 0.08;
const TICK_MS = 110;
/** Share of the live cells re-rolled per tick. */
const CHURN = 0.006;
const DPR_CAP = 2;

interface Cell {
  glyph: string;
  accent: boolean;
  /** 0 in the middle, 1 in the corners. */
  weight: number;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function rollGlyph(weight: number): string {
  // Density follows the vignette: the middle is almost all blank.
  if (Math.random() > weight * 0.75) {
    return " ";
  }
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

export function WelcomeBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const font = `12px ${getComputedStyle(document.body).fontFamily || "monospace"}`;

    let cols = 0;
    let rows = 0;
    let cells: Cell[] = [];
    let live: number[] = [];
    let timer = 0;

    const paintCell = (index: number) => {
      const cell = cells[index];
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = col * CELL_W;
      const y = row * CELL_H;
      ctx.clearRect(x, y, CELL_W, CELL_H);
      if (cell.glyph === " ") {
        return;
      }
      const alpha = 0.06 + cell.weight * 0.3;
      ctx.fillStyle = cell.accent
        ? `rgba(34, 211, 238, ${alpha})`
        : `rgba(147, 164, 187, ${alpha})`;
      ctx.fillText(cell.glyph, x + CELL_W / 2, y + CELL_H / 2);
    };

    const paintAll = () => {
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let index = 0; index < cells.length; index += 1) {
        paintCell(index);
      }
    };

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(box.width));
      const height = Math.max(1, Math.round(box.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / CELL_W);
      rows = Math.ceil(height / CELL_H);
      cells = [];
      live = [];
      const cx = width / 2;
      const cy = height / 2;
      const reach = Math.hypot(cx, cy);
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const x = col * CELL_W + CELL_W / 2;
          const y = row * CELL_H + CELL_H / 2;
          const distance = Math.hypot(x - cx, y - cy) / reach;
          const weight = smoothstep(0.42, 1.0, distance);
          if (weight > 0) {
            live.push(cells.length);
          }
          cells.push({
            glyph: rollGlyph(weight),
            accent: Math.random() < ACCENT_CHANCE,
            weight,
          });
        }
      }
      paintAll();
    };

    const tick = () => {
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const count = Math.max(1, Math.round(live.length * CHURN));
      for (let n = 0; n < count; n += 1) {
        const index = live[Math.floor(Math.random() * live.length)];
        const cell = cells[index];
        cell.glyph = rollGlyph(cell.weight);
        cell.accent = Math.random() < ACCENT_CHANCE;
        paintCell(index);
      }
    };

    const start = () => {
      if (timer || reduceMotion) {
        return;
      }
      timer = window.setInterval(tick, TICK_MS);
    };
    const stop = () => {
      window.clearInterval(timer);
      timer = 0;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) {
      start();
    }

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
