import { getCommunityDb, isCommunityConfigured } from "@/lib/server/community";

/**
 * What the community actually builds: a per-resource popularity score
 * aggregated over every public shared setup.
 *
 * The formula, per plan (each plan votes once per resource, so one giant
 * board cannot stuff the ballot):
 *   +2  the plan MAKES it (it is an output of a recipe some card runs),
 *   else +1 if it only USES it (an input of such a recipe, or a drawer);
 *       the stronger role wins, they do not stack
 *   +log10(1 + rate) the plan SHIPS it (the row's denormalized boundary
 *       outputs carry real items/s / L/s; log so a quarry pumping 10,000 L/s
 *       of steam counts more than a trickle but cannot drown everything else)
 * Every plan weighs the same. Weighting by votes or views would just make
 * the front page vote twice.
 *
 * Keys are `${kind}:${id}`, the same shape the dataset catalog uses, so the
 * resources route can look straight up. Cached in-process for half an hour;
 * with Supabase unconfigured (local dev) the map is empty and the sort
 * degrades to best match's order.
 */

const CACHE_TTL_MS = 30 * 60 * 1000;
const PAGE_SIZE = 40;
const MAX_PLANS = 1000;

let cache: { at: number; map: Map<string, number> } | undefined;
let inFlight: Promise<Map<string, number>> | undefined;

export async function getResourcePopularity(): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.map;
  }
  if (!inFlight) {
    inFlight = buildPopularityMap()
      .then((map) => {
        cache = { at: Date.now(), map };
        return map;
      })
      .catch((error) => {
        console.error("resource popularity aggregation failed", error);
        // A failed sweep should not hammer the database on every keystroke.
        const stale = cache?.map ?? new Map<string, number>();
        cache = { at: Date.now(), map: stale };
        return stale;
      })
      .finally(() => {
        inFlight = undefined;
      });
  }
  return inFlight;
}

async function buildPopularityMap(): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (!isCommunityConfigured()) {
    return totals;
  }
  const db = getCommunityDb();

  for (let offset = 0; offset < MAX_PLANS; offset += PAGE_SIZE) {
    const { data, error } = await db
      .from("community_plans")
      .select("id, plan, outputs")
      .or("is_public.eq.true,is_public.is.null")
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw new Error(error.message);
    }
    for (const row of data ?? []) {
      const votes = scoreOnePlan(row.plan, row.outputs);
      for (const [key, score] of votes) {
        totals.set(key, (totals.get(key) ?? 0) + score);
      }
    }
    if (!data || data.length < PAGE_SIZE) {
      break;
    }
  }
  return totals;
}

/** The stored jsonb is untrusted history; read it defensively, field by field. */
function scoreOnePlan(plan: unknown, outputs: unknown): Map<string, number> {
  const votes = new Map<string, number>();
  const vote = (key: string | undefined, score: number) => {
    if (key) {
      votes.set(key, Math.max(votes.get(key) ?? 0, score));
    }
  };

  if (plan && typeof plan === "object") {
    const project = plan as {
      recipes?: unknown;
      nodes?: unknown;
      storages?: unknown;
    };
    // Only recipes a card actually runs count; the plan's recipe store can
    // carry leftovers nothing references.
    const usedRecipeIds = new Set<string>();
    if (Array.isArray(project.nodes)) {
      for (const node of project.nodes) {
        const recipeId = (node as { recipeId?: unknown })?.recipeId;
        if (typeof recipeId === "string") {
          usedRecipeIds.add(recipeId);
        }
      }
    }
    if (Array.isArray(project.recipes)) {
      for (const recipe of project.recipes) {
        const entry = recipe as { id?: unknown; inputs?: unknown; outputs?: unknown };
        if (typeof entry.id !== "string" || !usedRecipeIds.has(entry.id)) {
          continue;
        }
        if (Array.isArray(entry.outputs)) {
          for (const output of entry.outputs) {
            vote(resourceKey(output), MADE_SCORE);
          }
        }
        if (Array.isArray(entry.inputs)) {
          for (const input of entry.inputs) {
            vote(resourceKey(input), USED_SCORE);
          }
        }
      }
    }
    if (Array.isArray(project.storages)) {
      for (const storage of project.storages) {
        const entry = storage as { kind?: unknown; resourceId?: unknown };
        if (typeof entry.kind === "string" && typeof entry.resourceId === "string") {
          vote(`${entry.kind}:${entry.resourceId}`, USED_SCORE);
        }
      }
    }
  }

  // Boundary output rates ride on top of the appearance vote.
  if (Array.isArray(outputs)) {
    for (const stat of outputs) {
      const entry = stat as { kind?: unknown; resourceId?: unknown; ratePerSecond?: unknown };
      if (
        typeof entry.kind === "string" &&
        typeof entry.resourceId === "string" &&
        typeof entry.ratePerSecond === "number" &&
        entry.ratePerSecond > 0
      ) {
        const key = `${entry.kind}:${entry.resourceId}`;
        votes.set(key, (votes.get(key) ?? 0) + Math.log10(1 + entry.ratePerSecond));
      }
    }
  }
  return votes;
}

const MADE_SCORE = 2;
const USED_SCORE = 1;

function resourceKey(resource: unknown): string | undefined {
  const entry = resource as { kind?: unknown; id?: unknown };
  return typeof entry?.kind === "string" && typeof entry?.id === "string"
    ? `${entry.kind}:${entry.id}`
    : undefined;
}
