import { describe, expect, it } from "vitest";
import { CUSTOM_RATE_MACHINE_TYPE } from "./custom-rate";
import { nextPinRule, pinRuleOf, shownPinRule, withPinRule } from "./pin-rule";

describe("pin rule", () => {
  it("reads Any, Up to and Exactly from the count and the flag", () => {
    expect(pinRuleOf({})).toBe("any");
    expect(pinRuleOf({ solvePin: 0 })).toBe("any");
    expect(pinRuleOf({ solvePin: 4 })).toBe("upTo");
    expect(pinRuleOf({ solvePin: 4, solvePinExact: false })).toBe("upTo");
    expect(pinRuleOf({ solvePin: 4, solvePinExact: true })).toBe("exact");
    // A flag without a count is still Any.
    expect(pinRuleOf({ solvePinExact: true })).toBe("any");
  });

  it("keeps a custom rate card's count exact", () => {
    expect(pinRuleOf({ solvePin: 1 }, { machineType: CUSTOM_RATE_MACHINE_TYPE })).toBe("exact");
  });

  it("steps Any, Up to, Exactly and round again", () => {
    expect(nextPinRule("any")).toBe("upTo");
    expect(nextPinRule("upTo")).toBe("exact");
    expect(nextPinRule("exact")).toBe("any");
  });

  it("shows Up to with no count, Any only when picked, a custom rate card's Any as Any", () => {
    expect(shownPinRule({})).toBe("upTo");
    expect(shownPinRule({ solvePin: 0 })).toBe("upTo");
    expect(shownPinRule({ solvePinAny: true })).toBe("any");
    expect(shownPinRule({ solvePin: 4, solvePinExact: true })).toBe("exact");
    // A count outranks a stale Any mark.
    expect(shownPinRule({ solvePin: 4, solvePinAny: true })).toBe("upTo");
    expect(shownPinRule({}, { machineType: CUSTOM_RATE_MACHINE_TYPE })).toBe("any");
    // The solver's rule is unchanged: no count is Any.
    expect(pinRuleOf({})).toBe("any");
  });

  it("writes the three fields and nothing else", () => {
    const node = { id: "n", solvePin: 3, solvePinExact: true, other: 1 };
    expect(withPinRule(node, "any", 3)).toEqual({ id: "n", other: 1, solvePinAny: true });
    expect(withPinRule(node, "upTo", 5)).toEqual({ id: "n", other: 1, solvePin: 5 });
    const bare: { id: string; solvePin?: number; solvePinExact?: boolean; solvePinAny?: boolean } = {
      id: "n",
      solvePinAny: true,
    };
    expect(withPinRule(bare, "exact", 2)).toEqual({ id: "n", solvePin: 2, solvePinExact: true });
    // No count: Up to waiting for one, the Any mark dropped.
    expect(withPinRule(node, "upTo", 0)).toEqual({ id: "n", other: 1 });
    expect(withPinRule(node, "exact", undefined)).toEqual({ id: "n", other: 1 });
    expect(withPinRule(bare, "upTo", undefined)).toEqual({ id: "n" });
  });
});
