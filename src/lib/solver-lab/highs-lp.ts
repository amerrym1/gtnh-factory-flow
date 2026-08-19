import type { LinearProgram, LpSolution } from "./simplex";

/**
 * The lab's production-grade engine: HiGHS (MIT-licensed, WASM) behind the
 * same interface as the homegrown simplex. The homegrown one mis-terminated
 * on a real board's degenerate system - exactly the "if numerics bite, swap
 * the engine" branch of docs/solver-equations.md - and the model builder,
 * not the engine, is the asset worth keeping.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadHighs: Promise<HighsInstance> = require("highs")();

interface HighsInstance {
  solve: (lpText: string) => {
    Status: string;
    Columns: Record<string, { Primal: number }>;
  };
}

export async function solveLpHighs(lp: LinearProgram): Promise<LpSolution> {
  const highs = await loadHighs;
  const n = lp.maximize.length;

  const term = (value: number, index: number) => `${value < 0 ? "- " : "+ "}${format(Math.abs(value))} x${index}`;
  const lines: string[] = ["Maximize", " obj:"];
  const objTerms: string[] = [];
  for (let c = 0; c < n; c += 1) {
    const v = lp.maximize[c]!;
    if (v !== 0) {
      objTerms.push(term(v, c));
    }
  }
  lines[1] = ` obj: ${objTerms.length > 0 ? objTerms.join(" ") : "0 x0"}`;
  lines.push("Subject To");
  let rowIndex = 0;
  for (const row of lp.equalities) {
    const terms: string[] = [];
    for (const [c, v] of row.coefficients) {
      if (v !== 0) {
        terms.push(term(v, c));
      }
    }
    if (terms.length === 0) {
      continue;
    }
    lines.push(` e${rowIndex}: ${terms.join(" ")} = ${format(row.rhs)}`);
    rowIndex += 1;
  }
  for (const row of lp.upperBounds) {
    const terms: string[] = [];
    for (const [c, v] of row.coefficients) {
      if (v !== 0) {
        terms.push(term(v, c));
      }
    }
    if (terms.length === 0) {
      continue;
    }
    lines.push(` u${rowIndex}: ${terms.join(" ")} <= ${format(row.rhs)}`);
    rowIndex += 1;
  }
  lines.push("End");

  const solved = highs.solve(lines.join("\n"));
  if (solved.Status !== "Optimal") {
    const status = solved.Status === "Infeasible" ? "infeasible" : "unbounded";
    return { status, x: [], objective: Number.NaN };
  }
  const x = new Array<number>(n).fill(0);
  for (let c = 0; c < n; c += 1) {
    x[c] = solved.Columns[`x${c}`]?.Primal ?? 0;
  }
  let objective = 0;
  for (let c = 0; c < n; c += 1) {
    objective += lp.maximize[c]! * x[c]!;
  }
  return { status: "optimal", x, objective };
}

/** LP-format numbers: plain decimal, no exponent, enough digits to be exact
 * at board scale. */
function format(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) {
    return String(value);
  }
  return value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}
