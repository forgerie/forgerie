// Draws Mermaid source to SVG for the Diagram component. Mermaid is about a
// megabyte of script, so it loads on the first diagram, never with the app.

type Mermaid = typeof import("mermaid").default;
let loading: Promise<Mermaid> | undefined;
const loadMermaid = () => (loading ??= import("mermaid").then((module) => module.default));

// Mermaid keeps one global configuration, so draws run one at a time.
let queue: Promise<unknown> = Promise.resolve();
let sequence = 0;

export type DrawnDiagram = { svg: string; width: number };

/**
 * Parses and draws `source` with colours read from `themeElement`'s custom
 * properties. Rejects when the source is not valid Mermaid. Mermaid's strict
 * security level sanitizes labels and disables click handlers and scripts.
 */
export function drawDiagram(source: string, themeElement: HTMLElement): Promise<DrawnDiagram> {
  const run = queue.then(async () => {
    const mermaid = await loadMermaid();
    const theme = readTheme(themeElement);
    mermaid.initialize({
      startOnLoad: false, securityLevel: "strict", theme: "base", darkMode: theme.dark,
      fontFamily: theme.fontFamily, htmlLabels: false, flowchart: { htmlLabels: false },
      themeVariables: theme.variables,
    });
    await mermaid.parse(source);
    const id = `diagram-${++sequence}`;
    try {
      const { svg } = await mermaid.render(id, source);
      return { svg, width: naturalWidth(svg) };
    } finally {
      // A failed render leaves its scratch element in the document.
      document.getElementById(`d${id}`)?.remove();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

function naturalWidth(svg: string): number {
  const viewBox = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) [\d.]+"/.exec(svg);
  return viewBox ? Math.ceil(Number(viewBox[1])) : 0;
}

/** Mermaid's colour maths reads only hex and rgb, so resolve theme colours to sRGB hex. */
function readTheme(element: HTMLElement) {
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const background = toHex(read("--diagram-background"));
  const resolve = (name: string) => toHex(read(name), background);
  const fill = resolve("--diagram-fill");
  const ink = resolve("--diagram-ink");
  const stroke = resolve("--diagram-stroke");
  const line = resolve("--diagram-line");
  const accent = resolve("--diagram-accent");
  const dark = luminance(background) < 0.4;
  return {
    dark,
    fontFamily: style.fontFamily,
    variables: {
      darkMode: dark, background, fontFamily: style.fontFamily, fontSize: style.fontSize,
      primaryColor: fill, primaryTextColor: ink, primaryBorderColor: stroke, lineColor: line, textColor: ink,
      secondaryColor: fill, secondaryTextColor: ink, secondaryBorderColor: stroke,
      tertiaryColor: background, tertiaryTextColor: ink, tertiaryBorderColor: stroke,
      mainBkg: fill, nodeBorder: stroke, nodeTextColor: ink, clusterBkg: background, clusterBorder: stroke,
      titleColor: ink, edgeLabelBackground: background,
      actorBkg: fill, actorBorder: stroke, actorTextColor: ink, actorLineColor: line,
      signalColor: ink, signalTextColor: ink, labelBoxBkgColor: fill, labelBoxBorderColor: stroke, labelTextColor: ink,
      loopTextColor: ink, activationBkgColor: fill, activationBorderColor: stroke, sequenceNumberColor: background,
      noteBkgColor: background, noteTextColor: ink, noteBorderColor: accent,
      stateBkg: fill, stateBorder: stroke, transitionColor: line, specialStateColor: ink,
    },
  };
}

let canvas: CanvasRenderingContext2D | null | undefined;
/** Paints `color` over `under` on one pixel and reads it back, which resolves oklch, color-mix and alpha. */
function toHex(color: string, under = ""): string {
  canvas ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!canvas || color === "") return color;
  canvas.clearRect(0, 0, 1, 1);
  if (under !== "") { canvas.fillStyle = under; canvas.fillRect(0, 0, 1, 1); }
  canvas.fillStyle = color;
  canvas.fillRect(0, 0, 1, 1);
  const [red, green, blue] = canvas.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue].map((channel) => (channel ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  if (Number.isNaN(value)) return 1;
  return (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255;
}
