"use client";

import { Factory, Folder, FolderPlus, LayoutGrid, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useCommunityUser } from "@/components/community/auth";
import { IconPicker, iconSuggestionsFromStats } from "@/components/IconPicker";
import { formatRelativeDate } from "@/components/shelf-cards";
import { deleteCommunityPlan, listCommunityPlans, patchCommunityPlan } from "@/lib/community/client";
import { sharedPlanLink } from "@/lib/community/shared-link";
import type { CommunityPlanSummary } from "@/lib/community/types";
import type { DesignSummary } from "@/lib/designs/design-library";
import { GT_VOLTAGE_TIERS } from "@/lib/model/tiers";
import { SETUPS_CHANGED_EVENT, notifySetupsChanged, requestShareDialog } from "@/lib/setups-tab";
import { setLibraryView, useLibraryTab } from "@/lib/library/library-tab";
import { playBoardSound } from "@/lib/board-sounds";
import { useDesignStore } from "@/store/design-store";
import { LibraryDetail, previewUrlFor } from "./LibraryDetail";
import { ArmedMenuItem, LibraryMenu, MenuHeading, MenuItem, MenuRule } from "./library-menu";
import { DESIGN_DRAG_TYPE, InlineName, LibraryTile } from "./LibraryTile";
import { SetupsGrid } from "./SetupsGrid";

/**
 * The Library: everything you have and everything the network has, as one
 * kind of tile (see LibraryTile).
 *
 * YOUR designs are ONE GRID, no sections: the OPEN chip says what is on
 * the strip and the globe says what is posted. The rail on the left is
 * All, then your folders: a folder holds the grid to itself, a tile
 * dragged onto one is filed there (or Move to in its menu, like adding to
 * a playlist). Search, tier and sort at the top apply to whatever is
 * showing. Below a rule sits the one other page, Public setups.
 *
 * Click a tile to open it, right click or the dots for its menu. The globe
 * is green when the design is posted and dim when it is not; clicking the
 * dim one posts it. Posted tiles carry a link button. Closing a tab never
 * deletes; delete lives here, armed.
 */

const POSTS_PAGE_SIZE = 48;
const POSTS_MAX_PAGES = 6;

type SortKey = "edited" | "name" | "created";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "edited", label: "Last edited" },
  { value: "name", label: "Name" },
  { value: "created", label: "Newest" },
];

export function LibraryPage() {
  const library = useLibraryTab();
  const designs = useDesignStore((state) => state.designs);
  const folders = useDesignStore((state) => state.folders);
  const switchToDesign = useDesignStore((state) => state.switchToDesign);
  const addDesign = useDesignStore((state) => state.addDesign);
  const copyDesign = useDesignStore((state) => state.copyDesign);
  const renameDesign = useDesignStore((state) => state.renameDesign);
  const closeDesign = useDesignStore((state) => state.closeDesign);
  const removeDesign = useDesignStore((state) => state.removeDesign);
  const moveDesignToFolder = useDesignStore((state) => state.moveDesignToFolder);
  const createFolder = useDesignStore((state) => state.createFolder);
  const renameFolder = useDesignStore((state) => state.renameFolder);
  const deleteFolder = useDesignStore((state) => state.deleteFolder);
  const updateDesignIdentity = useDesignStore((state) => state.updateDesignIdentity);

  const [query, setQuery] = useState("");
  /** The design whose icon is being picked on the preview page. */
  const [iconEditId, setIconEditId] = useState<string>();
  const [sort, setSort] = useState<SortKey>("edited");
  /** Highest tier allowed, as an index into GT_VOLTAGE_TIERS; "" is any. */
  const [maxTier, setMaxTier] = useState("");
  const [tileMenu, setTileMenu] = useState<{ designId: string; left: number; top: number }>();
  const [folderMenu, setFolderMenu] = useState<{ folderId: string; left: number; top: number }>();
  const [armed, setArmed] = useState<{ id: string; what: "delete" | "takedown" }>();
  const [renamingId, setRenamingId] = useState<string>();
  const [renamingFolderId, setRenamingFolderId] = useState<string>();
  const [namingFolder, setNamingFolder] = useState(false);
  const [copiedId, setCopiedId] = useState<string>();
  const [error, setError] = useState<string>();
  /** The rail folder a dragged tile is over. */
  const [dropId, setDropId] = useState<string>();
  /** Multi-select: Ctrl-click toggles, Shift-click ranges from the anchor. */
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [anchorId, setAnchorId] = useState<string>();
  const [bulkDeleteArmed, setBulkDeleteArmed] = useState(false);
  /** The design whose preview page is up, if any. */
  const [detailId, setDetailId] = useState<string>();
  const { posts: myPosts, signedIn } = useMyPosts();

  // The library has the search's voice for its pages: a page turned for
  // every view and every focus page. Arriving and leaving are silent,
  // like switching tabs.
  const turnedRef = useRef(false);
  const pageKey = `${library.view.kind}:${viewFolderKey(library.view)}:${detailId ?? ""}`;
  useEffect(() => {
    if (!turnedRef.current) {
      turnedRef.current = true;
      return;
    }
    playBoardSound("pageTurn");
  }, [pageKey]);

  const closeMenus = useCallback(() => {
    setTileMenu(undefined);
    setFolderMenu(undefined);
    setArmed(undefined);
  }, []);

  // A view naming a folder that has since gone falls back to everything.
  useEffect(() => {
    if (
      library.view.kind === "folder" &&
      !folders.some((folder) => folder.id === (library.view as { folderId: string }).folderId)
    ) {
      setLibraryView({ kind: "all" });
    }
  }, [folders, library.view]);

  const viewFolderId = library.view.kind === "folder" ? library.view.folderId : undefined;
  const search = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const tierLimit = maxTier === "" ? undefined : Number(maxTier);
    return sortDesignsBy(
      designs.filter(
        (design) =>
          (!viewFolderId || design.folderId === viewFolderId) &&
          (!search || design.name.toLowerCase().includes(search)) &&
          // A design with no stat row yet cannot answer the tier question,
          // so it shows under "any" and hides under a limit.
          (tierLimit === undefined ||
            (design.stats !== undefined && design.stats.tierIndex <= tierLimit)),
      ),
      sort,
    );
  }, [designs, viewFolderId, search, maxTier, sort]);

  const perFolder = useMemo(
    () =>
      new Map(
        folders.map((folder) => [
          folder.id,
          designs.filter((design) => design.folderId === folder.id).length,
        ]),
      ),
    [designs, folders],
  );

  // The selection lives in the grid that is showing: a view change or
  // Escape clears it, and ids that scroll out of the filter drop out.
  const shownIds = useMemo(() => shown.map((design) => design.id), [shown]);
  // Derived, not pruned: ids that scroll out of the filter simply stop
  // counting, and come back if the filter lets them back in.
  const visibleSelected = useMemo(
    () => new Set([...selected].filter((id) => shownIds.includes(id))),
    [selected, shownIds],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(new Set());
        setBulkDeleteArmed(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const selectTile = (id: string, mode: "toggle" | "range") => {
    setBulkDeleteArmed(false);
    if (mode === "range" && anchorId && shownIds.includes(anchorId)) {
      const from = shownIds.indexOf(anchorId);
      const to = shownIds.indexOf(id);
      const [start, end] = from < to ? [from, to] : [to, from];
      setSelected((current) => new Set([...current, ...shownIds.slice(start, end + 1)]));
      return;
    }
    setAnchorId(id);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const clearSelection = () => {
    setSelected(new Set());
    setBulkDeleteArmed(false);
  };
  const selectedIds = [...visibleSelected];
  const closeSelected = async () => {
    await useDesignStore.getState().closeDesigns(selectedIds);
    clearSelection();
  };
  const fileSelected = async (folderId: string | undefined) => {
    for (const id of selectedIds) {
      await moveDesignToFolder(id, folderId);
    }
    clearSelection();
  };
  const deleteSelected = async () => {
    for (const id of selectedIds) {
      await removeDesign(id);
    }
    clearSelection();
  };
  /** What a drag from `id` carries: the selection when it is part of one. */
  const dragIdsFor = (id: string) => (visibleSelected.has(id) ? selectedIds : [id]);
  const readDroppedIds = (event: DragEvent): string[] => {
    const raw = event.dataTransfer.getData(DESIGN_DRAG_TYPE);
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [raw];
    }
  };

  const open = (id: string) => void switchToDesign(id);
  const postDesign = async (id: string) => {
    await switchToDesign(id);
    requestShareDialog();
  };
  const copyLink = async (design: DesignSummary) => {
    if (!design.communityPlanId) {
      return;
    }
    const url = sharedPlanLink(design.communityPlanId);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(design.id);
      window.setTimeout(() => setCopiedId((c) => (c === design.id ? undefined : c)), 1500);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };
  const setPostVisibility = async (design: DesignSummary, isPublic: boolean) => {
    if (!design.communityPlanId) {
      return;
    }
    try {
      await patchCommunityPlan(design.communityPlanId, { isPublic });
      notifySetupsChanged();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "Changing visibility failed.");
    }
  };
  const takeDown = async (design: DesignSummary) => {
    if (!design.communityPlanId) {
      return;
    }
    try {
      await deleteCommunityPlan(design.communityPlanId);
      notifySetupsChanged();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "Taking the post down failed.");
    }
  };

  const railDropProps = (folderId: string) => ({
    onDragOver: (event: DragEvent) => {
      if (event.dataTransfer.types.includes(DESIGN_DRAG_TYPE)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dropId !== folderId) {
          setDropId(folderId);
        }
      }
    },
    onDragLeave: () => setDropId((current) => (current === folderId ? undefined : current)),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDropId(undefined);
      const ids = readDroppedIds(event);
      void (async () => {
        for (const id of ids) {
          await moveDesignToFolder(id, folderId);
        }
      })();
      if (ids.length > 1) {
        clearSelection();
      }
    },
  });

  const menuDesign = tileMenu
    ? designs.find((design) => design.id === tileMenu.designId)
    : undefined;
  const menuPost = menuDesign?.communityPlanId
    ? myPosts?.get(menuDesign.communityPlanId)
    : undefined;
  const menuFolder = folderMenu
    ? folders.find((folder) => folder.id === folderMenu.folderId)
    : undefined;
  const detailDesign = detailId ? designs.find((design) => design.id === detailId) : undefined;
  const detailPost = detailDesign?.communityPlanId
    ? myPosts?.get(detailDesign.communityPlanId)
    : undefined;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#101215] text-[var(--mc-ink)]">
      <div className="min-h-0 flex-1">
        {/* The frame is the recipe search's: 4px, one shade off the floor,
            an accent by contrast rather than colour, flush to the board. */}
        <div className="flex h-full min-h-0 overflow-hidden border-4 border-[#23262d] bg-[#101215] shadow-[inset_2px_2px_0_rgba(255,255,255,0.05),inset_-2px_-2px_0_rgba(0,0,0,0.6)] compact:flex-col">
          {/* THE RAIL: all, then folders. On a phone, one row of chips. */}
          <aside className="flex w-[168px] shrink-0 flex-col gap-1 overflow-y-auto bg-[#101215] px-2 py-2 compact:w-full compact:flex-row compact:items-center compact:overflow-x-auto compact:overflow-y-hidden compact:border-b compact:border-r-0 compact:py-1.5">
            <RailItem
              icon={LayoutGrid}
              label="My designs"
              count={designs.length}
              selected={library.view.kind === "all"}
              onClick={() => setLibraryView({ kind: "all" })}
            />
            {folders.map((folder) => (
              <RailItem
                key={folder.id}
                icon={Folder}
                label={folder.name}
                count={perFolder.get(folder.id) ?? 0}
                selected={viewFolderId === folder.id}
                highlighted={dropId === folder.id}
                renaming={renamingFolderId === folder.id}
                onRename={(name) => {
                  setRenamingFolderId(undefined);
                  void renameFolder(folder.id, name);
                }}
                onCancelRename={() => setRenamingFolderId(undefined)}
                onClick={() => setLibraryView({ kind: "folder", folderId: folder.id })}
                onDoubleClick={() => setRenamingFolderId(folder.id)}
                onMenu={(left, top) => {
                  closeMenus();
                  setFolderMenu({ folderId: folder.id, left, top });
                }}
                {...railDropProps(folder.id)}
              />
            ))}
            {namingFolder ? (
              <div className="flex h-7 items-center gap-1.5 px-2">
                <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--mc-ink-muted)]" aria-hidden />
                <InlineName
                  initialName=""
                  placeholder="Collection name"
                  onCommit={(name) => {
                    setNamingFolder(false);
                    if (name.trim()) {
                      void createFolder(name).then((folder) =>
                        setLibraryView({ kind: "folder", folderId: folder.id }),
                      );
                    }
                  }}
                  onCancel={() => setNamingFolder(false)}
                />
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setNamingFolder(true)}
              className="flex h-8 shrink-0 items-center gap-1.5 border-2 border-dashed border-[var(--mc-47)] px-2 text-[var(--mc-ink-muted)] hover:border-[var(--mc-61)] hover:text-[var(--mc-ink)]"
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden />
              <span className="text-[13px] font-bold">New collection</span>
            </button>

            <div className="mx-1 my-2 border-t-2 border-[#23262d] compact:mx-2 compact:my-0 compact:h-4 compact:border-l compact:border-t-0" />
            <RailItem
              icon={Factory}
              label="Public setups"
              selected={library.view.kind === "public"}
              onClick={() => setLibraryView({ kind: "public" })}
            />
          </aside>

          {/* THE PAGE. */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {library.view.kind === "public" ? (
              <SetupsGrid scope="network" />
            ) : detailDesign ? (
              <LibraryDetail
                entry={{
                  name: detailDesign.name,
                  icon: detailDesign.icon,
                  creator: folders.find((folder) => folder.id === detailDesign.folderId)?.name,
                  when: `edited ${formatRelativeDate(detailDesign.updatedAt)}`,
                  tier: detailDesign.stats?.tier,
                  machines: detailDesign.stats?.machines,
                  euT: detailDesign.stats?.euT,
                  description: detailPost?.description || undefined,
                  tags: detailPost?.tags,
                  needs: detailPost?.needs,
                  outputs: detailPost?.outputs,
                  previewUrl: detailPost ? previewUrlFor(detailPost.id) : undefined,
                  marks: {
                    open: !detailDesign.closed,
                    posted: Boolean(detailPost),
                    privatePost: detailPost ? !detailPost.isPublic : false,
                    behind: Boolean(detailPost && detailDesign.communityBehind),
                  },
                  hasComments: Boolean(detailPost),
                  primary: {
                    label: "Open",
                    onClick: () => {
                      setDetailId(undefined);
                      open(detailDesign.id);
                    },
                  },
                  onEdit: async (patch) => {
                    await updateDesignIdentity(detailDesign.id, {
                      name: patch.name,
                      description: patch.description,
                    });
                    if (detailPost) {
                      try {
                        await patchCommunityPlan(detailPost.id, {
                          name: patch.name,
                          description: patch.description,
                          tags: patch.tags,
                        });
                        notifySetupsChanged();
                      } catch (thrown) {
                        setError(thrown instanceof Error ? thrown.message : "Saving the post failed.");
                      }
                    }
                  },
                  editTags: Boolean(detailPost),
                  onPickIcon: () => setIconEditId(detailDesign.id),
                  keys: [
                    ...(detailPost
                      ? [
                          ...(detailDesign.communityBehind
                            ? [
                                {
                                  label: "Update the post from this design",
                                  icon: "post" as const,
                                  onClick: () => {
                                    setDetailId(undefined);
                                    void postDesign(detailDesign.id);
                                  },
                                },
                              ]
                            : []),
                          {
                            label: "Copy the share link",
                            icon: "link" as const,
                            onClick: () => void copyLink(detailDesign),
                          },
                          {
                            label: detailPost.isPublic ? "Make it private" : "Make it public",
                            icon: detailPost.isPublic ? ("private" as const) : ("public" as const),
                            onClick: () => void setPostVisibility(detailDesign, !detailPost.isPublic),
                          },
                        ]
                      : signedIn && !detailDesign.communityPlanId
                        ? [
                            {
                              label: "Post as a public setup",
                              icon: "post" as const,
                              onClick: () => {
                                setDetailId(undefined);
                                void postDesign(detailDesign.id);
                              },
                            },
                          ]
                        : []),
                    ...(!detailDesign.closed
                      ? [
                          {
                            label: "Close its tab",
                            icon: "close" as const,
                            onClick: () => {
                              setDetailId(undefined);
                              void closeDesign(detailDesign.id);
                            },
                          },
                        ]
                      : []),
                    {
                      label: "Delete this design",
                      icon: "delete" as const,
                      confirm: detailPost
                        ? `Delete "${detailDesign.name}" from your library? Its public post stays up.`
                        : `Delete "${detailDesign.name}" from your library? This cannot be undone.`,
                      onClick: () => {
                        setDetailId(undefined);
                        void removeDesign(detailDesign.id);
                      },
                    },
                  ],
                }}
                onClose={() => setDetailId(undefined)}
              />
                  ) : (
              <>
                <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--mc-33)] px-4 compact:gap-1.5 compact:px-2">
                  <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 border-2 border-[var(--mc-33)] bg-[#17191d] px-2 text-xs text-neutral-100 shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]">
                    <Search className="h-3.5 w-3.5 shrink-0 text-[var(--mc-ink-muted)]" aria-hidden />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search your designs"
                      aria-label="Search your designs"
                      className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--mc-ink-muted)]"
                    />
                    {query ? (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        aria-label="Clear search"
                        className="text-[var(--mc-ink-muted)] hover:text-[var(--mc-ink)]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </label>
                  <select
                    value={maxTier}
                    onChange={(event) => {
                      playBoardSound("tick");
                      setMaxTier(event.target.value);
                    }}
                    aria-label="Highest power tier"
                    className="h-7 shrink-0 border-2 border-[var(--mc-33)] bg-[#17191d] px-1 text-xs text-neutral-100 outline-none shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]"
                  >
                    <option value="">Any tier</option>
                    {GT_VOLTAGE_TIERS.map((entry, index) => (
                      <option key={entry.tier} value={String(index)}>
                        Up to {entry.tier}
                      </option>
                    ))}
                  </select>
                  <select
                    value={sort}
                    onChange={(event) => {
                      playBoardSound("tick");
                      setSort(event.target.value as SortKey);
                    }}
                    aria-label="Sort designs"
                    className="h-7 shrink-0 border-2 border-[var(--mc-33)] bg-[#17191d] px-1 text-xs text-neutral-100 outline-none shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]"
                  >
                    {SORTS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void addDesign()}
                    aria-label="New design"
                    className="flex h-7 shrink-0 items-center gap-1 border-2 border-[var(--mc-33)] bg-[var(--mc-61)] px-2.5 text-xs font-bold text-[var(--mc-ink)] shadow-[inset_1px_1px_0_var(--mc-85)] hover:border-cyan-400 hover:text-cyan-200"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    <span className="compact:hidden">New design</span>
                  </button>
                </header>

                {visibleSelected.size > 0 ? (
                  <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--mc-33)] bg-cyan-500/10 px-4 text-xs text-[var(--mc-ink)] compact:px-2">
                    <span className="font-bold text-cyan-200">{visibleSelected.size} selected</span>
                    <span className="text-[var(--mc-ink-muted)] compact:hidden">
                      Ctrl-click to add, Shift-click for a run
                    </span>
                    <span className="ml-auto flex items-center gap-1.5">
                      {selectedIds.some((id) => !designs.find((d) => d.id === id)?.closed) ? (
                        <BarButton onClick={() => void closeSelected()}>Close tabs</BarButton>
                      ) : null}
                      {folders.length > 0 ? (
                        <select
                          value=""
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value) {
                              void fileSelected(value === "none" ? undefined : value);
                            }
                          }}
                          aria-label="Add the selection to a collection"
                          className="h-6 border-2 border-[var(--mc-33)] bg-[#17191d] px-1 text-xs text-neutral-100 outline-none shadow-[inset_2px_2px_0_#30343b,inset_-2px_-2px_0_#050607]"
                        >
                          <option value="">Add to collection…</option>
                          {folders.map((folder) => (
                            <option key={folder.id} value={folder.id}>
                              {folder.name}
                            </option>
                          ))}
                          <option value="none">No collection</option>
                        </select>
                      ) : null}
                      <BarButton
                        tone="danger"
                        onClick={() => {
                          if (bulkDeleteArmed) {
                            void deleteSelected();
                          } else {
                            setBulkDeleteArmed(true);
                          }
                        }}
                      >
                        {bulkDeleteArmed ? `Confirm delete ${visibleSelected.size}` : "Delete"}
                      </BarButton>
                      <BarButton onClick={clearSelection}>Clear</BarButton>
                    </span>
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 compact:px-2">
                  {error ? <p className="mb-2 text-[11px] text-red-400">{error}</p> : null}
                  {shown.length === 0 ? (
                    <p className="px-0.5 pt-1 text-[12px] leading-relaxed text-[var(--mc-ink-muted)]">
                      {search || maxTier
                        ? "No designs match."
                        : viewFolderId
                          ? "Nothing here yet. Drag a design onto this collection, or use Add to collection in its menu."
                          : "Nothing here yet. Press New design to start one."}
                    </p>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
                      {shown.map((design) => {
                        const post = design.communityPlanId
                          ? myPosts?.get(design.communityPlanId)
                          : undefined;
                        const linkedElsewhere = Boolean(design.communityPlanId && myPosts && !post);
                        return (
                          <LibraryTile
                            key={design.id}
                            dragIds={dragIdsFor(design.id)}
                            selected={visibleSelected.has(design.id)}
                            onSelect={(mode) => selectTile(design.id, mode)}
                            icon={design.icon}
                            name={design.name}
                            creator={
                              viewFolderId
                                ? undefined
                                : folders.find((folder) => folder.id === design.folderId)?.name
                            }
                            when={
                              copiedId === design.id
                                ? "link copied"
                                : formatRelativeDate(design.updatedAt)
                            }
                            tier={design.stats?.tier}
                            onTier={
                              design.stats && design.stats.tierIndex >= 0
                                ? () => setMaxTier(String(design.stats?.tierIndex))
                                : undefined
                            }
                            machines={design.stats?.machines}
                            euT={design.stats?.euT}
                            marks={{
                              open: !design.closed,
                              posted: Boolean(post),
                              privatePost: post ? !post.isPublic : false,
                              fromNetwork: linkedElsewhere,
                              linked: Boolean(design.communityPlanId && !myPosts),
                              behind: Boolean(post && design.communityBehind),
                            }}
                            onPost={
                              !post && !linkedElsewhere && signedIn
                                ? () => void postDesign(design.id)
                                : undefined
                            }
                            onCopyLink={post ? () => void copyLink(design) : undefined}
                            menuOpen={tileMenu?.designId === design.id}
                            onOpen={() => setDetailId(design.id)}
                            onMenu={(left, top) => {
                              closeMenus();
                              setTileMenu({ designId: design.id, left, top });
                            }}
                            renaming={
                              renamingId === design.id
                                ? {
                                    onCommit: (name) => {
                                      setRenamingId(undefined);
                                      void renameDesign(design.id, name);
                                    },
                                    onCancel: () => setRenamingId(undefined),
                                  }
                                : undefined
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {tileMenu && menuDesign ? (
        <LibraryMenu
          left={tileMenu.left}
          top={tileMenu.top}
          label={`Options for ${menuDesign.name}`}
          onClose={closeMenus}
        >
          <MenuItem
            label="Open"
            onClick={() => {
              closeMenus();
              open(menuDesign.id);
            }}
          />
          {!menuDesign.closed ? (
            <MenuItem
              label="Close tab"
              onClick={() => {
                closeMenus();
                void closeDesign(menuDesign.id);
              }}
            />
          ) : null}
          <MenuItem
            label="Rename"
            onClick={() => {
              closeMenus();
              setRenamingId(menuDesign.id);
            }}
          />
          <MenuItem
            label="Duplicate"
            onClick={() => {
              closeMenus();
              void copyDesign(menuDesign.id);
            }}
          />
          {folders.length > 0 ? (
            <>
              <MenuHeading>Add to collection</MenuHeading>
              {folders.map((folder) => (
                <MenuItem
                  key={folder.id}
                  label={folder.name}
                  indent
                  checked={menuDesign.folderId === folder.id}
                  onClick={() => {
                    closeMenus();
                    void moveDesignToFolder(
                      menuDesign.id,
                      menuDesign.folderId === folder.id ? undefined : folder.id,
                    );
                  }}
                />
              ))}
            </>
          ) : null}
          <MenuRule />
          {menuPost ? (
            <>
              {menuDesign.communityBehind ? (
                <MenuItem
                  label="Update post"
                  onClick={() => {
                    closeMenus();
                    void postDesign(menuDesign.id);
                  }}
                />
              ) : null}
              <MenuItem
                label="Copy link"
                onClick={() => {
                  closeMenus();
                  void copyLink(menuDesign);
                }}
              />
              <MenuItem
                label={menuPost.isPublic ? "Make private" : "Make public"}
                onClick={() => {
                  closeMenus();
                  void setPostVisibility(menuDesign, !menuPost.isPublic);
                }}
              />
              <ArmedMenuItem
                label="Take down"
                armedLabel="Confirm: take it down for everyone"
                armed={armed?.id === menuDesign.id && armed.what === "takedown"}
                onArm={() => setArmed({ id: menuDesign.id, what: "takedown" })}
                onFire={() => {
                  closeMenus();
                  void takeDown(menuDesign);
                }}
              />
            </>
          ) : signedIn && !menuDesign.communityPlanId ? (
            <MenuItem
              label="Post as a public setup"
              onClick={() => {
                closeMenus();
                void postDesign(menuDesign.id);
              }}
            />
          ) : null}
          <ArmedMenuItem
            label="Delete"
            armedLabel={menuPost ? "Confirm delete (the post stays up)" : "Confirm delete"}
            armed={armed?.id === menuDesign.id && armed.what === "delete"}
            onArm={() => setArmed({ id: menuDesign.id, what: "delete" })}
            onFire={() => {
              closeMenus();
              void removeDesign(menuDesign.id);
            }}
          />
        </LibraryMenu>
      ) : null}

      {iconEditId ? (
        <IconPicker
          title="Pick an icon"
          suggestions={iconSuggestionsFromStats(detailPost?.needs, detailPost?.outputs)}
          onPick={(icon) => {
            const id = iconEditId;
            setIconEditId(undefined);
            void updateDesignIdentity(id, { icon });
            if (detailPost) {
              void patchCommunityPlan(detailPost.id, { icon }).then(notifySetupsChanged, () => undefined);
            }
          }}
          onClear={
            detailDesign?.icon
              ? () => {
                  const id = iconEditId;
                  setIconEditId(undefined);
                  void updateDesignIdentity(id, { icon: null });
                  if (detailPost) {
                    void patchCommunityPlan(detailPost.id, { icon: null }).then(notifySetupsChanged, () => undefined);
                  }
                }
              : undefined
          }
          onClose={() => setIconEditId(undefined)}
        />
      ) : null}

      {folderMenu && menuFolder ? (
        <LibraryMenu
          left={folderMenu.left}
          top={folderMenu.top}
          label={`Options for collection ${menuFolder.name}`}
          onClose={closeMenus}
        >
          <MenuItem
            label="Rename"
            onClick={() => {
              closeMenus();
              setRenamingFolderId(menuFolder.id);
            }}
          />
          <ArmedMenuItem
            label="Delete collection"
            armedLabel="Confirm delete (designs stay)"
            armed={armed?.id === menuFolder.id && armed.what === "delete"}
            onArm={() => setArmed({ id: menuFolder.id, what: "delete" })}
            onFire={() => {
              closeMenus();
              void deleteFolder(menuFolder.id);
            }}
          />
        </LibraryMenu>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function viewFolderKey(view: { kind: string; folderId?: string }): string {
  return view.kind === "folder" ? (view.folderId ?? "") : "";
}

/** A button on the selection bar. */
function BarButton({
  onClick,
  tone,
  children,
}: {
  onClick: () => void;
  tone?: "danger";
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-6 border px-2 text-xs font-medium",
        tone === "danger"
          ? "border-red-800 bg-red-950/60 text-red-300 hover:border-red-600"
          : "border-[var(--mc-61)] bg-[var(--mc-33)] text-neutral-300 hover:text-[var(--mc-ink)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function sortDesignsBy(designs: DesignSummary[], sort: SortKey): DesignSummary[] {
  const sorted = [...designs];
  switch (sort) {
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      break;
    case "created":
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case "edited":
    default:
      sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return sorted;
}

/**
 * The signed-in account's posts by id, or undefined while signed out or
 * still loading. Read once per sign-in and again whenever a share lands or
 * a post is changed from here.
 */
function useMyPosts(): { posts: Map<string, CommunityPlanSummary> | undefined; signedIn: boolean } {
  const { user } = useCommunityUser();
  const username = user?.username;
  const [loaded, setLoaded] = useState<{
    username: string;
    posts: Map<string, CommunityPlanSummary>;
  }>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    window.addEventListener(SETUPS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SETUPS_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (!username) {
      return;
    }
    let cancelled = false;
    (async () => {
      const found = new Map<string, CommunityPlanSummary>();
      for (let page = 1; page <= POSTS_MAX_PAGES; page += 1) {
        const response = await listCommunityPlans({
          mine: true,
          sort: "new",
          page,
          pageSize: POSTS_PAGE_SIZE,
        });
        for (const plan of response.plans) {
          found.set(plan.id, plan);
        }
        if (response.plans.length < POSTS_PAGE_SIZE || found.size >= response.total) {
          break;
        }
      }
      if (!cancelled) {
        setLoaded({ username, posts: found });
      }
    })().catch(() => {
      // The marks fall back to "linked"; nothing else depends on this.
    });
    return () => {
      cancelled = true;
    };
  }, [username, tick]);

  return {
    posts: loaded && loaded.username === username ? loaded.posts : undefined,
    signedIn: Boolean(username),
  };
}

/* ------------------------------------------------------------------ */

function RailItem({
  icon: Icon,
  label,
  count,
  selected,
  highlighted,
  renaming,
  onRename,
  onCancelRename,
  onClick,
  onDoubleClick,
  onMenu,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  icon: typeof Folder;
  label: string;
  count?: number;
  selected: boolean;
  highlighted?: boolean;
  renaming?: boolean;
  onRename?: (name: string) => void;
  onCancelRename?: () => void;
  onClick: () => void;
  onDoubleClick?: () => void;
  onMenu?: (left: number, top: number) => void;
  onDragOver?: (event: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (event: DragEvent) => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={
        onMenu
          ? (event) => {
              event.preventDefault();
              onMenu(event.clientX, event.clientY);
            }
          : undefined
      }
      className={[
        "group flex h-8 shrink-0 items-center gap-1.5 border-2 px-2 text-[13px] font-bold compact:h-8",
        selected
          ? "border-[var(--mc-61)] bg-[var(--mc-47)] text-[var(--mc-ink)]"
          : "border-[var(--mc-47)] bg-[var(--mc-33)] text-[var(--mc-ink)] opacity-55 hover:opacity-100",
        highlighted ? "border-cyan-400 opacity-100" : "",
      ].join(" ")}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {renaming && onRename && onCancelRename ? (
        <InlineName initialName={label} onCommit={onRename} onCancel={onCancelRename} />
      ) : (
        <button
          type="button"
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          className="min-w-0 flex-1 truncate text-left text-[13px] font-bold"
        >
          {label}
        </button>
      )}
      {count !== undefined ? (
        <span className="shrink-0 text-[12px] font-bold tabular-nums text-[var(--mc-ink-muted)]">{count}</span>
      ) : null}
      {onMenu ? (
        <button
          type="button"
          aria-label={`Options for collection ${label}`}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onMenu(rect.left, rect.bottom + 4);
          }}
          className="-mr-1 shrink-0 px-1 text-[var(--mc-ink-muted)] opacity-0 hover:bg-[var(--mc-33)] hover:text-[var(--mc-ink)] focus:opacity-100 group-hover:opacity-100"
        >
          ⋯
        </button>
      ) : null}
    </div>
  );
}
