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
  const rows: Array<{ coefficients: Map<number, number>; rhs: number; eq: boolean }> = [];
  for (const row of lp.equalities) {
    rows.push(normalizeRow(row.coefficients, row.rhs, true));
  }
  for (const row of lp.upperBounds) {
    rows.push({ coefficients: new Map(row.coefficients), rhs: row.rhs, eq: false });
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
    // Drive lingering degenerate artificials out of the basis when possible.
    for (let r = 0; r < m; r += 1) {
      if (!artificialOf.includes(basis[r]!)) {
        continue;
      }
      for (let c = 0; c < n; c += 1) {
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
 * Maximizes `objective` over the tableau in place. Bland's rule on both the
 * entering and leaving choice: slower than steepest-edge, immune to cycling,
 * and fully deterministic - the same model always walks the same pivots.
 */
function runSimplex(
  tableau: number[][],
  basis: number[],
  objective: number[],
  columns: number,
  banned?: Set<number>,
): boolean {
  const m = tableau.length;
  // Reduced costs live in their own row, rebuilt from the basis each pivot -
  // simple and O(mn), fine at lab sizes.
  for (let iteration = 0; iteration < 20000; iteration += 1) {
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
    for (let c = 0; c < columns; c += 1) {
      if (banned?.has(c)) {
        continue;
      }
      if (reduced[c]! > 1e-9) {
        entering = c;
        break;
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
      return false;
    }
    pivot(tableau, basis, leaving, entering, columns);
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
