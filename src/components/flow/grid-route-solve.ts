import {
  solveGridRoutes,
  type GridEndpoint,
  type GridObstacle,
  type GridPoint,
  type GridRouteRequest,
  type GridSide,
} from "./grid-edge-router";

/**
 * The wire solve, off the main thread.
 *
 * The grid router is a pure function of published geometry, which makes it
 * a natural worker job - and on a big board it has to be one. Routing runs
 * inside the edge components' render, so a solve that takes half a second
 * is half a second in which nothing on the page moves: no drag frame, no
 * typed digit, no hover. The board therefore posts any solve past
 * `ASYNC_ROUTE_EDGE_LIMIT` wires here and keeps drawing the routes it
 * already has until the answer lands (`FactoryFlow.tsx` installs it and
 * re-issues the edges). Same inputs, same pure function, same routes as the
 * synchronous path - only the thread differs, so the routing invariant in
 * ARCHITECTURE.md (routes depend on flow-space geometry alone) still holds.
 *
 * Scheduling is the same shape as `solve-books.ts`: one job in flight, and
 * only the NEWEST waiting job kept, because a drag publishes a fresh
 * geometry several times a second and every intermediate one is already
 * superseded by the time the worker is free. Results carry a sequence
 * number so the board can tell a late answer from a current one.
 */

/** Boards past this many wires route in the worker instead of in render. */
export const ASYNC_ROUTE_EDGE_LIMIT = 60;

export interface RouteSolveJob {
  /** The board's own routing signature, echoed back with the answer. */
  signature: string;
  /** Monotonic; a result for a lower number than the last install is stale. */
  seq: number;
  obstacles: GridObstacle[];
  requests: GridRouteRequest[];
}

export interface RouteSolveResult {
  signature: string;
  seq: number;
  routes: Array<{ edgeId: string; order: number; points: GridPoint[] }>;
  solveMs: number;
}

/**
 * The job on the wire. Every request carries the whole perimeter of both
 * its cards as candidate docks - fifty-odd endpoints per wire, so a big
 * board is a hundred thousand small objects, and structured-cloning those
 * costs the main thread more than the solve is worth. Endpoints ride as one
 * flat Float64Array instead (five numbers each), which transfers in
 * constant time; everything else is small and clones as it is.
 */
export interface EncodedRouteSolveJob {
  signature: string;
  seq: number;
  obstacles: GridObstacle[];
  edges: Array<{
    edgeId: string;
    order: number;
    strokeWidth: number;
    sourceCount: number;
    targetCount: number;
    waypoints?: GridPoint[];
    exemptObstacleIds?: readonly string[];
    homeObstacleIds?: readonly string[];
  }>;
  endpoints: Float64Array;
}

const SIDES: readonly GridSide[] = ["left", "right", "top", "bottom"];
const ENDPOINT_STRIDE = 5;

export function encodeRouteSolveJob(job: RouteSolveJob): EncodedRouteSolveJob {
  let count = 0;
  for (const request of job.requests) {
    count += request.sources.length + request.targets.length;
  }
  const endpoints = new Float64Array(count * ENDPOINT_STRIDE);
  let offset = 0;
  const write = (endpoint: GridEndpoint) => {
    endpoints[offset] = endpoint.x;
    endpoints[offset + 1] = endpoint.y;
    endpoints[offset + 2] = SIDES.indexOf(endpoint.side);
    endpoints[offset + 3] = endpoint.penalty ?? Number.NaN;
    endpoints[offset + 4] = endpoint.stubDepth ?? Number.NaN;
    offset += ENDPOINT_STRIDE;
  };
  const edges: EncodedRouteSolveJob["edges"] = [];
  for (const request of job.requests) {
    for (const endpoint of request.sources) {
      write(endpoint);
    }
    for (const endpoint of request.targets) {
      write(endpoint);
    }
    edges.push({
      edgeId: request.edgeId,
      order: request.order,
      strokeWidth: request.strokeWidth,
      sourceCount: request.sources.length,
      targetCount: request.targets.length,
      waypoints: request.waypoints,
      exemptObstacleIds: request.exemptObstacleIds,
      homeObstacleIds: request.homeObstacleIds,
    });
  }
  return { signature: job.signature, seq: job.seq, obstacles: job.obstacles, edges, endpoints };
}

export function decodeRouteSolveJob(encoded: EncodedRouteSolveJob): RouteSolveJob {
  const { endpoints } = encoded;
  let offset = 0;
  const read = (): GridEndpoint => {
    const endpoint: GridEndpoint = {
      x: endpoints[offset],
      y: endpoints[offset + 1],
      side: SIDES[endpoints[offset + 2]] ?? "left",
    };
    const penalty = endpoints[offset + 3];
    if (!Number.isNaN(penalty)) {
      endpoint.penalty = penalty;
    }
    const stubDepth = endpoints[offset + 4];
    if (!Number.isNaN(stubDepth)) {
      endpoint.stubDepth = stubDepth;
    }
    offset += ENDPOINT_STRIDE;
    return endpoint;
  };
  const requests: GridRouteRequest[] = encoded.edges.map((edge) => {
    const sources: GridEndpoint[] = [];
    for (let i = 0; i < edge.sourceCount; i += 1) {
      sources.push(read());
    }
    const targets: GridEndpoint[] = [];
    for (let i = 0; i < edge.targetCount; i += 1) {
      targets.push(read());
    }
    return {
      edgeId: edge.edgeId,
      order: edge.order,
      sources,
      targets,
      strokeWidth: edge.strokeWidth,
      waypoints: edge.waypoints,
      exemptObstacleIds: edge.exemptObstacleIds,
      homeObstacleIds: edge.homeObstacleIds,
    };
  });
  return {
    signature: encoded.signature,
    seq: encoded.seq,
    obstacles: encoded.obstacles,
    requests,
  };
}

/** Runs the job right here; the worker and the fallback both call this. */
export function runRouteSolveJob(job: RouteSolveJob): RouteSolveResult {
  const started = performance.now();
  const solved = solveGridRoutes(job.obstacles, job.requests);
  const orderByEdge = new Map(job.requests.map((request) => [request.edgeId, request.order]));
  const routes: RouteSolveResult["routes"] = [];
  for (const [edgeId, routed] of solved) {
    routes.push({ edgeId, order: orderByEdge.get(edgeId) ?? 0, points: routed.points });
  }
  return { signature: job.signature, seq: job.seq, routes, solveMs: performance.now() - started };
}

type RouteSolveSink = (result: RouteSolveResult) => void;

let worker: Worker | undefined;
let workerBroken = false;
let inFlight: RouteSolveJob | undefined;
let queued: RouteSolveJob | undefined;
let sink: RouteSolveSink | undefined;
let lastSolveDurationMs: number | undefined;

/** Whether a solve can leave the main thread at all (no Worker in SSR/tests). */
export function routeWorkerAvailable(): boolean {
  return !workerBroken && typeof Worker !== "undefined";
}

/** How long the last worker solve took, for anyone deciding what to follow. */
export function lastRouteSolveDurationMs(): number | undefined {
  return lastSolveDurationMs;
}

/** Where finished routes go. One board at a time, like every route cache. */
export function setRouteSolveSink(next: RouteSolveSink | undefined) {
  sink = next;
}

/**
 * Posts a job, or parks it behind the one running. A parked job replaces
 * any job parked before it: geometry that has already changed again is not
 * worth solving.
 */
export function scheduleRouteSolve(job: RouteSolveJob) {
  if (inFlight) {
    queued = job;
    return;
  }
  inFlight = job;
  try {
    const encoded = encodeRouteSolveJob(job);
    getWorker().postMessage(encoded, [encoded.endpoints.buffer]);
  } catch (error) {
    console.error("route worker failed to start; routing on the main thread", error);
    workerBroken = true;
    inFlight = undefined;
    sink?.(runRouteSolveJob(job));
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./grid-route.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<RouteSolveResult | { error: string }>) => {
      inFlight = undefined;
      if ("routes" in event.data) {
        lastSolveDurationMs = event.data.solveMs;
        sink?.(event.data);
      } else {
        console.error("route worker error:", event.data.error);
      }
      if (queued) {
        const next = queued;
        queued = undefined;
        scheduleRouteSolve(next);
      }
    };
    worker.onerror = (event) => {
      // A worker that cannot run its script would leave every wire on its
      // old route forever; finish the outstanding job here instead.
      console.error("route worker broke; routing on the main thread", event.message);
      workerBroken = true;
      const retry = queued ?? inFlight;
      inFlight = undefined;
      queued = undefined;
      if (retry) {
        sink?.(runRouteSolveJob(retry));
      }
    };
  }
  return worker;
}
