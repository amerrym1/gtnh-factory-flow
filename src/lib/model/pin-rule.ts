/**
 * A card's machine count rule (docs/up-to.md): Any (the plan picks), Up to N (what you have) or Exactly N. Stored as
 * `solvePin` (the count), `solvePinExact` (Exactly) and `solvePinAny` (Any, picked by the player); every reader and
 * writer goes through here so the card, the overview and the solver adapter agree.
 *
 * Up to is the default: a card with no count and no Any reads "Up to" and asks for its count (the set box blinks), so
 * a new card and a cleared count both land there. Until a count is set the plan picks one, as it does for Any.
 */
import { isCustomRateRecipe } from "./custom-rate";
import type { FactoryNode, Recipe } from "./types";

export type PinRule = "any" | "upTo" | "exact";

/** The words the board shows for each rule. */
export const PIN_RULE_LABEL: Record<PinRule, string> = {
  any: "Any",
  upTo: "Up to",
  exact: "Exactly",
};

/** The order a click on the rule word steps through. */
export const PIN_RULE_ORDER: readonly PinRule[] = ["any", "upTo", "exact"];

type Pinned = Pick<FactoryNode, "solvePin" | "solvePinExact" | "solvePinAny">;

/**
 * The rule the solver runs: Any whenever no count is set (the plan picks), else Up to or Exactly. A custom rate card's
 * set count is always Exactly (its dial).
 */
export function pinRuleOf(node: Pinned, recipe?: Pick<Recipe, "machineType">): PinRule {
  if (!((node.solvePin ?? 0) > 0)) return "any";
  if (isCustomRateRecipe(recipe)) return "exact";
  return node.solvePinExact === true ? "exact" : "upTo";
}

/**
 * The rule the board shows and the rule menu ticks: with no count set, Up to (waiting for its count) unless the player
 * picked Any. A custom rate card has no Up to: with no count it is Any.
 */
export function shownPinRule(node: Pinned, recipe?: Pick<Recipe, "machineType">): PinRule {
  const rule = pinRuleOf(node, recipe);
  if (rule !== "any" || isCustomRateRecipe(recipe)) return rule;
  return node.solvePinAny === true ? "any" : "upTo";
}

/** The next rule after `rule` in `PIN_RULE_ORDER`. */
export function nextPinRule(rule: PinRule): PinRule {
  return PIN_RULE_ORDER[(PIN_RULE_ORDER.indexOf(rule) + 1) % PIN_RULE_ORDER.length]!;
}

/**
 * The node with `rule` and `count` set: Any clears the count and marks Any; Up to sets the count; Exactly sets the
 * count and the flag. Up to or Exactly with a count that is not a positive number clears the count, which reads as Up
 * to waiting for one. Fields not involved are kept as they are.
 */
export function withPinRule<N extends Pinned>(
  node: N,
  rule: PinRule,
  count: number | undefined,
): N {
  const { solvePin: _pin, solvePinExact: _exact, solvePinAny: _any, ...rest } = node;
  if (rule === "any") return { ...rest, solvePinAny: true } as N;
  if (!(count !== undefined && Number.isFinite(count) && count > 0)) return rest as N;
  return (
    rule === "exact"
      ? { ...rest, solvePin: count, solvePinExact: true }
      : { ...rest, solvePin: count }
  ) as N;
}
