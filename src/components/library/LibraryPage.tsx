"use client";

import {
  Factory,
  Folder,
  FolderPlus,
  Globe,
  LayoutGrid,
  PanelsTopLeft,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { useCommunityUser } from "@/components/community/auth";
import { formatRelativeDate } from "@/components/shelf-cards";
import { listCommunityPlans } from "@/lib/community/client";
import type { DesignFolder, DesignSummary } from "@/lib/designs/design-library";
import { openDesigns } from "@/lib/designs/design-library";
import { SETUPS_CHANGED_EVENT, requestShareDialog } from "@/lib/setups-tab";
import { setLibraryView, useLibraryTab, type LibraryView } from "@/lib/library/library-tab";
import { useDesignStore } from "@/store/design-store";
import { ArmedMenuItem, LibraryMenu, MenuHeading, MenuItem } from "./library-menu";
import { DESIGN_DRAG_TYPE, InlineName, LibraryTile } from "./LibraryTile";
import { SetupsGrid } from "./SetupsGrid";

/**
 * The Library: everything you have and everything the network has, as one
 * kind of tile (see LibraryTile) under one rail.
 *
 * MINE is your designs: Everything (grouped by folder, your saved boards
 * at the foot), Open tabs, Shared (your posts, with the owner tools), the
 * folders, Unfiled. NETWORK is Public setups, everyone's posts with their
 * boards under them. Click a tile to open it (place it, for a board), right
 * click or the dots for its menu, drag a design onto a rail folder to file
 * it. Closing a tab never deletes; delete lives here, armed.
 *
 * One framed panel with the rail INSIDE it, so it reads as this page's
 * tree rather than another column bolted onto the recipe book. No title:
 * the tab strip already says where you are.
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
  const activeDesignId = useDesignStore((state) => state.activeDesignId);
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

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("edited");
  const [tileMenu, setTileMenu] = useState<{ designId: string; left: number; top: number }>();
  const [folderMenu, setFolderMenu] = useState<{ folderId: string; left: number; top: number }>();
  const [armedDeleteId, setArmedDeleteId] = useState<string>();
  const [renamingId, setRenamingId] = useState<string>();
  const [renamingFolderId, setRenamingFolderId] = useState<string>();
  const [namingFolder, setNamingFolder] = useState(false);
  /** The rail entry a dragged tile is over, by view key. */
  const [dropKey, setDropKey] = useState<string>();
  const myPosts = useMyPostIds();

  const closeMenus = useCallback(() => {
    setTileMenu(undefined);
    setFolderMenu(undefined);
    setArmedDeleteId(undefined);
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

  const search = query.trim().toLowerCase();
  const matches = useMemo(
    () => (search ? designs.filter((design) => design.name.toLowerCase().includes(search)) : designs),
    [designs, search],
  );
  const sorted = useMemo(() => sortDesignsBy(matches, sort), [matches, sort]);

  const counts = useMemo(() => {
    const perFolder = new Map<string, number>();
    let unfiled = 0;
    let shared = 0;
    for (const design of designs) {
      if (design.folderId) {
        perFolder.set(design.folderId, (perFolder.get(design.folderId) ?? 0) + 1);
      } else {
        unfiled += 1;
      }
      if (design.communityPlanId) {
        shared += 1;
      }
    }
    return { perFolder, unfiled, shared, open: openDesigns(designs).length };
  }, [designs]);

  const sections = useMemo(
    () => sectionsFor(library.view, sorted, folders),
    [library.view, sorted, folders],
  );
  const folderName = (id: string | undefined) =>
    id ? folders.find((folder) => folder.id === id)?.name : undefined;

  const open = (id: string) => void switchToDesign(id);
  const updatePost = async (id: string) => {
    await switchToDesign(id);
    requestShareDialog();
  };

  const railDropProps = (key: string, folderId: string | undefined) => ({
    onDragOver: (event: DragEvent) => {
      if (event.dataTransfer.types.includes(DESIGN_DRAG_TYPE)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dropKey !== key) {
          setDropKey(key);
        }
      }
    },
    onDragLeave: () => setDropKey((current) => (current === key ? undefined : current)),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDropKey(undefined);
      const id = event.dataTransfer.getData(DESIGN_DRAG_TYPE);
      if (id) {
        void moveDesignToFolder(id, folderId);
      }
    },
  });

  const menuDesign = tileMenu
    ? designs.find((design) => design.id === tileMenu.designId)
    : undefined;
  const menuFolder = folderMenu
    ? folders.find((folder) => folder.id === folderMenu.folderId)
    : undefined;
  const title = viewTitle(library.view, folders);
  const isSetupsView = library.view.kind === "shared" || library.view.kind === "public";

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-canvas text-fg">
      <div className="min-h-0 flex-1 p-4 compact:p-2">
        <div className="flex h-full min-h-0 overflow-hidden rounded border border-line bg-[#12161b] compact:flex-col">
          {/* THE RAIL. On a phone it turns into one scrolling row of chips. */}
          <aside className="flex w-[210px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface/70 px-2 py-2 compact:w-full compact:flex-row compact:items-center compact:overflow-x-auto compact:overflow-y-hidden compact:border-b compact:border-r-0 compact:py-1.5">
            <RailGroup label="Mine" />
            <RailItem
              icon={LayoutGrid}
              label="Everything"
              count={designs.length}
              selected={library.view.kind === "all"}
              onClick={() => setLibraryView({ kind: "all" })}
            />
            <RailItem
              icon={PanelsTopLeft}
              label="Open tabs"
              count={counts.open}
              selected={library.view.kind === "open"}
              onClick={() => setLibraryView({ kind: "open" })}
            />
            <RailItem
              icon={Globe}
              label="Shared"
              count={counts.shared}
              selected={library.view.kind === "shared"}
              onClick={() => setLibraryView({ kind: "shared" })}
            />
            {folders.map((folder) => (
              <RailItem
                key={folder.id}
                icon={Folder}
                label={folder.name}
                count={counts.perFolder.get(folder.id) ?? 0}
                selected={library.view.kind === "folder" && library.view.folderId === folder.id}
                highlighted={dropKey === `folder:${folder.id}`}
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
                {...railDropProps(`folder:${folder.id}`, folder.id)}
              />
            ))}
            {namingFolder ? (
              <div className="flex h-7 items-center gap-1.5 rounded px-2">
                <Folder className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
                <InlineName
                  initialName=""
                  placeholder="Folder name"
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
            {folders.length > 0 ? (
              <RailItem
                icon={Folder}
                label="Unfiled"
                count={counts.unfiled}
                muted
                selected={library.view.kind === "unfiled"}
                highlighted={dropKey === "unfiled"}
                onClick={() => setLibraryView({ kind: "unfiled" })}
                {...railDropProps("unfiled", undefined)}
              />
            ) : null}
            <button
              type="button"
              onClick={() => setNamingFolder(true)}
              className="flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-fg-muted hover:bg-surface-raised hover:text-fg"
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden />
              <span className="text-xs">New folder</span>
            </button>

            <RailGroup label="Network" />
            <RailItem
              icon={Factory}
              label="Public setups"
              selected={library.view.kind === "public"}
              onClick={() => setLibraryView({ kind: "public" })}
            />
          </aside>

          {/* THE CONTENT. */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {isSetupsView ? (
              <SetupsGrid
                key={library.view.kind}
                scope={library.view.kind === "shared" ? "mine" : "network"}
              />
            ) : (
              <>
                <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-4 compact:gap-1.5 compact:px-2">
                  <h2 className="mr-2 shrink-0 text-[12px] font-black uppercase tracking-[0.12em] text-fg compact:hidden">
                    {title}
                  </h2>
                  <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded border border-line-strong bg-surface px-2 text-xs text-fg sm:max-w-[320px]">
                    <Search className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search your designs"
                      aria-label="Search your designs"
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
                    value={sort}
                    onChange={(event) => setSort(event.target.value as SortKey)}
                    aria-label="Sort designs"
                    className="h-7 shrink-0 rounded border border-line-strong bg-surface px-1 text-xs text-fg outline-none"
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
                    className="ml-auto flex h-7 shrink-0 items-center gap-1 rounded border border-cyan-500/60 bg-cyan-500/15 px-2.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/25"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    <span className="compact:hidden">New design</span>
                  </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 compact:px-2">
                  <div className="flex flex-col gap-5">
                    {sections.length === 0 ? (
                      <EmptyNote>
                        {search
                          ? "No designs match."
                          : library.view.kind === "open"
                            ? "No design is open. Click one in the library to open it."
                            : library.view.kind === "all"
                              ? "Nothing here yet. Press New design to start one."
                              : "Nothing here yet. Drag a design onto this folder to file it."}
                      </EmptyNote>
                    ) : null}
                    {sections.map((section) => (
                      <div key={section.key} className="flex flex-col gap-2">
                        {section.title ? (
                          <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-[#aebccd]">
                            {section.folderId ? (
                              <Folder className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
                            ) : null}
                            {section.title}
                            <span className="font-medium text-fg-muted">
                              {section.designs.length}
                            </span>
                          </h3>
                        ) : null}
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
                          {section.designs.map((design) => {
                            const post = postMark(design, myPosts);
                            return (
                              <LibraryTile
                                key={design.id}
                                dragId={design.id}
                                icon={design.icon}
                                name={design.name}
                                subtitle={[
                                  folderName(design.folderId),
                                  formatRelativeDate(design.updatedAt),
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                                tier={design.stats?.tier}
                                machines={design.stats?.machines}
                                euT={design.stats?.euT}
                                marks={{
                                  open: !design.closed,
                                  active: design.id === activeDesignId,
                                  posted: post === "mine",
                                  fromNetwork: post === "theirs",
                                  linked: post === "linked",
                                  behind: Boolean(design.communityBehind),
                                }}
                                menuOpen={tileMenu?.designId === design.id}
                                onOpen={() => open(design.id)}
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
                      </div>
                    ))}                  </div>
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
          {menuDesign.communityBehind && postMark(menuDesign, myPosts) !== "theirs" ? (
            <MenuItem
              label="Update post"
              onClick={() => {
                closeMenus();
                void updatePost(menuDesign.id);
              }}
            />
          ) : null}
          {folders.length > 0 ? (
            <>
              <MenuHeading>Move to</MenuHeading>
              {folders.map((folder) => (
                <MenuItem
                  key={folder.id}
                  label={folder.name}
                  indent
                  checked={menuDesign.folderId === folder.id}
                  onClick={() => {
                    closeMenus();
                    void moveDesignToFolder(menuDesign.id, folder.id);
                  }}
                />
              ))}
              <MenuItem
                label="No folder"
                indent
                checked={!menuDesign.folderId}
                onClick={() => {
                  closeMenus();
                  void moveDesignToFolder(menuDesign.id, undefined);
                }}
              />
            </>
          ) : null}
          <ArmedMenuItem
            label="Delete"
            armedLabel={
              menuDesign.communityPlanId ? "Confirm delete (the post stays up)" : "Confirm delete"
            }
            armed={armedDeleteId === menuDesign.id}
            onArm={() => setArmedDeleteId(menuDesign.id)}
            onFire={() => {
              closeMenus();
              void removeDesign(menuDesign.id);
            }}
          />
        </LibraryMenu>
      ) : null}

      {folderMenu && menuFolder ? (
        <LibraryMenu
          left={folderMenu.left}
          top={folderMenu.top}
          label={`Options for folder ${menuFolder.name}`}
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
            label="Delete folder"
            armedLabel="Confirm delete (designs stay, unfiled)"
            armed={armedDeleteId === menuFolder.id}
            onArm={() => setArmedDeleteId(menuFolder.id)}
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

interface Section {
  key: string;
  title?: string;
  folderId?: string;
  designs: DesignSummary[];
}

function sectionsFor(
  view: LibraryView,
  designs: DesignSummary[],
  folders: DesignFolder[],
): Section[] {
  switch (view.kind) {
    case "open": {
      const open = openDesigns(designs);
      return open.length > 0 ? [{ key: "open", designs: open }] : [];
    }
    case "unfiled": {
      const unfiled = designs.filter((design) => !design.folderId);
      return unfiled.length > 0 ? [{ key: "unfiled", designs: unfiled }] : [];
    }
    case "folder": {
      const inside = designs.filter((design) => design.folderId === view.folderId);
      return inside.length > 0 ? [{ key: view.folderId, designs: inside }] : [];
    }
    case "shared":
    case "public":
      return [];
    case "all": {
      const sections: Section[] = [];
      for (const folder of folders) {
        const inside = designs.filter((design) => design.folderId === folder.id);
        if (inside.length > 0) {
          sections.push({ key: folder.id, title: folder.name, folderId: folder.id, designs: inside });
        }
      }
      const unfiled = designs.filter(
        (design) => !design.folderId || !folders.some((folder) => folder.id === design.folderId),
      );
      if (unfiled.length > 0) {
        // The title only earns its place once there is something to tell
        // it apart from.
        sections.push({
          key: "unfiled",
          title: folders.length > 0 ? "Unfiled" : undefined,
          designs: unfiled,
        });
      }
      return sections;
    }
  }
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

function viewTitle(view: LibraryView, folders: DesignFolder[]): string {
  switch (view.kind) {
    case "all":
      return "Everything";
    case "open":
      return "Open tabs";
    case "shared":
      return "Shared";
    case "public":
      return "Public setups";
    case "unfiled":
      return "Unfiled";
    case "folder":
      return folders.find((folder) => folder.id === view.folderId)?.name ?? "Folder";
  }
}

/**
 * Whose post a design is linked to. Known only while signed in: the
 * network says which posts are yours. Signed out, a link is just a link.
 */
type PostMark = "mine" | "theirs" | "linked" | undefined;

function postMark(design: DesignSummary, myPosts: Set<string> | undefined): PostMark {
  if (!design.communityPlanId) {
    return undefined;
  }
  if (!myPosts) {
    return "linked";
  }
  return myPosts.has(design.communityPlanId) ? "mine" : "theirs";
}

/**
 * The ids of the signed-in account's posts, or undefined while signed out
 * or still loading. Read once per sign-in and again whenever a share lands.
 */
function useMyPostIds(): Set<string> | undefined {
  const { user } = useCommunityUser();
  const username = user?.username;
  // Keyed by who was signed in when they were read, so signing out (or in
  // as someone else) drops them without a reset of its own.
  const [loaded, setLoaded] = useState<{ username: string; ids: Set<string> }>();
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
      const found = new Set<string>();
      for (let page = 1; page <= POSTS_MAX_PAGES; page += 1) {
        const response = await listCommunityPlans({
          mine: true,
          sort: "new",
          page,
          pageSize: POSTS_PAGE_SIZE,
        });
        for (const plan of response.plans) {
          found.add(plan.id);
        }
        if (response.plans.length < POSTS_PAGE_SIZE || found.size >= response.total) {
          break;
        }
      }
      if (!cancelled) {
        setLoaded({ username, ids: found });
      }
    })().catch(() => {
      // The marks fall back to "linked"; nothing else depends on this.
    });
    return () => {
      cancelled = true;
    };
  }, [username, tick]);

  return loaded && loaded.username === username ? loaded.ids : undefined;
}

/* ------------------------------------------------------------------ */

/** A group heading in the rail. Hidden on a phone, where the rail is a row. */
function RailGroup({ label }: { label: string }) {
  return (
    <div className="mx-1 mt-3 mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-fg-muted first:mt-1 compact:hidden">
      {label}
    </div>
  );
}

function RailItem({
  icon: Icon,
  label,
  count,
  selected,
  highlighted,
  muted,
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
  muted?: boolean;
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
        "group flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-xs compact:h-8",
        selected
          ? "bg-cyan-500/15 text-cyan-200"
          : muted
            ? "text-fg-muted hover:bg-surface-raised hover:text-fg"
            : "text-fg-subtle hover:bg-surface-raised hover:text-fg",
        highlighted ? "outline outline-2 outline-cyan-400" : "",
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
          title={label}
          className="min-w-0 flex-1 truncate text-left text-xs font-medium"
        >
          {label}
        </button>
      )}
      {count !== undefined ? (
        <span className="shrink-0 tabular-nums text-[11px] text-fg-muted">{count}</span>
      ) : null}
      {onMenu ? (
        <button
          type="button"
          aria-label={`Options for folder ${label}`}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onMenu(rect.left, rect.bottom + 4);
          }}
          className="-mr-1 shrink-0 rounded px-1 text-fg-muted opacity-0 hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100"
        >
          ⋯
        </button>
      ) : null}
    </div>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-0.5 pt-2 text-[12px] leading-relaxed text-fg-muted">{children}</p>;
}
