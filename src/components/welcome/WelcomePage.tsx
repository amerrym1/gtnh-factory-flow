"use client";

import {
  ArrowRight,
  Download,
  Factory,
  Plus,
  ScrollText,
  Search,
  Sparkles,
  ThumbsUp,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ChangelogDialog } from "@/components/ChangelogDialog";
import { GlanceRows, type GlanceRow } from "@/components/help/card-parts";
import { FLUID_ICON_SCALE, ResourceIcon } from "@/components/nei/ResourceIcon";
import { CHANGELOG } from "@/lib/changelog";
import {
  downloadCommunityPlan,
  listCommunityPlans,
  tagPlanWithCommunityId,
} from "@/lib/community/client";
import type { CommunityPlanSummary } from "@/lib/community/types";
import { parseFactoryProjectJson } from "@/lib/import-export";
import type { EntryIcon } from "@/lib/model/types";
import { applyPlanView } from "@/lib/plan-view";
import { openSetupsTab } from "@/lib/setups-tab";
import { openSidebarTab } from "@/lib/sidebar-tab";
import { APP_VERSION } from "@/lib/version";
import { leaveWelcomeTab, setWelcomeOnStartup, useWelcomeTab } from "@/lib/welcome/welcome-tab";
import { writeWorkspaceView } from "@/lib/workspace-view";
import { useDesignStore } from "@/store/design-store";
import { WelcomeBackdrop } from "./WelcomeBackdrop";

/**
 * The Welcome tab: the first thing a visitor sees, and the place a regular
 * comes back to for their designs and the community's.
 *
 * It COVERS the board (see FactoryPlannerApp) rather than replacing it, over
 * a living backdrop of ghost cards and wires. The content is one column:
 * the name and the two ways to start, then your designs, then the community
 * shelf, then what changed last release. Every pick steps off the tab, and
 * the checkbox at the foot is how a regular stops arriving here.
 */

const THREE_MOVES: GlanceRow[] = [
  { mouse: "left", text: "Click any item for *what makes it*, right click for *what uses it*" },
  { mouse: "left", text: "Drag a slot on a card to *wire it* to another" },
  { mouse: "left", text: "Drop the wire on empty board for *a drawer*" },
];

const COMMUNITY_TILE_COUNT = 6;

export function WelcomePage() {
  const welcome = useWelcomeTab();
  const addDesign = useDesignStore((state) => state.addDesign);
  const [isChangelogOpen, setChangelogOpen] = useState(false);
  const latest = CHANGELOG[0];

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-canvas text-fg">
      <WelcomeBackdrop />
      {/* A dark wash under the words so the backdrop stays a backdrop; the
          edges are left clear so the animation shows through on both sides
          of the column. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 70% at 50% 40%, rgba(16,20,25,0.92) 0%, rgba(16,20,25,0.7) 55%, rgba(16,20,25,0.15) 100%)",
        }}
      />
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-10 px-6 pb-10 pt-12 compact:px-4 compact:pt-8">
          <header className="flex flex-col items-start gap-5">
            <div className="flex items-baseline gap-3">
              <h1 className="text-[40px] font-black leading-none tracking-tight text-white compact:text-[30px]">
                <span className="text-cyan-300">GTNH</span> Planner
              </h1>
              <span className="rounded border border-line-strong px-1.5 py-0.5 text-[11px] text-fg-muted">
                v{APP_VERSION}
              </span>
            </div>
            <p className="max-w-[560px] text-[15px] leading-relaxed text-fg-subtle">
              Draw a GregTech: New Horizons factory as a flowchart. Every card is a
              real recipe, every wire carries a real rate, and the board tells you
              what starves, what clogs and what to build.
            </p>
            <div className="flex flex-wrap gap-3">
              <PrimaryButton
                icon={Plus}
                onClick={() => {
                  void addDesign();
                }}
              >
                New design
              </PrimaryButton>
              <SecondaryButton
                icon={Factory}
                onClick={() => {
                  // The shelf lives in the left column, beside this page, so
                  // this stays on the tab: both calls survive the column being
                  // shut, and the second lands the shelf on Public.
                  writeWorkspaceView({ leftPanelOpen: true });
                  openSidebarTab("setups");
                  openSetupsTab("network");
                }}
              >
                Browse shared setups
              </SecondaryButton>
              <SecondaryButton
                icon={Search}
                onClick={() => {
                  writeWorkspaceView({ leftPanelOpen: true });
                  openSidebarTab("items");
                }}
              >
                Find an item
              </SecondaryButton>
            </div>
          </header>

          <section className="grid gap-3 rounded border border-line bg-[#151a21]/80 px-4 py-3">
            <SectionTitle>Three moves and you know the board</SectionTitle>
            <GlanceRows rows={THREE_MOVES} />
          </section>

          <YourDesigns />

          <CommunityShelf />

          {latest ? (
            <section className="flex flex-col gap-2">
              <SectionTitle>
                <Sparkles className="h-3.5 w-3.5 text-cyan-300" aria-hidden />
                New in {latest.version}
              </SectionTitle>
              <div className="rounded border border-line bg-[#151a21]/80 px-4 py-3">
                <p className="text-[14px] font-bold text-white">{latest.headline}</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {latest.notes.slice(0, 3).map((note) => (
                    <li key={note} className="flex gap-2 text-[13px] leading-relaxed text-fg-muted">
                      <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-cyan-400" />
                      <span>{note.replace(/\*/g, "")}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setChangelogOpen(true)}
                  className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-cyan-300 hover:text-cyan-200"
                >
                  <ScrollText className="h-3.5 w-3.5" aria-hidden />
                  All release notes
                </button>
              </div>
            </section>
          ) : null}

          <footer className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] text-fg-muted hover:text-fg">
              <input
                type="checkbox"
                checked={welcome.showOnStartup}
                onChange={(event) => setWelcomeOnStartup(event.target.checked)}
                className="h-3.5 w-3.5 accent-cyan-400"
              />
              Open on this tab when I arrive
            </label>
            <button
              type="button"
              onClick={leaveWelcomeTab}
              className="inline-flex items-center gap-1.5 text-[12px] font-bold text-fg-muted hover:text-fg"
            >
              To the board
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </footer>
        </div>
      </div>
      {isChangelogOpen ? <ChangelogDialog onClose={() => setChangelogOpen(false)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-[#aebccd]">
      {children}
    </h2>
  );
}

function PrimaryButton({
  icon: Icon,
  onClick,
  children,
}: {
  icon: typeof Plus;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center gap-2 border-2 border-cyan-300 bg-cyan-400 px-4 text-[13px] font-black text-[#062026] shadow-[4px_4px_0_rgba(0,0,0,0.45)] hover:bg-cyan-300 active:translate-x-px active:translate-y-px active:shadow-[2px_2px_0_rgba(0,0,0,0.45)]"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {children}
    </button>
  );
}

function SecondaryButton({
  icon: Icon,
  onClick,
  children,
}: {
  icon: typeof Plus;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center gap-2 border-2 border-line-strong bg-[#151a21]/85 px-4 text-[13px] font-bold text-fg-subtle shadow-[4px_4px_0_rgba(0,0,0,0.45)] hover:border-cyan-500/60 hover:text-white active:translate-x-px active:translate-y-px active:shadow-[2px_2px_0_rgba(0,0,0,0.45)]"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {children}
    </button>
  );
}

/** A saved face, drawn oversized so the art fills the box the way tabs do. */
function Face({ icon, size }: { icon: EntryIcon | undefined; size: number }) {
  const drawable = Boolean(icon && (icon.iconPath || icon.iconAtlas || icon.kind === "fluid"));
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center overflow-hidden border border-line-strong bg-[#0f1318]"
      style={{ width: size, height: size }}
    >
      {drawable && icon ? (
        <ResourceIcon
          resource={{
            id: icon.resourceId,
            kind: icon.kind,
            amount: 1,
            displayName: icon.displayName,
            iconPath: icon.iconPath,
            iconAtlas: icon.iconAtlas,
            dominantColor: icon.dominantColor,
          }}
          bare
          tooltip={false}
          showAmount={false}
          iconPixelSize={
            icon.kind === "fluid" ? Math.round((size - 8) / FLUID_ICON_SCALE) : (size - 8) * 2
          }
          className="!h-full !w-full"
        />
      ) : (
        <Factory className="h-1/2 w-1/2 text-[#3d4a58]" />
      )}
    </span>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "";
  }
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  const months = days / 30;
  if (months < 12) return `${Math.floor(months)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** The designs already on this device, newest edit first. */
function YourDesigns() {
  const designs = useDesignStore((state) => state.designs);
  const switchToDesign = useDesignStore((state) => state.switchToDesign);
  if (designs.length === 0) {
    return null;
  }
  const recent = [...designs]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 8);
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>Your designs</SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {recent.map((design) => (
          <button
            key={design.id}
            type="button"
            onClick={() => {
              leaveWelcomeTab();
              void switchToDesign(design.id);
            }}
            className="group flex items-center gap-2.5 border border-line bg-[#151a21]/80 px-2.5 py-2 text-left hover:border-cyan-500/60 hover:bg-[#182029]"
          >
            <Face icon={design.icon} size={36} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold text-fg group-hover:text-white">
                {design.name}
              </span>
              <span className="block text-[11px] text-fg-muted">
                {relativeTime(design.updatedAt)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** The community's top setups, six of them, opening in a tab of their own. */
function CommunityShelf() {
  const [plans, setPlans] = useState<CommunityPlanSummary[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    listCommunityPlans({ sort: "top", pageSize: COMMUNITY_TILE_COUNT })
      .then((response) => {
        if (!cancelled) {
          setPlans(response.plans.slice(0, COMMUNITY_TILE_COUNT));
        }
      })
      .catch((listError: unknown) => {
        if (!cancelled) {
          setError(listError instanceof Error ? listError.message : "Could not reach the shelf.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = async (plan: CommunityPlanSummary) => {
    setBusyId(plan.id);
    try {
      const { plan: planJson } = await downloadCommunityPlan(plan.id);
      const project = parseFactoryProjectJson(
        JSON.stringify(tagPlanWithCommunityId(planJson, plan.id)),
      );
      // The post's name first: it is the one on the tile just clicked.
      await useDesignStore.getState().importProjectAsDesign(project, plan.name || project.name);
      applyPlanView(project.view);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Opening the setup failed.");
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>
        <Factory className="h-3.5 w-3.5 text-cyan-300" aria-hidden />
        From the community
      </SectionTitle>
      {error ? <p className="text-[12px] text-amber-300">{error}</p> : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(plans ?? Array.from({ length: COMMUNITY_TILE_COUNT }, () => undefined)).map(
          (plan, index) =>
            plan ? (
              <button
                key={plan.id}
                type="button"
                disabled={busyId !== undefined}
                onClick={() => void open(plan)}
                className={[
                  "group flex items-start gap-3 border border-line bg-[#151a21]/80 px-3 py-2.5 text-left hover:border-cyan-500/60 hover:bg-[#182029] disabled:opacity-60",
                  busyId === plan.id ? "animate-pulse" : "",
                ].join(" ")}
              >
                <Face icon={plan.icon} size={44} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-[13px] font-bold text-fg group-hover:text-white">
                    {plan.name}
                  </span>
                  <span className="truncate text-[11px] text-fg-muted">
                    {plan.authorName ? `by ${plan.authorName}` : "anonymous"}
                    {plan.highestTier ? ` · ${plan.highestTier}` : ""}
                    {` · ${plan.machineCount} machines`}
                  </span>
                  <span className="flex items-center gap-3 text-[11px] text-fg-muted">
                    <span className="inline-flex items-center gap-1">
                      <ThumbsUp className="h-3 w-3" aria-hidden />
                      {plan.score}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Download className="h-3 w-3" aria-hidden />
                      {plan.downloads}
                    </span>
                  </span>
                </span>
              </button>
            ) : (
              <div
                key={index}
                aria-hidden
                className="h-[76px] animate-pulse border border-line bg-[#151a21]/60"
              />
            ),
        )}
      </div>
    </section>
  );
}
