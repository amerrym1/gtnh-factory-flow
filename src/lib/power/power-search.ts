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

interface SourceIndex {
  source: PowerSourceDefinition;
  nameText: string;
  /** lowercased flow name -> the first (most default) way to get it. */
  flows: Map<string, PowerFlowMatch>;
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
  };
  for (const flow of model.inputs) {
    record("takes", flow.name);
  }
  for (const flow of model.outputs) {
    record("makes", flow.name);
  }
  if (model.euPerTick > 0) {
    record("makes", "EU");
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
