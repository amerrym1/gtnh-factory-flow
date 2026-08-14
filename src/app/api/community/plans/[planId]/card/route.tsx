import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { GT_TIER_COLORS } from "@/components/flow/tier-colors";
import type { PlanResourceStat } from "@/lib/community/types";
import { formatCompact } from "@/lib/model/resources";
import { getPublicPlanRow } from "@/lib/server/plan-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The card a shared plan link unfurls into: the summary bar's design at
 * Discord's 1200x630, drawn server-side from the plan's summary row. Same
 * palette, same words, same Monocraft - a link preview and an exported
 * image should be recognisably the same object.
 *
 * Rendered with next/og (satori), which lays out with flexbox only and no
 * cascade: every box says display:flex out loud, and text truncates by
 * clipping. Icons stay out - the atlas sprites the app uses are canvas
 * crops satori cannot make, and names with rates carry the meaning.
 */

const PLATE = "#131417";
const FRAME = "#2a2d33";
const TEXT = "#e8e9ec";
const SUBTLE = "#9aa1ab";
const MUTED = "#686f7a";
const BRAND = "#22d3ee";
const INPUT_ACCENT = "#f87171";
const INPUT_PANEL = "rgba(239,68,68,0.07)";
const INPUT_EDGE = "rgba(239,68,68,0.28)";
const OUTPUT_ACCENT = "#34d399";
const OUTPUT_PANEL = "rgba(52,211,153,0.07)";
const OUTPUT_EDGE = "rgba(52,211,153,0.28)";

const PANEL_ROW_LIMIT = 6;

/** Font files read once per server; satori wants raw ArrayBuffers. */
let fontsPromise: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> | undefined;

async function loadFonts() {
  fontsPromise ??= (async () => {
    const load = async (file: string) => {
      const buffer = await readFile(path.join(process.cwd(), "src", "app", "fonts", file));
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer;
    };
    const [regular, bold] = await Promise.all([
      load("Monocraft.ttf"),
      load("Monocraft-Bold.ttf"),
    ]);
    return { regular, bold };
  })();
  return fontsPromise;
}

function formatRate(stat: PlanResourceStat): string {
  return `${formatCompact(stat.ratePerSecond)}${stat.kind === "fluid" ? " L/s" : "/s"}`;
}

function IoPanel({
  label,
  accent,
  panel,
  edge,
  stats,
}: {
  label: string;
  accent: string;
  panel: string;
  edge: string;
  stats: PlanResourceStat[];
}) {
  const shown = stats.slice(0, PANEL_ROW_LIMIT);
  const rest = stats.length - shown.length;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        flexBasis: 0,
        backgroundColor: panel,
        border: `2px solid ${edge}`,
        borderRadius: 12,
        padding: "20px 24px",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", color: accent, fontSize: 22, fontWeight: 700 }}>{label}</div>
      {shown.length === 0 ? (
        <div style={{ display: "flex", color: MUTED, fontSize: 24 }}>Nothing</div>
      ) : (
        shown.map((stat, index) => (
          <div
            key={`${stat.kind}:${stat.resourceId}:${index}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              fontSize: 25,
            }}
          >
            <div
              style={{
                display: "flex",
                color: TEXT,
                maxWidth: 380,
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              {stat.displayName ?? stat.resourceId}
            </div>
            <div style={{ display: "flex", color: SUBTLE }}>{formatRate(stat)}</div>
          </div>
        ))
      )}
      {rest > 0 ? (
        <div style={{ display: "flex", color: MUTED, fontSize: 21 }}>+{rest} more</div>
      ) : null}
    </div>
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  const row = await getPublicPlanRow(planId);
  if (!row) {
    // The site's one generic face, rather than an error a chat would show
    // as a broken embed.
    return NextResponse.redirect(new URL("/opengraph-image.png", request.url), 302);
  }

  const fonts = await loadFonts();
  const tier = row.highest_tier
    ? GT_TIER_COLORS[row.highest_tier as keyof typeof GT_TIER_COLORS]
    : undefined;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: PLATE,
          border: `10px solid ${FRAME}`,
          padding: "40px 48px",
          fontFamily: "Monocraft",
          color: TEXT,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 40,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 52,
              fontWeight: 700,
              lineHeight: 1.15,
              maxWidth: 780,
              maxHeight: 122,
              overflow: "hidden",
            }}
          >
            {row.name}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 6,
              paddingTop: 8,
            }}
          >
            <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: BRAND }}>
              gtnhplanner.com
            </div>
            {row.game_version ? (
              <div style={{ display: "flex", fontSize: 21, color: MUTED }}>
                GTNH {row.game_version}
              </div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginTop: 18,
            fontSize: 24,
            color: SUBTLE,
          }}
        >
          <div style={{ display: "flex" }}>{row.machine_count} machines</div>
          <div style={{ display: "flex", color: MUTED }}>·</div>
          <div style={{ display: "flex" }}>{row.node_count} cards</div>
          {tier && row.highest_tier ? (
            <div
              style={{
                display: "flex",
                backgroundColor: tier.background,
                color: tier.text,
                border: `3px solid ${tier.border}`,
                padding: "1px 14px",
                fontSize: 21,
                fontWeight: 700,
              }}
            >
              {row.highest_tier}
            </div>
          ) : null}
          {row.author_name ? (
            <div style={{ display: "flex", color: MUTED }}>by {row.author_name}</div>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 22, marginTop: 26, flexGrow: 1 }}>
          <IoPanel
            label="INPUTS"
            accent={INPUT_ACCENT}
            panel={INPUT_PANEL}
            edge={INPUT_EDGE}
            stats={row.needs ?? []}
          />
          <IoPanel
            label="OUTPUTS"
            accent={OUTPUT_ACCENT}
            panel={OUTPUT_PANEL}
            edge={OUTPUT_EDGE}
            stats={row.outputs ?? []}
          />
        </div>

        <div style={{ display: "flex", marginTop: 24, fontSize: 21, color: MUTED }}>
          Open the link to see the whole board and make it your own.
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Monocraft", data: fonts.regular, weight: 400 as const, style: "normal" as const },
        { name: "Monocraft", data: fonts.bold, weight: 700 as const, style: "normal" as const },
      ],
      headers: {
        // Discord and friends cache aggressively anyway; an hour on the CDN
        // keeps a hot link from re-rendering the card per paste.
        "Cache-Control": "public, max-age=300, s-maxage=3600",
      },
    },
  );
}
