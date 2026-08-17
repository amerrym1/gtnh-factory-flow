import type { PlanResourceStat } from "@/lib/community/types";
import {
  getCommunityDb,
  isCommunityConfigured,
  PLAN_SUMMARY_COLUMNS,
  type PlanRow,
} from "./community";

/**
 * What a shared link is allowed to tell a stranger's chat window.
 *
 * A crawler carries no session, so only PUBLIC plans get a face: an unlisted
 * post must not leak its name, numbers or resources into an embed. Everything
 * here reads the summary row alone - never the plan JSON - because unfurling
 * a link must stay cheap enough to happen on every paste.
 */

/**
 * Where the share flow puts each post's board photograph, one object per
 * plan named `<planId>.png`. Deliberately not a table column: the object
 * name is derived from the id the card route already holds, so an old row
 * simply has no object and the card falls back to its icon face.
 */
export const PLAN_PREVIEW_BUCKET = "plan-previews";

/** The plan's stored board photograph, or undefined when none was uploaded. */
export async function getPlanPreviewPng(planId: string): Promise<Buffer | undefined> {
  if (!isCommunityConfigured()) {
    return undefined;
  }
  try {
    const { data, error } = await getCommunityDb()
      .storage.from(PLAN_PREVIEW_BUCKET)
      .download(`${planId}.png`);
    if (error || !data) {
      return undefined;
    }
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return undefined;
  }
}
export async function getPublicPlanRow(planId: string): Promise<PlanRow | undefined> {
  if (!planId || !isCommunityConfigured()) {
    return undefined;
  }

  try {
    const { data, error } = await getCommunityDb()
      .from("community_plans")
      .select(PLAN_SUMMARY_COLUMNS)
      .eq("id", planId)
      .single<PlanRow>();
    if (error || !data || data.is_public === false) {
      return undefined;
    }
    return data;
  } catch {
    return undefined;
  }
}

function nameList(stats: PlanResourceStat[], limit = 3): string {
  const names = stats.map((stat) => stat.displayName ?? stat.resourceId);
  const shown = names.slice(0, limit);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

/**
 * The embed's one paragraph: the author's own words when they wrote any,
 * otherwise the plan's numbers as a sentence.
 */
export function describePlanRow(row: PlanRow): string {
  const description = row.description?.trim();
  if (description) {
    return description.length > 200 ? `${description.slice(0, 199).trimEnd()}...` : description;
  }

  const parts: string[] = [
    `${row.machine_count} machines${row.highest_tier ? ` up to ${row.highest_tier}` : ""}${
      row.author_name ? `, by ${row.author_name}` : ""
    }.`,
  ];
  if (row.needs?.length) {
    parts.push(`Needs ${nameList(row.needs)}.`);
  }
  if (row.outputs?.length) {
    parts.push(`Makes ${nameList(row.outputs)}.`);
  }
  if (row.game_version) {
    parts.push(`GTNH ${row.game_version}.`);
  }
  return parts.join(" ");
}
