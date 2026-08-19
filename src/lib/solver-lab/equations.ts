import type { FactoryProject, ResourceKey } from "@/lib/model/types";
import { makeResourceKey } from "@/lib/model/resources";
import { getStorageRoles } from "@/lib/model/storage-role";
import { collectTrashNodeIds } from "@/lib/model/trash";
import { calculateThroughput } from "@/lib/solver/throughput";
import { getCompatibleOutputFlow, getEdgeTargetDemandKey } from "@/lib/solver/equilibrium";
import type { LinearProgram } from "./simplex";
import { solveLpHighs } from "./highs-lp";

/**
 * The equations prototype: a board's steady state solved directly as a
 * linear program, per docs/solver-equations.md. Conservation is a row, the
 * clog is an equals sign (an output wired only to machines may not make more
 * than its wires carry), and the answer is picked by a lexicographic chain
 * of solves rather than an iteration - so there are no rounds, no transients
 * and nothing to latch.
 *
 * Stages, locking each optimum before the next:
 *   1. Maximize what the factory is for: flow into PRODUCT drawers, each
 *      edge weighted to its producing port's nameplate so a litre line
 *      cannot outvote an ingot line.
 *   2. Least machinery: minimize total act. Byproduct drawers catch without
 *      motivating (today's doctrine) because only stage 1 pulls.
 *   3. Recycle before importing: minimize source-drawer outflow.
 *   4. Canonicalize: minimize total flow, one deterministic point.
 */

export interface EquationsResult {
  status: "optimal" | "infeasible" | "unbounded";
  utilization: Record<string, number>;
  edgeFlowPerSecond: Record<string, number>;
  sourcePullPerSecond: Record<string, number>;
  /** Ports whose equality has no wire variables: they force act to zero
   * (the closed-plan rule), listed so a surprise zero can be read. */
  unwiredPorts: string[];
}

interface PortRef {
  nodeId: string;
  key: ResourceKey;
  ratePerSecond: number;
}

export async function solveEquations(project: FactoryProject): Promise<EquationsResult> {
  const nameplates = calculateThroughput(project, { generatedAt: "equations" });
  const roles = getStorageRoles(project);
  const trashIds = collectTrashNodeIds(project);
  const storagesById = new Map((project.storages ?? []).map((s) => [s.id, s]));

  const machineIds: string[] = [];
  for (const node of project.nodes) {
    const report = nameplates.nodes[node.id];
    if (report && node.enabled && report.status !== "missing-recipe" && report.operationRatePerSecond > 0) {
      machineIds.push(node.id);
    }
  }
  const actVar = new Map<string, number>();
  machineIds.forEach((id, index) => actVar.set(id, index));

  const edges = [...project.edges].sort((a, b) => a.id.localeCompare(b.id));
  const flowVar = new Map<string, number>();
  const usable: typeof edges = [];

  // Resolve each wire end the way the solver does (oredict, effective keys).
  const outPort = (edge: (typeof edges)[number]): PortRef | undefined => {
    if (!actVar.has(edge.source)) {
      return undefined;
    }
    const flow = getCompatibleOutputFlow(nameplates.nodes[edge.source], edge);
    if (!flow) {
      return undefined;
    }
    return {
      nodeId: edge.source,
      key: makeResourceKey(flow.kind, flow.resourceId),
      ratePerSecond: flow.amountPerSecond,
    };
  };
  const inPort = (edge: (typeof edges)[number]): PortRef | undefined => {
    if (!actVar.has(edge.target)) {
      return undefined;
    }
    const key = getEdgeTargetDemandKey(project, edge);
    if (!key) {
      return undefined;
    }
    const flow = nameplates.nodes[edge.target]!.inputs[key];
    if (!flow) {
      return undefined;
    }
    return { nodeId: edge.target, key, ratePerSecond: flow.amountPerSecond };
  };

  type StorageKind = "source" | "sink" | "buffer" | "strict-buffer";
  const storageKind = (id: string): StorageKind | undefined => {
    if (trashIds.has(id)) {
      return "sink";
    }
    const storage = storagesById.get(id);
    if (!storage) {
      return undefined;
    }
    const role = roles.get(id);
    if (role === "source") {
      return "source";
    }
    if (role === "product" || role === "byproduct") {
      return "sink";
    }
    return storage.bufferMode === "strict" ? "strict-buffer" : "buffer";
  };

  for (const edge of edges) {
    const fromMachine = actVar.has(edge.source);
    const toMachine = actVar.has(edge.target);
    const fromKind = fromMachine ? "machine" : storageKind(edge.source);
    const toKind = toMachine ? "machine" : storageKind(edge.target);
    if (!fromKind || !toKind || fromKind === "sink" || toKind === "source") {
      continue;
    }
    if (fromMachine && !outPort(edge)) {
      continue;
    }
    if (toMachine && !inPort(edge)) {
      continue;
    }
    flowVar.set(edge.id, machineIds.length + usable.length);
    usable.push(edge);
  }

  // Overflow buffers get a fill variable per resource pool they hold.
  const bufferFillVar = new Map<string, number>();
  let nextVar = machineIds.length + usable.length;
  for (const storage of project.storages ?? []) {
    if (storageKind(storage.id) === "buffer") {
      bufferFillVar.set(storage.id, nextVar);
      nextVar += 1;
    }
  }
  const totalVars = nextVar;

  const unwiredPorts: string[] = [];
  const equalities: LinearProgram["equalities"] = [];
  const upperBounds: LinearProgram["upperBounds"] = [];
  /** Output-port rows, labeled: equalities in the real model (production is
   * TAKEN, the clog as algebra), individually relaxable by the choke probe. */
  const outputRows: Array<{ label: string; coefficients: Map<number, number> }> = [];

  // act stays a fraction of nameplate.
  for (const id of machineIds) {
    upperBounds.push({ coefficients: new Map([[actVar.get(id)!, 1]]), rhs: 1 });
  }

  // Machine port rows: flows on the port balance act x rate exactly. A port
  // with no wires therefore forces act to zero - the closed-plan rule "both
  // ends, or the machine does not run", inherited as algebra.
  for (const id of machineIds) {
    const report = nameplates.nodes[id]!;
    const portEdges = new Map<ResourceKey, { rate: number; vars: number[] }>();
    for (const [key, flow] of Object.entries(report.inputs)) {
      portEdges.set(key as ResourceKey, { rate: flow.amountPerSecond, vars: [] });
    }
    const outputs = new Map<ResourceKey, { rate: number; vars: number[] }>();
    for (const [key, flow] of Object.entries(report.outputs)) {
      outputs.set(key as ResourceKey, { rate: flow.amountPerSecond, vars: [] });
    }
    for (const edge of usable) {
      if (edge.target === id) {
        const port = inPort(edge);
        if (port) {
          portEdges.get(port.key)?.vars.push(flowVar.get(edge.id)!);
        }
      }
      if (edge.source === id) {
        const port = outPort(edge);
        if (port) {
          outputs.get(port.key)?.vars.push(flowVar.get(edge.id)!);
        }
      }
    }
    for (const [portKey, port] of portEdges) {
      if (port.vars.length === 0) unwiredPorts.push(`${id} in ${portKey}`);
      const scale = 1 / Math.max(1, port.rate);
      const coefficients = new Map<number, number>();
      for (const v of port.vars) {
        coefficients.set(v, scale);
      }
      coefficients.set(actVar.get(id)!, -port.rate * scale);
      equalities.push({ coefficients, rhs: 0 });
    }
    for (const [portKey, port] of outputs) {
      if (port.vars.length === 0) unwiredPorts.push(`${id} out ${portKey}`);
      const scale = 1 / Math.max(1, port.rate);
      const coefficients = new Map<number, number>();
      for (const v of port.vars) {
        coefficients.set(v, scale);
      }
      coefficients.set(actVar.get(id)!, -port.rate * scale);
      outputRows.push({ label: `${id} out ${portKey}`, coefficients });
    }
  }

  // Buffer pools: inflow equals outflow plus fill (fill fixed at zero for a
  // strict buffer, which is its whole meaning).
  for (const storage of project.storages ?? []) {
    const kind = storageKind(storage.id);
    if (kind !== "buffer" && kind !== "strict-buffer") {
      continue;
    }
    const coefficients = new Map<number, number>();
    let touched = false;
    let scaleBasis = 1;
    for (const edge of usable) {
      if (edge.target === storage.id) {
        coefficients.set(flowVar.get(edge.id)!, 1);
        touched = true;
      }
      if (edge.source === storage.id) {
        coefficients.set(flowVar.get(edge.id)!, -1);
        touched = true;
      }
    }
    if (!touched) {
      continue;
    }
    for (const edge of usable) {
      if (edge.target === storage.id || edge.source === storage.id) {
        const port = actVar.has(edge.source) ? outPort(edge) : actVar.has(edge.target) ? inPort(edge) : undefined;
        if (port) {
          scaleBasis = Math.max(scaleBasis, port.ratePerSecond);
        }
      }
    }
    const scale = 1 / scaleBasis;
    for (const [v, value] of coefficients) {
      coefficients.set(v, value * scale);
    }
    if (kind === "buffer") {
      coefficients.set(bufferFillVar.get(storage.id)!, -scale);
    }
    equalities.push({ coefficients, rhs: 0 });
  }

  const withOutputRows = (mode: "all" | "none" | { dropIndex: number }): {
    eq: LinearProgram["equalities"];
    ub: LinearProgram["upperBounds"];
  } => {
    const eq = [...equalities];
    const ub = [...upperBounds];
    outputRows.forEach((row, index) => {
      const relaxed = mode === "none" || (typeof mode === "object" && mode.dropIndex === index);
      if (relaxed) {
        ub.push({ coefficients: row.coefficients, rhs: 0 });
      } else {
        eq.push({ coefficients: row.coefficients, rhs: 0 });
      }
    });
    return { eq, ub };
  };

  if (typeof process !== "undefined" && process.env?.EQ_FIND_CHOKE) {
    // Drop one output equality at a time (relax it to <=): a row whose
    // removal revives the board sits inside every contradiction.
    const maxAct = async (rows: ReturnType<typeof withOutputRows>): Promise<number> => {
      const maximize = new Array<number>(totalVars).fill(0);
      for (const id of machineIds) maximize[actVar.get(id)!] = 1;
      const r = await solveLpHighs({ maximize, equalities: rows.eq, upperBounds: rows.ub });
      return r.status === "optimal" ? r.objective : Number.NaN;
    };
    const open = await maxAct(withOutputRows("none"));
    const closed = await maxAct(withOutputRows("all"));
    console.log(`choke probe: relaxed maxAct=${open.toFixed(4)}, all-equal maxAct=${closed.toFixed(4)}`);
    for (const [index, row] of outputRows.entries()) {
      const value = await maxAct(withOutputRows({ dropIndex: index }));
      if (value > closed + 0.05) {
        console.log(`  dropping ${row.label} -> maxAct=${value.toFixed(4)}`);
      }
    }
  }

  // The stage chain. Each stage locks its optimum as a one-sided row before
  // the next runs.
  const stages: Array<Map<number, number>> = [];

  const productPull = new Map<number, number>();
  for (const edge of usable) {
    if (storageKind(edge.target) !== "sink") {
      continue;
    }
    const role = roles.get(edge.target);
    if (role !== "product") {
      continue;
    }
    const port = outPort(edge);
    const weight = 1 / Math.max(1, port?.ratePerSecond ?? 1);
    productPull.set(flowVar.get(edge.id)!, (productPull.get(flowVar.get(edge.id)!) ?? 0) + weight);
  }
  stages.push(productPull);

  const leastMachinery = new Map<number, number>();
  for (const id of machineIds) {
    leastMachinery.set(actVar.get(id)!, -1);
  }
  stages.push(leastMachinery);

  const leastImports = new Map<number, number>();
  for (const edge of usable) {
    if (storageKind(edge.source) === "source") {
      const port = inPort(edge);
      const weight = 1 / Math.max(1, port?.ratePerSecond ?? 1);
      leastImports.set(flowVar.get(edge.id)!, -(weight));
    }
  }
  stages.push(leastImports);

  const leastFlow = new Map<number, number>();
  for (const edge of usable) {
    leastFlow.set(flowVar.get(edge.id)!, -(1 / 1000));
  }
  stages.push(leastFlow);

  const model = withOutputRows(
    typeof process !== "undefined" && process.env?.EQ_RELAX_OUTPUTS ? "none" : "all",
  );
  let solution: Awaited<ReturnType<typeof solveLpHighs>> | undefined;
  for (const stage of stages) {
    if (stage.size === 0) {
      continue;
    }
    const maximize = new Array<number>(totalVars).fill(0);
    for (const [v, weight] of stage) {
      maximize[v] = weight;
    }
    solution = await solveLpHighs({ maximize, equalities: model.eq, upperBounds: model.ub });
    if (typeof process !== "undefined" && process.env?.EQ_DEBUG) {
      console.log(
        `stage ${stages.indexOf(stage)}: ${solution.status} objective=${solution.objective?.toFixed(6)} terms=${stage.size}`,
      );
    }
    if (solution.status !== "optimal") {
      return { status: solution.status, utilization: {}, edgeFlowPerSecond: {}, sourcePullPerSecond: {}, unwiredPorts };
    }
    // Lock: this stage's value may not degrade while later stages tie-break.
    const lock = new Map<number, number>();
    for (const [v, weight] of stage) {
      lock.set(v, -weight);
    }
    model.ub.push({ coefficients: lock, rhs: -solution.objective + 1e-7 });
  }

  const x = solution?.x ?? new Array<number>(totalVars).fill(0);
  const utilization: Record<string, number> = {};
  for (const id of machineIds) {
    utilization[id] = Math.min(1, Math.max(0, x[actVar.get(id)!] ?? 0));
  }
  const edgeFlowPerSecond: Record<string, number> = {};
  for (const edge of usable) {
    edgeFlowPerSecond[edge.id] = Math.max(0, x[flowVar.get(edge.id)!] ?? 0);
  }
  const sourcePullPerSecond: Record<string, number> = {};
  for (const edge of usable) {
    if (storageKind(edge.source) === "source") {
      sourcePullPerSecond[edge.source] =
        (sourcePullPerSecond[edge.source] ?? 0) + (edgeFlowPerSecond[edge.id] ?? 0);
    }
  }
  return { status: "optimal", utilization, edgeFlowPerSecond, sourcePullPerSecond, unwiredPorts };
}
