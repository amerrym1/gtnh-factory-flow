// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinecraftTooltip, WHEEL_STEPS_IN_PLACE_ATTRIBUTE } from "./MinecraftTooltip";

describe("MinecraftTooltip", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  it("clears an open tooltip when the viewport is zoomed", async () => {
    render(
      <MinecraftTooltip label="Tooltip line">
        <button type="button">Hover target</button>
      </MinecraftTooltip>,
    );

    fireEvent.mouseMove(screen.getByRole("button", { name: "Hover target" }), {
      clientX: 120,
      clientY: 80,
      buttons: 0,
    });

    expect(await screen.findByText("Tooltip line")).toBeTruthy();

    fireEvent.wheel(window);

    await waitFor(() => {
      expect(screen.queryByText("Tooltip line")).toBeNull();
    });
  });

  it("keeps the tooltip while a slot uses the wheel to step through its items", async () => {
    // Scrolling a rotating slot changes what the slot shows without moving it, so
    // the tip has to stay put and re-label itself rather than blink out on every
    // notch while you are reading which item you landed on.
    render(
      <MinecraftTooltip label="Oak Log">
        <button type="button" {...{ [WHEEL_STEPS_IN_PLACE_ATTRIBUTE]: "" }}>
          Hover target
        </button>
      </MinecraftTooltip>,
    );

    const target = screen.getByRole("button", { name: "Hover target" });
    fireEvent.mouseMove(target, { clientX: 120, clientY: 80, buttons: 0 });
    expect(await screen.findByText("Oak Log")).toBeTruthy();

    fireEvent.wheel(target);

    expect(screen.getByText("Oak Log")).toBeTruthy();
  });

  it("keeps the tooltip while one of its own controls is clicked", async () => {
    // The tier chip and hatch counter live under the power tooltip and change
    // the very numbers it shows: clicking them must leave the panel up so each
    // click's result is readable without re-hovering.
    render(
      <MinecraftTooltip label="Power story">
        <button type="button">Raise tier</button>
      </MinecraftTooltip>,
    );

    const target = screen.getByRole("button", { name: "Raise tier" });
    fireEvent.mouseMove(target, { clientX: 120, clientY: 80, buttons: 0 });
    expect(await screen.findByText("Power story")).toBeTruthy();

    // pointerType matters: the pointer-kind singleton reads it, and an
    // unlabelled pointerdown registers as a finger and mutes hover for the
    // rest of the suite.
    fireEvent.pointerDown(target, { pointerType: "mouse" });
    expect(screen.getByText("Power story")).toBeTruthy();

    // The click's own micro-drag: a mousemove with the button still down on
    // the control must not blink the panel out either.
    fireEvent.mouseMove(target, { clientX: 121, clientY: 80, buttons: 1 });
    expect(screen.getByText("Power story")).toBeTruthy();
  });

  it("survives an element blur but clears when the window loses focus", async () => {
    // Clicking a control under the tooltip blurs whatever held focus before
    // it; only the window itself going unfocused ends the hover story.
    render(
      <MinecraftTooltip label="Power story">
        <button type="button">Raise tier</button>
      </MinecraftTooltip>,
    );

    const target = screen.getByRole("button", { name: "Raise tier" });
    fireEvent.mouseMove(target, { clientX: 120, clientY: 80, buttons: 0 });
    expect(await screen.findByText("Power story")).toBeTruthy();

    fireEvent.blur(target);
    expect(screen.getByText("Power story")).toBeTruthy();

    fireEvent.blur(window);
    await waitFor(() => {
      expect(screen.queryByText("Power story")).toBeNull();
    });
  });

  it("clears an open tooltip when panning starts", async () => {
    render(
      <MinecraftTooltip label="Tooltip line">
        <button type="button">Hover target</button>
      </MinecraftTooltip>,
    );

    fireEvent.mouseMove(screen.getByRole("button", { name: "Hover target" }), {
      clientX: 120,
      clientY: 80,
      buttons: 0,
    });

    expect(await screen.findByText("Tooltip line")).toBeTruthy();

    fireEvent.pointerDown(window);

    await waitFor(() => {
      expect(screen.queryByText("Tooltip line")).toBeNull();
    });
  });
});
