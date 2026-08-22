import { useEffect, useState } from "react";
import { ENERGY_HATCH_TYPES } from "@/lib/machines/energy-hatches";
import type { ResourceIconAtlasRef } from "@/lib/model/types";

export interface EnergyHatchIcon {
  iconPath?: string;
  iconAtlas?: ResourceIconAtlasRef;
  dominantColor?: string;
  displayName?: string;
}

/**
 * The hatch items' real art, fetched once per dataset from the resources API
 * and shared by every card. The client dataset only carries resources the
 * loaded recipes touch, and no plan's recipes reference the energy hatches
 * themselves, so their icons are never on board - this asks the server the
 * same question the item browser would.
 *
 * One in-flight promise per dataset id: the first card to mount pays the 13
 * small queries, everyone else awaits the same map. A failed lookup leaves
 * its type without art and the config slot falls back to its lettered
 * placeholder, which is the pre-fetch behaviour.
 */
const iconCache = new Map<string, Map<string, EnergyHatchIcon>>();
const inFlight = new Map<string, Promise<Map<string, EnergyHatchIcon>>>();

async function fetchIcons(datasetVersionId: string): Promise<Map<string, EnergyHatchIcon>> {
  const icons = new Map<string, EnergyHatchIcon>();
  await Promise.all(
    ENERGY_HATCH_TYPES.map(async (type) => {
      try {
        const url =
          `/api/datasets/${encodeURIComponent(datasetVersionId)}/resources` +
          `?query=${encodeURIComponent(type.label)}&kind=item&limit=24`;
        const response = await fetch(url);
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as {
          resources?: Array<EnergyHatchIcon & { id?: string }>;
        };
        // The id is the anchor; the display-name query is only how the index
        // is asked (the two biggest lasers write their rating as "A/t").
        const hit = (data.resources ?? []).find((entry) => entry.id === type.resourceId);
        if (hit && (hit.iconPath || hit.iconAtlas)) {
          icons.set(type.id, hit);
        }
      } catch {
        // Offline or a failed shard: the placeholder art stands.
      }
    }),
  );
  return icons;
}

export function useEnergyHatchIcons(
  datasetVersionId: string | undefined,
): Map<string, EnergyHatchIcon> {
  const [icons, setIcons] = useState<Map<string, EnergyHatchIcon>>(
    () => (datasetVersionId && iconCache.get(datasetVersionId)) || new Map(),
  );

  useEffect(() => {
    if (!datasetVersionId) {
      return;
    }
    const cached = iconCache.get(datasetVersionId);
    if (cached) {
      setIcons(cached);
      return;
    }
    let cancelled = false;
    const pending =
      inFlight.get(datasetVersionId) ??
      (() => {
        const promise = fetchIcons(datasetVersionId).then((map) => {
          iconCache.set(datasetVersionId, map);
          inFlight.delete(datasetVersionId);
          return map;
        });
        inFlight.set(datasetVersionId, promise);
        return promise;
      })();
    void pending.then((map) => {
      if (!cancelled) {
        setIcons(map);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [datasetVersionId]);

  return icons;
}
