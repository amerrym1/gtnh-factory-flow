"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCommunityUser } from "@/components/community/auth";
import { IconPicker, iconSuggestionsFromStats } from "@/components/IconPicker";
import { formatRelativeDate } from "@/components/shelf-cards";
import {
  deleteCommunityPlan,
  downloadCommunityPlan,
  getCommunityPlan,
  listCommunityPlans,
  patchCommunityPlan,
  tagPlanWithCommunityId,
  voteCommunityPlan,
} from "@/lib/community/client";
import { sharedPlanLink } from "@/lib/community/shared-link";
import type { CommunityPlanSort, CommunityPlanSummary, EntryIcon } from "@/lib/community/types";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { parseFactoryProjectJson, serializeFactoryProject } from "@/lib/import-export";
import { placePayload } from "@/lib/library/place-payload";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import type { FactoryProject } from "@/lib/model/types";
import { applyPlanView, capturePlanView } from "@/lib/plan-view";
import { SETUPS_CHANGED_EVENT, type SetupsScope } from "@/lib/setups-tab";
import { useDesignStore } from "@/store/design-store";
import { captureBoardSelection, useFactoryStore } from "@/store/factory-store";
import { LibraryDetail, previewUrlFor } from "./LibraryDetail";
import { ArmedMenuItem, LibraryMenu, MenuItem, MenuRule } from "./library-menu";
import { LibraryTile, TagEditor } from "./LibraryTile";

const SETUP_SORTS: Array<{ value: CommunityPlanSort; label: string }> = [
  { value: "new", label: "Newest" },
  { value: "top", label: "Top voted" },
  { value: "downloads", label: "Most downloaded" },
  { value: "views", label: "Most viewed" },
  { value: "machines", label: "Most machines" },
  { value: "nodes", label: "Most nodes" },
  { value: "power", label: "Highest power" },
];

const PAGE_SIZE = 24;

interface Shelf {
  key: string;
  page: number;
  total: number;
  plans: CommunityPlanSummary[];
}

type Armed = { id: string; what: "takedown" | "overwrite" };

/**
 * Shared setups as tiles: the whole network (NETWORK) or the account's own
 * posts (MINE), with the owner tools in the menu. Click opens a setup as its
 * own tab; the menu loads it as a board onto the open design instead. Under
 * the network's setups come the network's saved boards, same tiles.
 */
export function SetupsGrid({ scope }: { scope: SetupsScope }) {
  const { user, isLoading: isAuthLoading } = useCommunityUser();
  const [sort, setSort] = useState<CommunityPlanSort>("new");
  /** Highest tier allowed, as an index into GT_VOLTAGE_TIERS; "" is any. */
  const [maxTier, setMaxTier] = useState("");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const [shelf, setShelf] = useState<Shelf>();
  const [target, setTarget] = useState<{ key: string; page: number }>({ key: "", page: 1 });
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [copiedId, setCopiedId] = useState<string>();
  const [menu, setMenu] = useState<{ id: string; left: number; top: number }>();
  const [armed, setArmed] = useState<Armed>();
  const [iconEditId, setIconEditId] = useState<string>();
  const [tagEdit, setTagEdit] = useState<{ id: string; left: number; top: number }>();
  /** The post whose preview page is up, if any. */
  const [detailId, setDetailId] = useState<string>();
  const [refreshTick, setRefreshTick] = useState(0);
  const activeTabName = useDesignStore(
    (state) =>
      state.designs.find((design) => design.id === state.activeDesignId)?.name ?? "this board",
  );

  useEffect(() => {
    const refresh = () => setRefreshTick((tick) => tick + 1);
    window.addEventListener(SETUPS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SETUPS_CHANGED_EVENT, refresh);
  }, []);

  const username = user?.username ?? "";
  const search = debouncedQuery.trim();
  const key = `${scope}|${sort}|${maxTier}|${search}|${username}|${refreshTick}`;
  const activePage = target.key === key ? target.page : 1;

  useEffect(() => {
    if (scope === "mine" && !username) {
      return;
    }
    let cancelled = false;
    void listCommunityPlans({
      sort,
      search: search || undefined,
      maxTier: maxTier || undefined,
      mine: scope === "mine" || undefined,
      page: activePage,
      pageSize: PAGE_SIZE,
    }).then(
      (response) => {
        if (cancelled) {
          return;
        }
        setError(undefined);
        setShelf((current) => ({
          key,
          page: activePage,
          total: response.total,
          plans:
            current && current.key === key && activePage > 1
              ? [...current.plans, ...response.plans]
              : response.plans,
        }));
      },
      (loadError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Loading setups failed.");
        setShelf({ key, page: activePage, total: 0, plans: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, activePage, scope, sort, maxTier, search, username]);

  const isCurrent = shelf?.key === key;
  const plans = isCurrent ? shelf.plans : [];
  const needsAccount = scope === "mine" && !username;
  const isLoading = !needsAccount && (!isCurrent || shelf.page !== activePage);
  const hasMore = isCurrent && shelf.plans.length < shelf.total;
  const activeTag = search.startsWith("#") ? search.slice(1).trim() : "";
  const tagOptions = [
    ...new Set([...plans.flatMap((plan) => plan.tags ?? []), ...(activeTag ? [activeTag] : [])]),
  ].sort();

  const patchPlan = (planId: string, patch: (plan: CommunityPlanSummary) => CommunityPlanSummary) =>
    setShelf((current) =>
      current
        ? { ...current, plans: current.plans.map((plan) => (plan.id === planId ? patch(plan) : plan)) }
        : current,
    );
  const dropPlan = (planId: string) =>
    setShelf((current) =>
      current
        ? {
            ...current,
            total: Math.max(0, current.total - 1),
            plans: current.plans.filter((entry) => entry.id !== planId),
          }
        : current,
    );
  const fail = (thrown: unknown, fallback: string) =>
    setError(thrown instanceof Error ? thrown.message : fallback);

  // A post shared by an old release carries the stat card that release
  // computed; the first hover asks once for the current one.
  const refreshedStatsRef = useRef(new Set<string>());
  const refreshStats = (planId: string) => {
    if (refreshedStatsRef.current.has(planId)) {
      return;
    }
    refreshedStatsRef.current.add(planId);
    void getCommunityPlan(planId, { countView: false }).then(
      (summary) =>
        patchPlan(planId, (entry) => ({
          ...entry,
          needs: summary.needs,
          outputs: summary.outputs,
          totalEuT: summary.totalEuT,
          machineCount: summary.machineCount,
          nodeCount: summary.nodeCount,
          storageCount: summary.storageCount,
          edgeCount: summary.edgeCount,
          highestTier: summary.highestTier,
          highestTierIndex: summary.highestTierIndex,
        })),
      () => refreshedStatsRef.current.delete(planId),
    );
  };

  const vote = async (plan: CommunityPlanSummary) => {
    try {
      const response = await voteCommunityPlan(plan.id, 1);
      patchPlan(plan.id, (entry) => ({
        ...entry,
        upvotes: response.upvotes,
        downvotes: response.downvotes,
        score: response.score,
        myVote: response.myVote,
      }));
    } catch (thrown) {
      fail(thrown, "Voting failed.");
    }
  };

  const open = async (plan: CommunityPlanSummary) => {
    setBusyId(plan.id);
    try {
      const { plan: planJson } = await downloadCommunityPlan(plan.id);
      const project = parseFactoryProjectJson(
        JSON.stringify(tagPlanWithCommunityId(planJson, plan.id)),
      );
      // The post's name first: the plan carries its author's tab name.
      await useDesignStore.getState().importProjectAsDesign(project, plan.name || project.name);
      applyPlanView(project.view);
      patchPlan(plan.id, (entry) => ({ ...entry, downloads: entry.downloads + 1 }));
      setError(undefined);
    } catch (thrown) {
      fail(thrown, "Opening the setup failed.");
    } finally {
      setBusyId(undefined);
    }
  };

  // The whole setup lands on the CURRENT canvas inside one board.
  const openAsBoard = async (plan: CommunityPlanSummary) => {
    setBusyId(plan.id);
    try {
      const { plan: planJson } = await downloadCommunityPlan(plan.id);
      const project = parseFactoryProjectJson(JSON.stringify(planJson));
      const payload = captureBoardSelection(project, rootBoardIds(project));
      if (!payload) {
        throw new Error("This setup has nothing to place.");
      }
      const pastedIds = placePayload(payload);
      if (pastedIds.length > 0) {
        const state = useFactoryStore.getState();
        const boardId = state.wrapSelectionInBoard(pastedIds, plan.name);
        if (boardId) {
          state.frameBoardNodes([boardId]);
        }
      }
      patchPlan(plan.id, (entry) => ({ ...entry, downloads: entry.downloads + 1 }));
      setError(undefined);
    } catch (thrown) {
      fail(thrown, "Loading as a board failed.");
    } finally {
      setBusyId(undefined);
    }
  };

  const copyLink = async (plan: CommunityPlanSummary) => {
    const url = sharedPlanLink(plan.id);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(plan.id);
      window.setTimeout(() => setCopiedId((c) => (c === plan.id ? undefined : c)), 1500);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  const saveTags = async (plan: CommunityPlanSummary, tags: string[]) => {
    if (JSON.stringify(tags) === JSON.stringify(plan.tags ?? [])) {
      return;
    }
    try {
      await patchCommunityPlan(plan.id, { tags });
      patchPlan(plan.id, (entry) => ({ ...entry, tags }));
    } catch (thrown) {
      fail(thrown, "Saving tags failed.");
    }
  };

  const saveIcon = async (planId: string, icon: EntryIcon | null) => {
    try {
      await patchCommunityPlan(planId, { icon });
      patchPlan(planId, (entry) => ({ ...entry, icon: icon ?? undefined }));
    } catch (thrown) {
      fail(thrown, "Saving the icon failed.");
    }
  };

  // The OPEN TAB becomes this post's new content.
  const overwriteWithBoard = async (plan: CommunityPlanSummary) => {
    try {
      const state = useFactoryStore.getState();
      await patchCommunityPlan(plan.id, {
        plan: JSON.parse(
          serializeFactoryProject({ ...state.project, view: capturePlanView() }),
        ) as unknown,
      });
      state.setProjectCommunityLink(plan.id);
      setError(undefined);
      setRefreshTick((tick) => tick + 1);
    } catch (thrown) {
      fail(thrown, "Overwriting the post failed.");
    }
  };

  const setVisibility = async (plan: CommunityPlanSummary) => {
    const next = !plan.isPublic;
    try {
      await patchCommunityPlan(plan.id, { isPublic: next });
      if (scope === "network" && !next) {
        dropPlan(plan.id);
      } else {
        patchPlan(plan.id, (entry) => ({ ...entry, isPublic: next }));
      }
    } catch (thrown) {
      fail(thrown, "Changing visibility failed.");
    }
  };

  const takeDown = async (plan: CommunityPlanSummary) => {
    try {
      await deleteCommunityPlan(plan.id);
      dropPlan(plan.id);
    } catch (thrown) {
      fail(thrown, "Taking the post down failed.");
    }
  };

  const closeMenu = () => {
    setMenu(undefined);
    setArmed(undefined);
  };
  const menuPlan = menu ? plans.find((plan) => plan.id === menu.id) : undefined;
  const tagPlan = tagEdit ? plans.find((plan) => plan.id === tagEdit.id) : undefined;
  const detailPlan = detailId ? plans.find((plan) => plan.id === detailId) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {detailPlan ? (
        <LibraryDetail
          entry={{
            name: detailPlan.name,
            icon: detailPlan.icon,
            creator: detailPlan.authorName,
            when: `posted ${formatRelativeDate(detailPlan.createdAt)}`,
            tier: detailPlan.highestTier,
            machines: detailPlan.machineCount,
            euT: detailPlan.totalEuT,
            description: detailPlan.description || undefined,
            tags: detailPlan.tags,
            needs: detailPlan.needs,
            outputs: detailPlan.outputs,
            previewUrl: previewUrlFor(detailPlan.id),
            downloads: detailPlan.downloads,
            marks: {
              posted: detailPlan.isMine === true,
              privatePost: detailPlan.isMine === true && !detailPlan.isPublic,
            },
            primary: {
              label: "Open as a tab",
              onClick: () => {
                setDetailId(undefined);
                void open(detailPlan);
              },
            },
            keys: [
              {
                label: detailPlan.myVote === 1 ? "Take back your vote" : "Vote this up",
                icon: "vote",
                active: detailPlan.myVote === 1,
                count: detailPlan.score,
                onClick: () => void vote(detailPlan),
              },
              { label: "Copy the share link", icon: "link", onClick: () => void copyLink(detailPlan) },
              ...(detailPlan.isMine
                ? [
                    {
                      label: detailPlan.isPublic ? "Make it private" : "Make it public",
                      icon: detailPlan.isPublic ? ("private" as const) : ("public" as const),
                      onClick: () => void setVisibility(detailPlan),
                    },
                  ]
                : []),
            ],
          }}
          onClose={() => setDetailId(undefined)}
        />
      ) : (
        <>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-4 compact:gap-1.5 compact:px-2">
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded border border-line-strong bg-surface px-2 text-xs text-fg">
          <Search className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={scope === "mine" ? "Search my posts (#tag, @name)" : "Search the network (#tag, @name)"}
            aria-label="Search setups"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-muted"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="text-fg-muted hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
        <select
          value={maxTier}
          onChange={(event) => setMaxTier(event.target.value)}
          aria-label="Highest power tier"
          className="h-7 shrink-0 rounded border border-line-strong bg-surface px-1 text-xs text-fg outline-none"
        >
          <option value="">Any tier</option>
          {GT_VOLTAGE_TIERS.map((entry, index) => (
            <option key={entry.tier} value={String(index)}>
              Up to {entry.tier}
            </option>
          ))}
        </select>
        <select
          value={activeTag}
          onChange={(event) => setQuery(event.target.value ? `#${event.target.value}` : "")}
          aria-label="Filter by tag"
          className="h-7 max-w-[140px] shrink-0 rounded border border-line-strong bg-surface px-1 text-xs text-fg outline-none"
        >
          <option value="">All tags</option>
          {tagOptions.map((tag) => (
            <option key={tag} value={tag}>
              #{tag}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as CommunityPlanSort)}
          aria-label="Sort setups"
          className="h-7 shrink-0 rounded border border-line-strong bg-surface px-1 text-xs text-fg outline-none"
        >
          {SETUP_SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 compact:px-2">
        {error ? <p className="mb-2 text-[11px] text-red-400">{error}</p> : null}
        {needsAccount && !isAuthLoading ? (
          <p className="text-[12px] leading-relaxed text-fg-muted">
            Sign in (top right) to see your posts here. Share a design with the Share button
            in the header, then manage it from this page.
          </p>
        ) : isLoading && plans.length === 0 ? (
          <p className="flex items-center gap-1.5 text-[12px] text-fg-muted">
            <LoaderCircle className="h-3 w-3 animate-spin" /> Loading…
          </p>
        ) : plans.length === 0 && !error ? (
          <p className="text-[12px] leading-relaxed text-fg-muted">
            {search
              ? "No setups match."
              : scope === "mine"
                ? "Nothing posted yet. Share a design with the Share button in the header."
                : "Nothing shared yet."}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
              {plans.map((plan) => (
                <div key={plan.id} className="h-full" onMouseEnter={() => refreshStats(plan.id)}>
                  <LibraryTile
                    icon={plan.icon}
                    name={plan.name}
                    creator={plan.authorName}
                    onCreator={plan.authorName ? () => setQuery(`@${plan.authorName}`) : undefined}
                    when={
                      copiedId === plan.id
                        ? "link copied"
                        : formatRelativeDate(plan.createdAt)
                    }
                    tier={plan.highestTier}
                    onTier={
                      plan.highestTierIndex >= 0
                        ? () => setMaxTier(String(plan.highestTierIndex))
                        : undefined
                    }
                    machines={plan.machineCount}
                    euT={plan.totalEuT}
                    social={{
                      score: plan.score,
                      myVote: plan.myVote,
                      onVote: () => void vote(plan),
                      downloads: plan.downloads,
                    }}
                    marks={{ posted: plan.isMine === true, privatePost: plan.isMine && !plan.isPublic }}
                    busy={busyId === plan.id}
                    menuOpen={menu?.id === plan.id}
                    onOpen={() => {
                      refreshStats(plan.id);
                      setDetailId(plan.id);
                    }}
                    onMenu={(left, top) => {
                      setArmed(undefined);
                      setMenu({ id: plan.id, left, top });
                    }}
                  />
                </div>
              ))}
            </div>
            {hasMore ? (
              <button
                type="button"
                disabled={isLoading}
                onClick={() => setTarget({ key, page: activePage + 1 })}
                className="mt-3 flex h-7 w-full items-center justify-center gap-1.5 rounded border border-line-strong bg-surface text-[11px] text-fg-subtle hover:border-line-strong hover:text-fg disabled:opacity-50"
              >
                {isLoading ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
                Load more
              </button>
            ) : null}
          </>
        )}
      </div>
        </>
      )}

      {menu && menuPlan ? (
        <LibraryMenu
          left={menu.left}
          top={menu.top}
          label={`Options for ${menuPlan.name}`}
          onClose={closeMenu}
        >
          <MenuItem
            label="Open as a tab"
            onClick={() => {
              closeMenu();
              void open(menuPlan);
            }}
          />
          <MenuItem
            label="Load as a board on the open design"
            onClick={() => {
              closeMenu();
              void openAsBoard(menuPlan);
            }}
          />
          <MenuItem
            label="Copy link"
            onClick={() => {
              closeMenu();
              void copyLink(menuPlan);
            }}
          />
          {menuPlan.isMine ? (
            <>
              <MenuRule />
              <MenuItem
                label={menuPlan.isPublic ? "Make private" : "Make public"}
                onClick={() => {
                  closeMenu();
                  void setVisibility(menuPlan);
                }}
              />
              <MenuItem
                label="Edit tags"
                onClick={() => {
                  setTagEdit({ id: menuPlan.id, left: menu.left, top: menu.top });
                  closeMenu();
                }}
              />
              <MenuItem
                label="Change icon"
                onClick={() => {
                  closeMenu();
                  setIconEditId(menuPlan.id);
                }}
              />
              <ArmedMenuItem
                label={`Replace with "${activeTabName}"`}
                armedLabel="Confirm: replace the post"
                armed={armed?.id === menuPlan.id && armed.what === "overwrite"}
                onArm={() => setArmed({ id: menuPlan.id, what: "overwrite" })}
                onFire={() => {
                  closeMenu();
                  void overwriteWithBoard(menuPlan);
                }}
              />
              <ArmedMenuItem
                label="Take down"
                armedLabel="Confirm: take it down for everyone"
                armed={armed?.id === menuPlan.id && armed.what === "takedown"}
                onArm={() => setArmed({ id: menuPlan.id, what: "takedown" })}
                onFire={() => {
                  closeMenu();
                  void takeDown(menuPlan);
                }}
              />
            </>
          ) : null}
        </LibraryMenu>
      ) : null}

      {tagEdit && tagPlan ? (
        <TagEditor
          left={tagEdit.left}
          top={tagEdit.top}
          initialTags={tagPlan.tags ?? []}
          onClose={(tags) => {
            setTagEdit(undefined);
            void saveTags(tagPlan, tags);
          }}
        />
      ) : null}

      {iconEditId ? (
        <IconPicker
          title="Pick an icon"
          suggestions={iconSuggestionsFromStats(
            plans.find((entry) => entry.id === iconEditId)?.needs,
            plans.find((entry) => entry.id === iconEditId)?.outputs,
          )}
          onPick={(icon) => {
            setIconEditId(undefined);
            void saveIcon(iconEditId, icon);
          }}
          onClear={
            plans.find((entry) => entry.id === iconEditId)?.icon
              ? () => {
                  setIconEditId(undefined);
                  void saveIcon(iconEditId, null);
                }
              : undefined
          }
          onClose={() => setIconEditId(undefined)}
        />
      ) : null}
    </div>
  );
}

/** Everything living at a project's top level: what a full-plan capture takes. */
function rootBoardIds(project: FactoryProject): string[] {
  return [
    ...project.nodes.filter((node) => !node.pocketId).map((node) => node.id),
    ...(project.storages ?? []).filter((storage) => !storage.pocketId).map((storage) => storage.id),
    ...(project.annotations ?? [])
      .filter((annotation) => !annotation.pocketId)
      .map((annotation) => annotation.id),
    ...(project.pockets ?? []).filter((pocket) => !pocket.parentPocketId).map((pocket) => pocket.id),
  ];
}
