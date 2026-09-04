"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useCommunityUser } from "@/components/community/auth";
import { IconPicker, iconSuggestionsFromStats } from "@/components/IconPicker";
import { formatRelativeDate, renderEntryHoverCard } from "@/components/shelf-cards";
import type { BlueprintSummary } from "@/lib/blueprints/types";
import type { EntryIcon } from "@/lib/community/types";
import { placePayload } from "@/lib/library/place-payload";
import { useBlueprintStore } from "@/store/blueprint-store";
import { ArmedMenuItem, LibraryMenu, MenuItem, MenuRule } from "./library-menu";
import { LibraryTile, TagEditor } from "./LibraryTile";

/**
 * Saved boards as tiles, wearing the ✦ mark: yours (MINE, at the foot of
 * Everything) or everyone's (PUBLIC, under the network's setups). A board
 * is a chunk, not a whole design, so click PLACES it on the open design
 * and closes the library. Saving a board happens from the board itself.
 */
export function BoardsSection({
  scope,
  title,
}: {
  scope: "mine" | "public";
  /** Shown over the grid; the mine section in Everything names itself. */
  title?: string;
}) {
  const { user } = useCommunityUser();
  const store = useBlueprintStore();
  const [menu, setMenu] = useState<{ id: string; left: number; top: number }>();
  const [armedDeleteId, setArmedDeleteId] = useState<string>();
  const [renamingId, setRenamingId] = useState<string>();
  const [iconEditId, setIconEditId] = useState<string>();
  const [tagEdit, setTagEdit] = useState<{ id: string; left: number; top: number }>();

  useEffect(() => {
    if (scope === "mine") {
      if (user) {
        void store.refresh();
      } else {
        store.reset();
      }
    } else if (!store.hasLoadedPublic) {
      void store.refreshPublic();
    }
    // The store's own functions are stable; only the account changes matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, user?.username]);

  const boards = scope === "mine" ? store.blueprints : store.publicBlueprints;
  const isLoading = scope === "mine" ? store.isLoading : store.isPublicLoading;
  const error = scope === "mine" ? store.error : store.publicError;

  if (scope === "mine" && (!user || (boards.length === 0 && !isLoading))) {
    return null;
  }

  const place = async (board: BlueprintSummary) => {
    const payload =
      scope === "mine" ? await store.load(board.id) : await store.downloadPublic(board.id);
    if (payload) {
      placePayload(payload);
    }
  };

  const closeMenu = () => {
    setMenu(undefined);
    setArmedDeleteId(undefined);
  };
  const menuBoard = menu ? boards.find((board) => board.id === menu.id) : undefined;
  const tagBoard = tagEdit ? boards.find((board) => board.id === tagEdit.id) : undefined;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-[#aebccd]">
        <span aria-hidden className="text-[#c9b8ec]">
          ✦
        </span>
        {title ?? "Boards"}
        <span className="font-medium text-fg-muted">{boards.length}</span>
        {isLoading ? <LoaderCircle className="h-3 w-3 animate-spin text-fg-muted" /> : null}
      </h3>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
      {boards.length === 0 && !isLoading ? (
        <p className="text-[12px] text-fg-muted">Nothing here yet.</p>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
        {boards.map((board) => (
          <LibraryTile
            key={board.id}
            icon={board.icon}
            name={board.name}
            subtitle={
              scope === "mine"
                ? `${board.isPublic ? "Published" : "Board"} · ${formatRelativeDate(board.createdAt)}`
                : `${board.authorName ?? "someone"} · ${formatRelativeDate(board.publishedAt ?? board.createdAt)}`
            }
            tier={board.highestTier}
            cards={board.nodeCount + board.storageCount}
            machines={board.machineCount}
            tags={board.tags}
            social={
              scope === "public" || board.isPublic
                ? {
                    score: board.score,
                    myVote: board.myVote,
                    onVote: scope === "public" ? () => void store.vote(board.id, 1) : undefined,
                    downloads: board.downloads,
                  }
                : undefined
            }
            marks={{ board: true, privatePost: scope === "mine" && !board.isPublic }}
            busy={store.busyId === board.id}
            hoverCard={() =>
              renderEntryHoverCard({
                icon: board.icon,
                name: board.name,
                authorName: board.authorName,
                createdAt: board.publishedAt ?? board.createdAt,
                cardCount: board.nodeCount + board.storageCount,
                machineCount: board.machineCount,
                tier: board.highestTier,
                description: board.description || undefined,
                needs: board.needs,
                outputs: board.outputs,
              })
            }
            menuOpen={menu?.id === board.id}
            onOpen={() => void place(board)}
            onMenu={(left, top) => {
              setArmedDeleteId(undefined);
              setMenu({ id: board.id, left, top });
            }}
            renaming={
              renamingId === board.id
                ? {
                    onCommit: (name) => {
                      setRenamingId(undefined);
                      if (name.trim() && name.trim() !== board.name) {
                        void store.update(board.id, { name: name.trim() });
                      }
                    },
                    onCancel: () => setRenamingId(undefined),
                  }
                : undefined
            }
          />
        ))}
      </div>
      {scope === "public" && store.publicHasMore ? (
        <button
          type="button"
          disabled={isLoading}
          onClick={() => void store.loadMorePublic()}
          className="flex h-7 w-full items-center justify-center rounded border border-line-strong bg-surface text-[11px] text-fg-subtle hover:text-fg disabled:opacity-50"
        >
          Load more boards
        </button>
      ) : null}

      {menu && menuBoard ? (
        <LibraryMenu
          left={menu.left}
          top={menu.top}
          label={`Options for board ${menuBoard.name}`}
          onClose={closeMenu}
        >
          <MenuItem
            label="Place on the open design"
            onClick={() => {
              closeMenu();
              void place(menuBoard);
            }}
          />
          {scope === "mine" ? (
            <>
              <MenuRule />
              <MenuItem
                label="Rename"
                onClick={() => {
                  closeMenu();
                  setRenamingId(menuBoard.id);
                }}
              />
              <MenuItem
                label={menuBoard.isPublic ? "Unpublish" : "Publish to the network"}
                onClick={() => {
                  closeMenu();
                  void store.publish(menuBoard.id, !menuBoard.isPublic);
                }}
              />
              <MenuItem
                label="Edit tags"
                onClick={() => {
                  setTagEdit({ id: menuBoard.id, left: menu.left, top: menu.top });
                  closeMenu();
                }}
              />
              <MenuItem
                label="Change icon"
                onClick={() => {
                  closeMenu();
                  setIconEditId(menuBoard.id);
                }}
              />
              <ArmedMenuItem
                label="Delete"
                armedLabel="Confirm delete"
                armed={armedDeleteId === menuBoard.id}
                onArm={() => setArmedDeleteId(menuBoard.id)}
                onFire={() => {
                  closeMenu();
                  void store.remove(menuBoard.id);
                }}
              />
            </>
          ) : null}
        </LibraryMenu>
      ) : null}

      {tagEdit && tagBoard ? (
        <TagEditor
          left={tagEdit.left}
          top={tagEdit.top}
          initialTags={tagBoard.tags ?? []}
          onClose={(tags) => {
            setTagEdit(undefined);
            if (JSON.stringify(tags) !== JSON.stringify(tagBoard.tags ?? [])) {
              void store.update(tagBoard.id, { tags });
            }
          }}
        />
      ) : null}

      {iconEditId ? (
        <IconPicker
          title="Pick an icon"
          suggestions={iconSuggestionsFromStats(
            boards.find((entry) => entry.id === iconEditId)?.needs,
            boards.find((entry) => entry.id === iconEditId)?.outputs,
          )}
          onPick={(icon: EntryIcon) => {
            setIconEditId(undefined);
            void store.update(iconEditId, { icon });
          }}
          onClear={
            boards.find((entry) => entry.id === iconEditId)?.icon
              ? () => {
                  setIconEditId(undefined);
                  void store.update(iconEditId, { icon: null });
                }
              : undefined
          }
          onClose={() => setIconEditId(undefined)}
        />
      ) : null}
    </section>
  );
}
