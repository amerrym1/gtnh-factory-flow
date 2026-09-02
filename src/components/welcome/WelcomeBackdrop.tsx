"use client";

import { useEffect, useRef } from "react";

/**
 * The Welcome page's living backdrop: a faint factory running by itself.
 *
 * Ghost cards on the board grid, wired together, with packets sliding along
 * the wires and a card glowing when one arrives. Everything is drawn at low
 * alpha over the app's own canvas colour, so it reads as the board breathing
 * under a sheet of glass rather than a screensaver. The look is the board's
 * own: 20px pitch, the wire colours of real resources, right-angle runs.
 *
 * One canvas, one requestAnimationFrame loop. It stops while the tab is
 * hidden and draws a single still frame when the visitor prefers reduced
 * motion. Sized to its box through a ResizeObserver; devicePixelRatio is
 * capped at 2 so a 5K window does not cost four times the fill.
 */

const PITCH = 20;
const PALETTE = ["#22d3ee", "#f59e0b", "#4ade80", "#60a5fa", "#f87171", "#c084fc"];
const WIRE_COUNT = 22;
const PACKET_SPEED_MIN = 36;
const PACKET_SPEED_MAX = 70;
const WIRE_LIFE_MIN = 18;
const WIRE_LIFE_MAX = 34;
const FADE = 2.4;
const DPR_CAP = 2;

type Point = { x: number; y: number };

interface Wire {
  points: Point[];
  lengths: number[];
  total: number;
  color: string;
  /** Seconds lived and seconds allowed. */
  age: number;
  life: number;
  packets: Array<{ at: number; speed: number; length: number }>;
  /** The card at each end: its rect and how lit it is. */
  from: Card;
  to: Card;
}

interface Card {
  x: number;
  y: number;
  w: number;
  h: number;
  glow: number;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function snap(value: number): number {
  return Math.round(value / PITCH) * PITCH;
}

function makeCard(width: number, height: number): Card {
  const w = PITCH * Math.round(rand(4, 7));
  const h = PITCH * Math.round(rand(3, 5));
  return {
    x: snap(rand(PITCH * 2, Math.max(PITCH * 3, width - w - PITCH * 2))),
    y: snap(rand(PITCH * 2, Math.max(PITCH * 3, height - h - PITCH * 2))),
    w,
    h,
    glow: 0,
  };
}

/**
 * A right-angled run from one card's right edge to another's left edge, the
 * way the router draws them: out, across on a grid line, in. Two bends, or
 * three when the target is behind the source and the wire has to loop.
 */
function routeWire(from: Card, to: Card): Point[] {
  const start = { x: from.x + from.w, y: snap(from.y + from.h / 2) };
  const end = { x: to.x, y: snap(to.y + to.h / 2) };
  const points: Point[] = [start];
  if (end.x > start.x + PITCH * 2) {
    const midX = snap(start.x + (end.x - start.x) * rand(0.3, 0.7));
    points.push({ x: midX, y: start.y }, { x: midX, y: end.y });
  } else {
    const outX = start.x + PITCH * 2;
    const inX = end.x - PITCH * 2;
    const lane = snap(Math.min(from.y, to.y) - PITCH * 2);
    points.push({ x: outX, y: start.y }, { x: outX, y: lane }, { x: inX, y: lane }, { x: inX, y: end.y });
  }
  points.push(end);
  return points;
}

function makeWire(width: number, height: number): Wire {
  const from = makeCard(width, height);
  const to = makeCard(width, height);
  const points = routeWire(from, to);
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length =
      Math.abs(points[index].x - points[index - 1].x) +
      Math.abs(points[index].y - points[index - 1].y);
    lengths.push(length);
    total += length;
  }
  const packetCount = 1 + Math.floor(total / 260);
  const packets = Array.from({ length: packetCount }, () => ({
    at: rand(0, total),
    speed: rand(PACKET_SPEED_MIN, PACKET_SPEED_MAX),
    length: rand(18, 34),
  }));
  return {
    points,
    lengths,
    total,
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    age: 0,
    life: rand(WIRE_LIFE_MIN, WIRE_LIFE_MAX),
    packets,
    from,
    to,
  };
}

/** The point a distance along the wire, for drawing packets. */
function pointAt(wire: Wire, distance: number): Point {
  let remaining = Math.max(0, Math.min(wire.total, distance));
  for (let index = 0; index < wire.lengths.length; index += 1) {
    const length = wire.lengths[index];
    if (remaining <= length || index === wire.lengths.length - 1) {
      const a = wire.points[index];
      const b = wire.points[index + 1];
      const t = length === 0 ? 0 : remaining / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= length;
  }
  return wire.points[wire.points.length - 1];
}

function wireAlpha(wire: Wire): number {
  const fadeIn = Math.min(1, wire.age / FADE);
  const fadeOut = Math.min(1, Math.max(0, (wire.life - wire.age) / FADE));
  return Math.min(fadeIn, fadeOut);
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  wires: Wire[],
  still: boolean,
) {
  ctx.clearRect(0, 0, width, height);

  // The grid, as faint as the board's own dots.
  ctx.fillStyle = "rgba(255,255,255,0.055)";
  for (let y = PITCH; y < height; y += PITCH) {
    for (let x = PITCH; x < width; x += PITCH) {
      ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    }
  }

  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";

  for (const wire of wires) {
    const alpha = still ? 1 : wireAlpha(wire);
    if (alpha <= 0) {
      continue;
    }

    // The cards at both ends.
    for (const card of [wire.from, wire.to]) {
      const lit = still ? 0.35 : card.glow;
      ctx.globalAlpha = alpha * (0.16 + lit * 0.5);
      ctx.strokeStyle = wire.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(card.x + 1, card.y + 1, card.w - 2, card.h - 2);
      ctx.globalAlpha = alpha * (0.04 + lit * 0.18);
      ctx.fillStyle = wire.color;
      ctx.fillRect(card.x + 1, card.y + 1, card.w - 2, card.h - 2);
      // A row or two of port stubs, the shape a card has from far away.
      ctx.globalAlpha = alpha * 0.22;
      const rows = Math.max(1, Math.floor(card.h / PITCH) - 1);
      for (let row = 0; row < rows; row += 1) {
        const y = card.y + PITCH * (row + 1);
        ctx.fillRect(card.x + 4, y - 2, 10, 4);
        ctx.fillRect(card.x + card.w - 14, y - 2, 10, 4);
      }
    }

    // The wire.
    ctx.globalAlpha = alpha * 0.22;
    ctx.strokeStyle = wire.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(wire.points[0].x, wire.points[0].y);
    for (let index = 1; index < wire.points.length; index += 1) {
      ctx.lineTo(wire.points[index].x, wire.points[index].y);
    }
    ctx.stroke();

    if (still) {
      continue;
    }

    // The packets, bright and glowing, riding the wire.
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const packet of wire.packets) {
      const head = pointAt(wire, packet.at);
      const tail = pointAt(wire, packet.at - packet.length);
      ctx.globalAlpha = alpha * 0.85;
      ctx.shadowColor = wire.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      // Packets on a bend draw a straight chord across it; short packets
      // make it invisible, and it is cheaper than splitting the segment.
      ctx.lineTo(head.x, head.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.lineCap = "butt";
  }
  ctx.globalAlpha = 1;
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

    let width = 0;
    let height = 0;
    let wires: Wire[] = [];
    let frame = 0;
    let last = 0;
    let running = false;

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
      width = Math.max(1, Math.round(box.width));
      height = Math.max(1, Math.round(box.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // A fresh cast for the new stage; wires already drawn at the old size
      // would run off it or bunch in a corner.
      wires = Array.from({ length: WIRE_COUNT }, () => {
        const wire = makeWire(width, height);
        // Start the population part-way through its life so the page does
        // not open on an empty board that fades in all at once.
        wire.age = rand(0, wire.life * 0.8);
        return wire;
      });
      if (reduceMotion) {
        drawFrame(ctx, width, height, wires, true);
      }
    };

    const tick = (now: number) => {
      if (!running) {
        return;
      }
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      for (let index = 0; index < wires.length; index += 1) {
        const wire = wires[index];
        wire.age += dt;
        if (wire.age >= wire.life) {
          wires[index] = makeWire(width, height);
          continue;
        }
        wire.from.glow = Math.max(0, wire.from.glow - dt * 1.4);
        wire.to.glow = Math.max(0, wire.to.glow - dt * 1.4);
        for (const packet of wire.packets) {
          packet.at += packet.speed * dt;
          if (packet.at - packet.length > wire.total) {
            packet.at = 0;
            wire.to.glow = 1;
            wire.from.glow = Math.max(wire.from.glow, 0.5);
          }
        }
      }
      drawFrame(ctx, width, height, wires, false);
      frame = window.requestAnimationFrame(tick);
    };

    const start = () => {
      if (running || reduceMotion) {
        return;
      }
      running = true;
      last = 0;
      frame = window.requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      window.cancelAnimationFrame(frame);
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
