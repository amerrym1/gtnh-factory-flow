/**
 * The power picker's search: a query matches a source by NAME, or by
 * anything the machine TAKES or MAKES under any single setting choice - so
 * "benzene" surfaces the Gas Turbine, the SOFCs and the XL Gas Turbine, and
 * picking one places the card with that setting already dialed in.
 *
 * The index is built once, lazily: every select option of every source is
 * computed with the other settings at their defaults, and each flow name it
 * introduces remembers the choice that produced it.
 */
import { resolvePowerResource } from "./planner-data";
import { POWER_SOURCES } from "./registry";
import { buildPowerSettingsReader, type PowerSourceDefinition } from "./types";

export interface PowerFlowMatch {
  direction: "takes" | "makes";
  /** The flow's display name, resolved through the resource map when known. */
  name: string;
  /** The choice that produces this flow; absent when the defaults already do. */
  settingId?: string;
  optionKey?: string;
}

export interface PowerSearchHit {
  source: PowerSourceDefinition;
  /** Set when the query matched a flow rather than the machine itself. */
  via?: PowerFlowMatch;
}

/**
 * The id the recipe search's stencil uses for its "makes power" condition.
 * Not a dataset resource: no recipe map answers it, so the recipe side of
 * the search naturally comes back empty and only generators respond.
 */
export const POWER_EU_CLAUSE_ID = "gtnh-power:eu";

export interface PowerStencilClause {
  role: "takes" | "makes";
  kind: string;
  id: string;
}

export interface PowerStencilHit {
  source: PowerSourceDefinition;
  /** Every dialed choice the matched clauses need, merged. */
  settings?: Record<string, string>;
  /** One entry per matched clause, for captions. */
  matches: PowerFlowMatch[];
}

interface SourceIndex {
  source: PowerSourceDefinition;
  nameText: string;
  /** lowercased flow name -> the first (most default) way to get it. */
  flows: Map<string, PowerFlowMatch>;
  /** "direction:kind:id" (resolved resource) -> same, for exact clause hits. */
  flowsById: Map<string, PowerFlowMatch>;
}

let indexCache: SourceIndex[] | undefined;

function flowDisplayName(rawName: string): string {
  return resolvePowerResource(rawName)?.displayName ?? rawName;
}

function recordFlows(
  entry: SourceIndex,
  model: { inputs: Array<{ name: string }>; outputs: Array<{ name: string }>; euPerTick: number },
  choice: { settingId?: string; optionKey?: string },
) {
  const record = (direction: "takes" | "makes", rawName: string) => {
    const name = flowDisplayName(rawName);
    const key = `${direction}:${name.toLowerCase()}`;
    if (!entry.flows.has(key)) {
      entry.flows.set(key, { direction, name, ...choice });
    }
    const resource = resolvePowerResource(rawName);
    if (resource) {
      const idKey = `${direction}:${resource.kind}:${resource.id}`;
      if (!entry.flowsById.has(idKey)) {
        entry.flowsById.set(idKey, { direction, name, ...choice });
      }
    }
  };
  for (const flow of model.inputs) {
    record("takes", flow.name);
  }
  for (const flow of model.outputs) {
    record("makes", flow.name);
  }
  if (model.euPerTick > 0) {
    const key = "makes:eu";
    if (!entry.flows.has(key)) {
      entry.flows.set(key, { direction: "makes", name: "EU", ...choice });
    }
    if (!entry.flowsById.has("makes:power:eu")) {
      entry.flowsById.set("makes:power:eu", { direction: "makes", name: "EU", ...choice });
    }
  } else if (model.euPerTick < 0) {
    // Parasitic machines DRINK power: they answer "what takes EU".
    if (!entry.flowsById.has("takes:power:eu")) {
      entry.flowsById.set("takes:power:eu", { direction: "takes", name: "EU", ...choice });
    }
  }
}

function buildIndex(): SourceIndex[] {
  return POWER_SOURCES.map((source) => {
    const entry: SourceIndex = {
      source,
      // Name and tier only - the blurbs NAME fuels ("burns benzene..."),
      // and a blurb match would swallow the flow match that knows which
      // setting to dial in.
      nameText: `${source.name} ${source.unlock ?? ""}`.toLowerCase(),
      flows: new Map(),
      flowsById: new Map(),
    };
    // Defaults first, so a fuel the card already burns wins over a dialed one.
    try {
      recordFlows(entry, source.compute(buildPowerSettingsReader(source, undefined)), {});
    } catch {
      // A source that cannot compute its defaults still lists by name.
    }
    for (const setting of source.settings) {
      if (setting.type !== "select") {
        continue;
      }
      for (const option of setting.options) {
        if (option.key === setting.defaultKey) {
          continue;
        }
        try {
          recordFlows(
            entry,
            source.compute(buildPowerSettingsReader(source, { [setting.id]: option.key })),
            { settingId: setting.id, optionKey: option.key },
          );
        } catch {
          // One bad option must not take the machine out of the index.
        }
      }
    }
    return entry;
  });
}

export function searchPowerSources(query: string): PowerSearchHit[] {
  const index = (indexCache ??= buildIndex());
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") {
    return index.map((entry) => ({ source: entry.source }));
  }

  const nameHits: PowerSearchHit[] = [];
  const flowHits: PowerSearchHit[] = [];
  for (const entry of index) {
    if (entry.nameText.includes(trimmed)) {
      nameHits.push({ source: entry.source });
      continue;
    }
    // The best flow match: a default-settings flow beats a dialed one, and
    // makes beats takes when both answer (players search for products).
    let best: PowerFlowMatch | undefined;
    for (const [key, match] of entry.flows) {
      if (!key.slice(key.indexOf(":") + 1).includes(trimmed)) {
        continue;
      }
      if (
        !best ||
        (best.settingId !== undefined && match.settingId === undefined) ||
        (best.direction === "takes" &&
          match.direction === "makes" &&
          (best.settingId === undefined) === (match.settingId === undefined))
      ) {
        best = match;
      }
    }
    if (best) {
      flowHits.push({ source: entry.source, via: best });
    }
  }
  return [...nameHits, ...flowHits];
}

/** The settings a hit should be placed with: the dialed choice, if any. */
export function hitPlacementSettings(hit: PowerSearchHit): Record<string, string> | undefined {
  if (hit.via?.settingId && hit.via.optionKey) {
    return { [hit.via.settingId]: hit.via.optionKey };
  }
  return undefined;
}

/** Does this picker query deserve the synthetic "Power (EU)" entry? */
export function queryAsksForPower(query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") {
    return true;
  }
  return "power".startsWith(trimmed) || "energy".startsWith(trimmed) || trimmed === "eu";
}

function clauseKey(clause: PowerStencilClause): string {
  if (clause.id === POWER_EU_CLAUSE_ID) {
    return `${clause.role}:power:eu`;
  }
  return `${clause.role}:${clause.kind}:${clause.id}`;
}

/**
 * The recipe search's view of the generators: a source answers the stencil
 * when its flows - under ANY single setting choice - satisfy each side's
 * conditions under that side's op (only reads as all; a generator's
 * housekeeping flows are not what "nothing else" is policing). The dialed
 * choices merge into the settings the card should be placed with; two
 * conditions that need the same knob at different positions cannot both be
 * true, so that source drops out. A name query narrows by machine name,
 * exactly as it narrows the recipes.
 */
export function searchPowerSourcesForStencil(
  clauses: PowerStencilClause[],
  takesOp: "any" | "all" | "only",
  makesOp: "any" | "all" | "only",
  query: string,
): PowerStencilHit[] {
  const index = (indexCache ??= buildIndex());
  const trimmed = query.trim().toLowerCase();

  if (clauses.length === 0) {
    // No conditions: only a typed name (or the power keyword) brings
    // generators into the recipe search.
    if (trimmed === "") {
      return [];
    }
    const wantsPower =
      trimmed.length >= 2 && ("power".startsWith(trimmed) || "energy".startsWith(trimmed));
    const hits: PowerStencilHit[] = [];
    for (const entry of index) {
      if (entry.nameText.includes(trimmed)) {
        hits.push({ source: entry.source, matches: [] });
      } else if ((wantsPower || trimmed === "eu") && entry.flowsById.has("makes:power:eu")) {
        hits.push({ source: entry.source, matches: [entry.flowsById.get("makes:power:eu")!] });
      }
    }
    return hits;
  }

  const sideOp = (role: "takes" | "makes") => (role === "takes" ? takesOp : makesOp);
  const hits: PowerStencilHit[] = [];
  for (const entry of index) {
    if (trimmed !== "" && !entry.nameText.includes(trimmed)) {
      continue;
    }
    const matches: PowerFlowMatch[] = [];
    const settings: Record<string, string> = {};
    let rejected = false;
    let matchedAny = false;
    for (const role of ["takes", "makes"] as const) {
      const side = clauses.filter((clause) => clause.role === role);
      if (side.length === 0) {
        continue;
      }
      const sideMatches = side.map((clause) => {
        const key = clauseKey(clause);
        return key ? entry.flowsById.get(key) : undefined;
      });
      const apply = (match: PowerFlowMatch): boolean => {
        if (match.settingId && match.optionKey) {
          const standing = settings[match.settingId];
          if (standing !== undefined && standing !== match.optionKey) {
            return false;
          }
          settings[match.settingId] = match.optionKey;
        }
        matches.push(match);
        return true;
      };
      if (sideOp(role) === "any") {
        // One condition is enough: take the best non-conflicting match,
        // an undialed flow before a dialed one.
        const candidates = sideMatches
          .filter((match): match is PowerFlowMatch => match !== undefined)
          .sort((a, b) => (a.settingId ? 1 : 0) - (b.settingId ? 1 : 0));
        const picked = candidates.find((match) => apply(match));
        if (!picked) {
          rejected = true;
          break;
        }
      } else {
        // all (and only, read as all): every condition must hold at once.
        if (sideMatches.some((match) => match === undefined)) {
          rejected = true;
          break;
        }
        for (const match of sideMatches) {
          if (!apply(match!)) {
            rejected = true;
            break;
          }
        }
        if (rejected) {
          break;
        }
      }
      matchedAny = true;
    }
    if (rejected || !matchedAny) {
      continue;
    }
    hits.push({
      source: entry.source,
      settings: Object.keys(settings).length > 0 ? settings : undefined,
      matches,
    });
  }
  // Ready-as-is machines first: a card that needs no dialing is the closer fit.
  return hits.sort((a, b) => (a.settings ? 1 : 0) - (b.settings ? 1 : 0));
}
