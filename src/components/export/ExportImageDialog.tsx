"use client";

import { Check, Eye, EyeOff, ImageDown, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toBlob, toSvg } from "html-to-image";
import { computeCommunityPlanStats } from "@/lib/community/plan-stats";
import type { PlanResourceStat } from "@/lib/community/types";
import { serializeFactoryProject } from "@/lib/import-export";
import {
  FLOW_IMAGE_EXPORT_COMPLETE_EVENT,
  FLOW_IMAGE_EXPORT_EVENT,
  dataUrlToText,
  embedProjectJsonInPng,
  embedProjectJsonInSvg,
  type FlowExportCapture,
} from "@/lib/import-export/plan-image";
import { resolveExportFontCss } from "@/lib/import-export/export-fonts";
import {
  composeExportSvg,
  compositeExportPng,
  computeCompositeLayout,
  resolveExportBorderWidth,
  type ExportBorder,
} from "@/lib/import-export/export-composite";
import { randomUUID } from "@/lib/random-id";
import {
  CANVAS_THEMES,
  getCanvasTheme,
  type CanvasThemeId,
} from "@/components/flow/canvas-themes";
import { readBoardViewSnapshot } from "@/components/flow/board-view";
import { useFactoryStore } from "@/store/factory-store";
import { useDesignStore } from "@/store/design-store";
import { ExportFooter, resolveExportFooterWidth, resolveExportTone } from "./ExportFooter";
import { renderPlanGif } from "./gif-export";

type ExportFormat = "png" | "svg" | "gif";
type ExportBackground = CanvasThemeId | "transparent";
type ExportCardDetail = "full" | "glance";

interface CaptureResult {
  capture?: FlowExportCapture;
  error?: string;
}

const FORMATS: Array<{ id: ExportFormat; label: string }> = [
  { id: "png", label: "PNG" },
  { id: "svg", label: "SVG" },
  { id: "gif", label: "GIF" },
];

/** "auto" resolves against the bar's tone; anything else is the colour. */
type ExportBorderChoice = "none" | "auto" | string;

const BORDER_SWATCHES: Array<{ id: ExportBorderChoice; title: string; swatch: string }> = [
  { id: "auto", title: "Frame: steel", swatch: "#454a52" },
  { id: "#22d3ee", title: "Frame: cyan", swatch: "#22d3ee" },
  { id: "#34d399", title: "Frame: emerald", swatch: "#34d399" },
  { id: "#fbbf24", title: "Frame: amber", swatch: "#fbbf24" },
  { id: "#f87171", title: "Frame: red", swatch: "#f87171" },
  { id: "#e8e9ec", title: "Frame: white", swatch: "#e8e9ec" },
  { id: "#000000", title: "Frame: black", swatch: "#000000" },
];

/** The checkerboard every image editor uses for "nothing here". */
const CHECKER_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-conic-gradient(#3a3d42 0% 25%, #26282d 0% 50%)",
  backgroundSize: "16px 16px",
};

/**
 * Export the board as a picture, dressed for sharing: a live preview, the
 * paper colour of your choice, and a summary bar that says what the plan
 * needs and makes so the image answers questions on its own. PNG and SVG
 * carry the plan itself; a GIF carries the motion.
 */
export function ExportImageDialog({ onClose }: { onClose: () => void }) {
  const project = useFactoryStore((state) => state.project);
  const result = useFactoryStore((state) => state.lastResult);
  const manifest = useFactoryStore((state) => state.datasetManifest);
  const selectedDatasetVersionId = useFactoryStore((state) => state.selectedDatasetVersionId);
  const activeTabName = useDesignStore(
    (state) =>
      state.designs.find((design) => design.id === state.activeDesignId)?.name ?? "Untitled",
  );

  const [format, setFormat] = useState<ExportFormat>("png");
  const [background, setBackground] = useState<ExportBackground>(
    () => readBoardViewSnapshot().canvasTheme,
  );
  const [cardDetail, setCardDetail] = useState<ExportCardDetail>("full");
  const [border, setBorder] = useState<ExportBorderChoice>("auto");
  const [includeFooter, setIncludeFooter] = useState(true);
  const [includeTitle, setIncludeTitle] = useState(true);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [capture, setCapture] = useState<FlowExportCapture>();
  const [isCapturing, setCapturing] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  // Uncapped: a base with two hundred boundary resources prints them all
  // unless its owner unchecks some.
  const stats = useMemo(
    () => computeCommunityPlanStats(project, result, Number.POSITIVE_INFINITY),
    [project, result],
  );
  const backgroundColor =
    background === "transparent" ? undefined : getCanvasTheme(background).base;
  const tone = resolveExportTone(backgroundColor);
  const borderColor =
    border === "none" ? undefined : border === "auto" ? (tone === "light" ? "#b3a884" : "#454a52") : border;
  const gameVersion = manifest?.versions.find(
    (version) => version.id === selectedDatasetVersionId,
  )?.gtnhVersion;
  const planName = project.name || activeTabName || "My factory";

  const needs = useMemo(
    () => stats.needs.filter((stat) => !excluded.has(statKey(stat))),
    [stats.needs, excluded],
  );
  const outputs = useMemo(
    () => stats.outputs.filter((stat) => !excluded.has(statKey(stat))),
    [stats.outputs, excluded],
  );

  // ---- Asking the board for its photograph ------------------------------

  const pendingRef = useRef(new Map<string, (result: CaptureResult) => void>());
  useEffect(() => {
    const handleComplete = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { requestId?: unknown; capture?: FlowExportCapture; error?: unknown }
        | undefined;
      if (typeof detail?.requestId !== "string") {
        return;
      }
      const resolve = pendingRef.current.get(detail.requestId);
      if (resolve) {
        pendingRef.current.delete(detail.requestId);
        resolve({
          capture: detail.capture,
          error: typeof detail.error === "string" ? detail.error : undefined,
        });
      }
    };

    window.addEventListener(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, handleComplete);
    return () => window.removeEventListener(FLOW_IMAGE_EXPORT_COMPLETE_EVENT, handleComplete);
  }, []);

  const requestBoardCapture = useCallback(
    (captureFormat: "png" | "svg") =>
      new Promise<CaptureResult>((resolve) => {
        const requestId = randomUUID();
        pendingRef.current.set(requestId, resolve);
        window.dispatchEvent(
          new CustomEvent(FLOW_IMAGE_EXPORT_EVENT, {
            detail: {
              format: captureFormat,
              requestId,
              capture: true,
              background: background === "transparent" ? "transparent" : backgroundColor,
              cardDetail,
            },
          }),
        );
        // A board that never answers (no viewport mounted) must not hang the
        // dialog on a spinner forever.
        window.setTimeout(() => {
          if (pendingRef.current.delete(requestId)) {
            resolve({ error: "Timed out photographing the board." });
          }
        }, 120_000);
      }),
    [background, backgroundColor, cardDetail],
  );

  // The preview is one capture per background: everything else the dialog
  // offers (the bar, its rows, the title) composes on top without asking the
  // board again.
  useEffect(() => {
    let cancelled = false;
    setCapturing(true);
    setError(undefined);
    const attempt = (retriesLeft: number) => {
      void requestBoardCapture("png").then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.capture?.blob) {
          if (retriesLeft > 0) {
            window.setTimeout(() => {
              if (!cancelled) {
                attempt(retriesLeft - 1);
              }
            }, 700);
            return;
          }
          setCapturing(false);
          setError(
            result.error ?? "The board could not be captured. Close the dialog and try again.",
          );
          return;
        }
        setCapture(result.capture);
        setCapturing(false);
      });
    };
    attempt(2);
    return () => {
      cancelled = true;
    };
  }, [requestBoardCapture]);

  const previewUrl = useMemo(
    () => (capture?.blob ? URL.createObjectURL(capture.blob) : undefined),
    [capture],
  );
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // ---- Measuring the pieces the composite needs -------------------------

  const [previewWidth, setPreviewWidth] = useState(0);
  const previewShellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const shell = previewShellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => setPreviewWidth(shell.clientWidth));
    observer.observe(shell);
    setPreviewWidth(shell.clientWidth);
    return () => observer.disconnect();
  }, []);

  const [footerElement, setFooterElement] = useState<HTMLDivElement | null>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  useEffect(() => {
    if (!footerElement || typeof ResizeObserver === "undefined") {
      setFooterHeight(0);
      return;
    }
    const observer = new ResizeObserver(() => setFooterHeight(footerElement.offsetHeight));
    observer.observe(footerElement);
    setFooterHeight(footerElement.offsetHeight);
    return () => observer.disconnect();
  }, [footerElement]);

  const footerVisible =
    includeFooter && (includeTitle || needs.length > 0 || outputs.length > 0);
  const footerWidth = capture ? resolveExportFooterWidth(capture.width) : 0;
  const layout = useMemo(
    () =>
      capture
        ? computeCompositeLayout(
            capture.width,
            capture.height,
            footerVisible ? footerWidth : 0,
            footerVisible ? footerHeight : 0,
          )
        : undefined,
    [capture, footerVisible, footerWidth, footerHeight],
  );
  const previewScale = capture && previewWidth > 0 ? previewWidth / capture.width : 0;
  const exportBorder: ExportBorder | undefined =
    borderColor && capture
      ? { color: borderColor, width: resolveExportBorderWidth(capture.width) }
      : undefined;

  // ---- The export itself ------------------------------------------------

  const exportNow = async () => {
    if (!capture || !layout || busy) {
      return;
    }
    setError(undefined);
    setSaved(false);
    try {
      const fileName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "factory";
      const projectJson = serializeFactoryProject(project);
      const wantFooter = footerVisible && footerElement !== null && layout.footerHeight > 0;
      const fontEmbedCSS =
        wantFooter && footerElement ? await resolveExportFontCss(footerElement) : undefined;

      if (format === "svg") {
        setBusy("Rendering the SVG");
        const svgResult = await requestBoardCapture("svg");
        const svgCapture = svgResult.capture;
        if (!svgCapture?.svgText) {
          throw new Error(svgResult.error ?? "The board could not be rendered as SVG.");
        }
        const footerSvg =
          wantFooter && footerElement
            ? dataUrlToText(
                await toSvg(footerElement, {
                  width: layout.footerWidth,
                  height: layout.footerHeight,
                  skipFonts: true,
                  fontEmbedCSS,
                }),
              )
            : undefined;
        const composed = composeExportSvg({
          boardSvg: svgCapture.svgText,
          footerSvg,
          layout,
          background: backgroundColor,
          border: exportBorder,
        });
        downloadBlob(
          new Blob([embedProjectJsonInSvg(composed, projectJson)], { type: "image/svg+xml" }),
          `${fileName}.svg`,
        );
      } else {
        if (!capture.blob) {
          throw new Error("The board capture is missing.");
        }
        setBusy("Composing the image");
        const footerBlob =
          wantFooter && footerElement
            ? ((await toBlob(footerElement, {
                width: layout.footerWidth,
                height: layout.footerHeight,
                pixelRatio: layout.footerScale * capture.pixelRatio,
                skipFonts: true,
                fontEmbedCSS,
              })) ?? undefined)
            : undefined;

        if (format === "png") {
          const composed = await compositeExportPng({
            boardBlob: capture.blob,
            footerBlob,
            layout,
            pixelRatio: capture.pixelRatio,
            background: backgroundColor,
            border: exportBorder,
          });
          setBusy("Embedding the plan");
          const withPlan = await embedProjectJsonInPng(composed, projectJson, backgroundColor);
          downloadBlob(withPlan, `${fileName}.png`);
        } else {
          const gifBlob = await renderPlanGif({
            boardBlob: capture.blob,
            footerBlob,
            layout,
            capture,
            background: backgroundColor,
            border: exportBorder,
            onProgress: (frame, total) => setBusy(`Drawing frame ${frame} of ${total}`),
          });
          downloadBlob(gifBlob, `${fileName}.gif`);
        }
      }

      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed.");
    } finally {
      setBusy(undefined);
    }
  };

  // The one line of guidance the options keep: a GIF of a board with no
  // dashes to march would save silently as a still image.
  const stillGifWarning =
    format === "gif" && capture && capture.pulses.length === 0
      ? "No flow dashes on the board right now, so this GIF will not move."
      : undefined;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-neutral-950/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-y-auto rounded border border-line-strong bg-surface p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ImageDown className="h-4 w-4" /> Export an image
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-fg-subtle hover:bg-surface-raised"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Preview: the real capture over the real bar, scaled to fit. */}
        <div
          ref={previewShellRef}
          className="relative overflow-hidden rounded border border-line bg-surface-sunken"
        >
          <div
            className="max-h-[44vh] overflow-y-auto"
            style={background === "transparent" ? CHECKER_STYLE : undefined}
          >
            {previewUrl ? (
              <div className="pointer-events-none relative select-none">
                <img src={previewUrl} alt="Board export preview" className="block w-full" />
                {footerVisible && layout && previewScale > 0 ? (
                  <div
                    style={{
                      height: layout.footerHeight * layout.footerScale * previewScale,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: layout.footerWidth,
                        transform: `scale(${layout.footerScale * previewScale})`,
                        transformOrigin: "top left",
                      }}
                    >
                      <div ref={setFooterElement}>
                        <ExportFooter
                          planName={planName}
                          icon={project.icon}
                          stats={stats}
                          gameVersion={gameVersion}
                          tone={tone}
                          width={layout.footerWidth}
                          showTitle={includeTitle}
                          needs={needs}
                          outputs={outputs}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
                {exportBorder && previewScale > 0 ? (
                  <div
                    className="absolute inset-0"
                    style={{
                      boxShadow: `inset 0 0 0 ${Math.max(
                        1,
                        exportBorder.width * previewScale,
                      )}px ${exportBorder.color}`,
                    }}
                  />
                ) : null}
              </div>
            ) : (
              <div className="h-44" />
            )}
          </div>
          {isCapturing ? (
            <div className="absolute inset-0 grid place-items-center bg-neutral-950/40">
              <span className="flex items-center gap-2 rounded border border-line-strong bg-surface px-3 py-1.5 text-sm text-fg-subtle">
                <LoaderCircle className="h-4 w-4 animate-spin" /> Photographing the board
              </span>
            </div>
          ) : null}
        </div>

        <div className="mt-3 space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-fg-subtle">Type</span>
              <div className="flex overflow-hidden rounded border border-line-strong">
                {FORMATS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setFormat(entry.id)}
                    aria-pressed={format === entry.id}
                    className={
                      format === entry.id
                        ? "bg-cyan-600 px-3 py-1 text-xs font-medium text-white"
                        : "bg-surface px-3 py-1 text-xs text-fg-subtle hover:bg-surface-raised"
                    }
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-fg-subtle">Cards</span>
              <div className="flex overflow-hidden rounded border border-line-strong">
                {(
                  [
                    { id: "full", label: "Detailed" },
                    { id: "glance", label: "Big icons" },
                  ] as const
                ).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setCardDetail(entry.id)}
                    aria-pressed={cardDetail === entry.id}
                    className={
                      cardDetail === entry.id
                        ? "bg-cyan-600 px-3 py-1 text-xs font-medium text-white"
                        : "bg-surface px-3 py-1 text-xs text-fg-subtle hover:bg-surface-raised"
                    }
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {stillGifWarning ? <p className="text-xs text-amber-500">{stillGifWarning}</p> : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-fg-subtle">Paper</span>
            {CANVAS_THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                title={theme.name}
                aria-label={`${theme.name} background`}
                aria-pressed={background === theme.id}
                onClick={() => setBackground(theme.id)}
                className={[
                  "h-6 w-6 rounded border",
                  background === theme.id
                    ? "border-cyan-500 ring-1 ring-cyan-500"
                    : "border-line-strong hover:border-fg-muted",
                ].join(" ")}
                style={{ backgroundColor: theme.base }}
              />
            ))}
            <button
              type="button"
              title="Transparent"
              aria-label="Transparent background"
              aria-pressed={background === "transparent"}
              onClick={() => setBackground("transparent")}
              className={[
                "h-6 w-6 rounded border",
                background === "transparent"
                  ? "border-cyan-500 ring-1 ring-cyan-500"
                  : "border-line-strong hover:border-fg-muted",
              ].join(" ")}
              style={CHECKER_STYLE}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-fg-subtle">Frame</span>
            <button
              type="button"
              onClick={() => setBorder("none")}
              aria-pressed={border === "none"}
              className={[
                "rounded border px-2 py-0.5 text-xs",
                border === "none"
                  ? "border-cyan-500 text-fg ring-1 ring-cyan-500"
                  : "border-line-strong text-fg-subtle hover:border-fg-muted",
              ].join(" ")}
            >
              Off
            </button>
            {BORDER_SWATCHES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                title={entry.title}
                aria-label={entry.title}
                aria-pressed={border === entry.id}
                onClick={() => setBorder(entry.id)}
                className={[
                  "h-6 w-6 rounded border",
                  border === entry.id
                    ? "border-cyan-500 ring-1 ring-cyan-500"
                    : "border-line-strong hover:border-fg-muted",
                ].join(" ")}
                style={{ backgroundColor: entry.swatch }}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={includeFooter}
                onChange={(event) => setIncludeFooter(event.target.checked)}
              />
              Summary bar
            </label>
            <label
              className={includeFooter ? "flex items-center gap-1.5" : "hidden"}
            >
              <input
                type="checkbox"
                checked={includeTitle}
                onChange={(event) => setIncludeTitle(event.target.checked)}
              />
              Title and stats
            </label>
          </div>

          {includeFooter ? (
            <div className="space-y-2">
              <ResourceChipRow
                label="Needs"
                stats={stats.needs}
                excluded={excluded}
                onToggle={(key) => setExcluded((current) => toggleKey(current, key))}
              />
              <ResourceChipRow
                label="Makes"
                stats={stats.outputs}
                excluded={excluded}
                onToggle={(key) => setExcluded((current) => toggleKey(current, key))}
              />
            </div>
          ) : null}

          {error ? <p className="text-sm text-red-500">{error}</p> : null}

          <div className="flex items-center justify-end gap-2">
            {busy ? (
              <span className="mr-auto flex items-center gap-2 text-xs text-fg-muted">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> {busy}
              </span>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-line-strong px-3 py-1.5 text-sm hover:bg-surface-raised"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => void exportNow()}
              disabled={!capture || Boolean(busy) || isCapturing}
              className="inline-flex items-center gap-2 rounded border border-cyan-700 bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <Check className="h-4 w-4" />
              ) : null}
              {saved ? "Saved" : `Save ${format.toUpperCase()}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function statKey(stat: PlanResourceStat): string {
  return `${stat.kind}:${stat.resourceId}`;
}

function toggleKey(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

/**
 * The curation row: every boundary resource as a chip, lit when it will be
 * on the bar. Unchecking noise (that one stray dust) is the whole feature,
 * so each chip wears an eye - the universal "this is a visibility toggle" -
 * rather than relying on anyone guessing that a chip is clickable. Plans
 * with hundreds of boundary resources scroll inside the row.
 */
function ResourceChipRow({
  label,
  stats,
  excluded,
  onToggle,
}: {
  label: string;
  stats: PlanResourceStat[];
  excluded: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  if (stats.length === 0) {
    return null;
  }
  return (
    <div className="flex items-start gap-2">
      <span className="w-10 shrink-0 pt-1 text-xs font-medium text-fg-subtle">{label}</span>
      <div className="flex max-h-24 min-w-0 flex-1 flex-wrap content-start gap-1 overflow-y-auto">
        {stats.map((stat) => {
          const key = statKey(stat);
          const isExcluded = excluded.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggle(key)}
              aria-pressed={!isExcluded}
              title={isExcluded ? "Show on the summary bar" : "Hide from the summary bar"}
              className={[
                "inline-flex max-w-48 items-center gap-1 rounded border px-1.5 py-0.5 text-xs",
                isExcluded
                  ? "border-line bg-surface-sunken text-fg-muted"
                  : "border-line-strong bg-surface text-fg-subtle hover:border-cyan-600",
              ].join(" ")}
            >
              {isExcluded ? (
                <EyeOff className="h-3 w-3 shrink-0" />
              ) : (
                <Eye className="h-3 w-3 shrink-0 text-cyan-500" />
              )}
              <span className={isExcluded ? "truncate line-through" : "truncate"}>
                {stat.displayName ?? stat.resourceId}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
