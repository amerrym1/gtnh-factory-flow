import { calculateThroughput } from "@/lib/solver";
import type { FactoryProject } from "@/lib/model/types";

/**
 * The solver, off the main thread. One message in (a plan and the content key
 * that names it), one message out (the same key and the finished books). The
 * scheduling - coalescing rapid edits, dropping superseded solves, deciding
 * which result is still current - all lives on the store side in
 * `solve-books.ts`; this file stays a dumb calculator on purpose.
 */
self.onmessage = (event: MessageEvent<{ key: string; project: FactoryProject }>) => {
  const { key, project } = event.data;
  try {
    self.postMessage({ key, result: calculateThroughput(project) });
  } catch (error) {
    self.postMessage({ key, error: error instanceof Error ? error.message : String(error) });
  }
};
