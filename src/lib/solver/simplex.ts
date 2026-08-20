/**
 * A small, dense, two-phase simplex solver: maximize c.x subject to equality
 * and less-or-equal rows, x >= 0. Written for the equations rebuild's lab
 * work - boards are a few hundred variables, so a dense tableau with Bland's
 * rule (no cycling, deterministic pivots) is plenty, and having our own
 * engine keeps the prototype dependency-free while the model design settles.
 * If numerics ever bite on a real board, the model builder stays and this
 * file is swapped for a WASM LP behind the same interface.
 */

export interface LinearProgram {
  /** Objective coefficients, one per variable; the solver MAXIMIZES c.x. */
  maximize: number[];
  /** Equality rows: coefficients.x = rhs. */
  equalities: Array<{ coefficients: Map<number, number>; rhs: number }>;
  /** Inequality rows: coefficients.x <= rhs. */
  upperBounds: Array<{ coefficients: Map<number, number>; rhs: number }>;
}

export interface LpSolution {
  status: "optimal" | "infeasible" | "unbounded";
  x: number[];
  objective: number;
}

const EPS = 1e-9;

export function solveLp(lp: LinearProgram): LpSolution {
  const n = lp.maximize.length;

  // Normalize every row to rhs >= 0 so phase 1 can seed artificials.
  // Equilibrate: divide each row by its largest |coefficient| so wildly
  // scaled recipes (a litre in, a millibucket out) cannot leave the tableau
  // with entries five orders apart - tiny pivots amplify float error until
  // the walk stops terminating. Row scaling never changes the solution.
  const equilibrate = (coefficients: Map<number, number>, rhs: number) => {
    let scale = 0;
    for (const value of coefficients.values()) {
      scale = Math.max(scale, Math.abs(value));
    }
    if (scale <= 0 || (scale > 0.5 && scale < 2)) {
      return { coefficients: new Map(coefficients), rhs };
    }
    const scaled = new Map<number, number>();
    for (const [c, value] of coefficients) {
      scaled.set(c, value / scale);
    }
    return { coefficients: scaled, rhs: rhs / scale };
  };
  const rows: Array<{ coefficients: Map<number, number>; rhs: number; eq: boolean }> = [];
  for (const row of lp.equalities) {
    const scaled = equilibrate(row.coefficients, row.rhs);
    rows.push(normalizeRow(scaled.coefficients, scaled.rhs, true));
  }
  for (const row of lp.upperBounds) {
    const scaled = equilibrate(row.coefficients, row.rhs);
    rows.push({ coefficients: scaled.coefficients, rhs: scaled.rhs, eq: false });
  }

  const m = rows.length;
  // Column layout: [structural n][slack per <= row][artificial as needed].
  const slackOf = new Array<number>(m).fill(-1);
  let columns = n;
  for (let r = 0; r < m; r += 1) {
    if (!rows[r]!.eq) {
      slackOf[r] = columns;
      columns += 1;
    }
  }
  // A <= row with negative rhs flips into a >= row, which needs a surplus
  // column (negative slack) plus an artificial; handle by flipping sign here.
  const surplusOf = new Array<number>(m).fill(-1);
  for (let r = 0; r < m; r += 1) {
    if (!rows[r]!.eq && rows[r]!.rhs < 0) {
      const flipped = new Map<number, number>();
      for (const [c, v] of rows[r]!.coefficients) {
        flipped.set(c, -v);
      }
      rows[r] = { coefficients: flipped, rhs: -rows[r]!.rhs, eq: false };
      surplusOf[r] = slackOf[r];
      slackOf[r] = -1;
    }
  }

  const artificialStart = columns;
  const artificialOf = new Array<number>(m).fill(-1);
  for (let r = 0; r < m; r += 1) {
    if (rows[r]!.eq || surplusOf[r] >= 0) {
      artificialOf[r] = columns;
      columns += 1;
    }
  }

  // Dense tableau: m rows x (columns + 1 rhs).
  const tableau: number[][] = [];
  const basis = new Array<number>(m).fill(-1);
  for (let r = 0; r < m; r += 1) {
    const line = new Array<number>(columns + 1).fill(0);
    for (const [c, v] of rows[r]!.coefficients) {
      line[c] = v;
    }
    if (slackOf[r] >= 0) {
      line[slackOf[r]] = 1;
      basis[r] = slackOf[r];
    }
    if (surplusOf[r] >= 0) {
      line[surplusOf[r]] = -1;
    }
    if (artificialOf[r] >= 0) {
      line[artificialOf[r]] = 1;
      basis[r] = artificialOf[r];
    }
    line[columns] = rows[r]!.rhs;
    tableau.push(line);
  }

  // Phase 1: minimize the artificial sum (maximize its negative).
  if (artificialOf.some((a) => a >= 0)) {
    const phase1 = new Array<number>(columns).fill(0);
    for (const a of artificialOf) {
      if (a >= 0) {
        phase1[a] = -1;
      }
    }
    const feasible = runSimplex(tableau, basis, phase1, columns);
    if (!feasible) {
      return { status: "unbounded", x: [], objective: Number.NaN };
    }
    let infeasibility = 0;
    for (let r = 0; r < m; r += 1) {
      if (artificialOf.includes(basis[r]!)) {
        infeasibility += tableau[r]![columns]!;
      }
    }
    if (infeasibility > 1e-7) {
      return { status: "infeasible", x: [], objective: Number.NaN };
    }
    // Drive lingering degenerate artificials out of the basis through ANY
    // non-artificial column - slack and surplus columns included. Trying only
    // structural columns once left an artificial basic whose row had gone
    // structurally zero; phase 2 then regrew it from 0 and silently violated
    // the row it stood for. A row with no non-artificial column at all is
    // redundant, and phase 2 can never touch it, so it may stay.
    for (let r = 0; r < m; r += 1) {
      if (basis[r]! < artificialStart) {
        continue;
      }
      for (let c = 0; c < artificialStart; c += 1) {
        if (Math.abs(tableau[r]![c]!) > EPS) {
          pivot(tableau, basis, r, c, columns);
          break;
        }
      }
    }
  }

  // Phase 2: the real objective, artificials pinned to zero by exclusion.
  const objective = new Array<number>(columns).fill(0);
  for (let c = 0; c < n; c += 1) {
    objective[c] = lp.maximize[c]!;
  }
  const banned = new Set(artificialOf.filter((a) => a >= 0));
  const bounded = runSimplex(tableau, basis, objective, columns, banned);
  if (!bounded) {
    return { status: "unbounded", x: [], objective: Number.NaN };
  }

  const x = new Array<number>(n).fill(0);
  for (let r = 0; r < m; r += 1) {
    if (basis[r]! < n) {
      x[basis[r]!] = tableau[r]![columns]!;
    }
  }
  let value = 0;
  for (let c = 0; c < n; c += 1) {
    value += lp.maximize[c]! * x[c]!;
  }
  return { status: "optimal", x, objective: value };
}

function normalizeRow(coefficients: Map<number, number>, rhs: number, eq: boolean) {
  if (rhs >= 0) {
    return { coefficients: new Map(coefficients), rhs, eq };
  }
  const flipped = new Map<number, number>();
  for (const [c, v] of coefficients) {
    flipped.set(c, -v);
  }
  return { coefficients: flipped, rhs: -rhs, eq };
}

/**
 * Maximizes `objective` over the tableau in place. Entering column by
 * Dantzig's rule (most positive reduced cost - typically several times fewer
 * pivots than Bland's), falling back to Bland's rule permanently once the
 * objective stalls through a run of degenerate pivots, which is what makes
 * cycling impossible. Fully deterministic either way - the same model always
 * walks the same pivots.
 */
function runSimplex(
  tableau: number[][],
  basis: number[],
  objective: number[],
  columns: number,
  banned?: Set<number>,
): boolean {
  const m = tableau.length;
  let blandMode = false;
  let stalled = 0;
  let previousValue = Number.NEGATIVE_INFINITY;
  // Reduced costs live in their own row, rebuilt from the basis each pivot -
  // simple and O(mn), fine at lab sizes.
  for (let iteration = 0; iteration < 100000; iteration += 1) {
    const reduced = new Array<number>(columns).fill(0);
    for (let c = 0; c < columns; c += 1) {
      reduced[c] = objective[c] ?? 0;
    }
    for (let r = 0; r < m; r += 1) {
      const cost = objective[basis[r]!] ?? 0;
      if (cost === 0) {
        continue;
      }
      for (let c = 0; c < columns; c += 1) {
        reduced[c]! -= cost * tableau[r]![c]!;
      }
    }
    let entering = -1;
    if (blandMode) {
      for (let c = 0; c < columns; c += 1) {
        if (banned?.has(c)) {
          continue;
        }
        if (reduced[c]! > 1e-9) {
          entering = c;
          break;
        }
      }
    } else {
      let best = 1e-9;
      for (let c = 0; c < columns; c += 1) {
        if (banned?.has(c)) {
          continue;
        }
        if (reduced[c]! > best) {
          best = reduced[c]!;
          entering = c;
        }
      }
    }
    if (entering < 0) {
      return true;
    }
    let leaving = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let r = 0; r < m; r += 1) {
      const a = tableau[r]![entering]!;
      if (a > EPS) {
        const ratio = tableau[r]![columns]! / a;
        if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[r]! < (leaving >= 0 ? basis[leaving]! : Number.MAX_SAFE_INTEGER))) {
          best = ratio;
          leaving = r;
        }
      }
    }
    if (leaving < 0) {
      if (typeof process !== "undefined" && process.env?.SIMPLEX_DEBUG) {
        console.log(`simplex: ray at iteration ${iteration}, entering ${entering}, bland=${blandMode}`);
      }
      return false;
    }
    pivot(tableau, basis, leaving, entering, columns);
    if (!blandMode) {
      let value = 0;
      for (let r = 0; r < m; r += 1) {
        const cost = objective[basis[r]!] ?? 0;
        if (cost !== 0) {
          value += cost * tableau[r]![columns]!;
        }
      }
      if (value <= previousValue + 1e-12) {
        stalled += 1;
        if (stalled > 60) {
          blandMode = true;
        }
      } else {
        stalled = 0;
        previousValue = value;
      }
    }
  }
  if (typeof process !== "undefined" && process.env?.SIMPLEX_DEBUG) {
    console.log("simplex: iteration cap hit");
  }
  return false;
}

function pivot(tableau: number[][], basis: number[], row: number, col: number, columns: number) {
  const line = tableau[row]!;
  const p = line[col]!;
  for (let c = 0; c <= columns; c += 1) {
    line[c] = line[c]! / p;
  }
  for (let r = 0; r < tableau.length; r += 1) {
    if (r === row) {
      continue;
    }
    const factor = tableau[r]![col]!;
    if (Math.abs(factor) <= EPS) {
      continue;
    }
    for (let c = 0; c <= columns; c += 1) {
      tableau[r]![c] = tableau[r]![c]! - factor * line[c]!;
    }
  }
  basis[row] = col;
}
