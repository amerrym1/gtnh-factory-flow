import { describe, expect, it } from "vitest";
import { solveLp } from "./simplex";

/**
 * Unit pins for the LP engine itself, isolated from the board model. The
 * first system is the balanced-loop-with-lock shape that once broke it: a
 * degenerate artificial survived phase 1 in the basis (its row had gone
 * structurally zero but still had slack columns), phase 2 silently regrew it
 * from 0, and the "optimal" answer violated the lock row outright.
 */
describe("simplex on a negative-rhs lock row", () => {
  it("honors the lock while minimizing", () => {
    // Two acts tied through two flows, total act locked >= 2, minimize flow.
    // The only honest answer is both acts at 1 and both flows at 10.
    const lock = 2 - 1e-9;
    const result = solveLp({
      maximize: [0, 0, -1 / 1000, -1 / 1000],
      equalities: [
        { coefficients: new Map([[2, 0.1], [0, -1]]), rhs: 0 },
        { coefficients: new Map([[3, 0.1], [0, -1]]), rhs: 0 },
        { coefficients: new Map([[2, 0.1], [1, -1]]), rhs: 0 },
        { coefficients: new Map([[3, 0.1], [1, -1]]), rhs: 0 },
      ],
      upperBounds: [
        { coefficients: new Map([[0, 1]]), rhs: 1 },
        { coefficients: new Map([[1, 1]]), rhs: 1 },
        { coefficients: new Map([[0, -1], [1, -1]]), rhs: -lock },
      ],
    });
    expect(result.status).toBe("optimal");
    expect(result.x[0]).toBeCloseTo(1, 6);
    expect(result.x[1]).toBeCloseTo(1, 6);
    expect(result.x[2]).toBeCloseTo(10, 5);
  });

  it("reports a truly violated lock as infeasible", () => {
    const result = solveLp({
      maximize: [0],
      upperBounds: [
        { coefficients: new Map([[0, 1]]), rhs: 1 },
        { coefficients: new Map([[0, -1]]), rhs: -2 },
      ],
      equalities: [],
    });
    expect(result.status).toBe("infeasible");
  });

  it("maximizes a plain bounded system", () => {
    // max x0 + x1 with x0 <= 3, x1 <= 4, x0 + x1 <= 5.
    const result = solveLp({
      maximize: [1, 1],
      equalities: [],
      upperBounds: [
        { coefficients: new Map([[0, 1]]), rhs: 3 },
        { coefficients: new Map([[1, 1]]), rhs: 4 },
        { coefficients: new Map([[0, 1], [1, 1]]), rhs: 5 },
      ],
    });
    expect(result.status).toBe("optimal");
    expect(result.objective).toBeCloseTo(5, 9);
  });

  it("reports a genuinely unbounded objective", () => {
    const result = solveLp({
      maximize: [1],
      equalities: [],
      upperBounds: [{ coefficients: new Map([[0, -1]]), rhs: 0 }],
    });
    expect(result.status).toBe("unbounded");
  });
});
