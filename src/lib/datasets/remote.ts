import { parseDatasetManifestJson } from "../import-export";
import type { DatasetManifest, DatasetVersion } from "./types";

export const DEFAULT_DATASET_MANIFEST_URL =
  process.env.NEXT_PUBLIC_GTNH_DATASET_MANIFEST_URL ?? "/datasets/gtnh/datasets.manifest.json";

export async function fetchDatasetManifest(
  manifestUrl = DEFAULT_DATASET_MANIFEST_URL,
): Promise<DatasetManifest> {
  const response = await fetch(withCacheBust(manifestUrl), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not load dataset manifest (${response.status}).`);
  }

  return parseDatasetManifestJson(await response.text());
}

/**
 * Dataset version ids hidden from the picker. 2.8.4 support is being
 * re-added, so nothing is hidden: a manifest listing a 2.8.4 dataset offers
 * it beside the 2.9 ones, and `pickDefaultDatasetVersion` still prefers the
 * manifest's `latestStableVersion` rather than manifest order.
 */
export const HIDDEN_DATASET_VERSION_IDS: ReadonlySet<string> = new Set();

export function listSelectableDatasetVersions(manifest: DatasetManifest): DatasetVersion[] {
  const selectable = manifest.versions.filter(
    (version) => !HIDDEN_DATASET_VERSION_IDS.has(version.id),
  );
  // A manifest holding only hidden versions still needs to offer something.
  return selectable.length > 0 ? selectable : manifest.versions;
}

export function pickDefaultDatasetVersion(manifest: DatasetManifest): DatasetVersion | undefined {
  const selectable = listSelectableDatasetVersions(manifest);
  const preferredId = manifest.latestStableVersion ?? manifest.latestDailyVersion;
  if (preferredId) {
    const preferred = selectable.find((version) => version.id === preferredId);
    if (preferred) {
      return preferred;
    }
  }

  return selectable[0];
}

function withCacheBust(url: string): string {
  const resolvedUrl = new URL(url, window.location.origin);
  resolvedUrl.searchParams.set("t", String(Date.now()));
  return resolvedUrl.toString();
}
