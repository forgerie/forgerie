// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import { describe, expect, it } from "vitest";

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * These checks read what index.html, public/ and the build.json plugin produce, not the app's code.
 * Bundling the real app (Mermaid, Shiki, KaTeX) took about a minute of CPU against this test's
 * two-minute deadline (#102), and `npm run build` already bundles it. A one-line module stands in for it here.
 */
const appEntry = join(uiRoot, "src/main.tsx");
const stoodIn = new Set<string>();
const smallAppEntry: Plugin = {
  name: "small-app-entry",
  enforce: "pre",
  load(id) {
    if (id.split("?")[0] !== appEntry) return undefined;
    stoodIn.add(appEntry);
    return "export {};\n";
  },
};

describe("production client build contents", () => {
  it("emits deployment-relative HTML and PWA URLs", { timeout: 120_000 }, async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgerie-client-build-"));
    try {
      await build({
        root: uiRoot,
        configFile: join(uiRoot, "vite.config.ts"),
        logLevel: "silent",
        plugins: [smallAppEntry],
        build: { outDir, emptyOutDir: true },
      });
      // If index.html names another entry, the stand-in misses it and the whole app is bundled again.
      expect([...stoodIn]).toEqual([appEntry]);

      const html = await readFile(join(outDir, "index.html"), "utf8");
      expect(html).toContain("<title>Forgerie</title>");
      expect(html).toContain("interactive-widget=resizes-content");
      const references = htmlAssetReferences(html);
      expect(references).toContain("./favicon.svg");
      expect(references).toContain("./favicon.ico");
      expect(references).toContain("./apple-touch-icon.png");
      expect(references).toContain("./manifest.webmanifest");
      expect(references).toContainEqual(expect.stringMatching(/^\.\/assets\/index-[^/]+\.js$/u));
      expect(references.filter((reference) => reference.startsWith("/"))).toEqual([]);

      // The open app compares its entry script with this file to offer a refresh.
      const published = JSON.parse(await readFile(join(outDir, "build.json"), "utf8")) as { entry: string };
      expect(references).toContain(`./assets/${published.entry}`);

      const manifest: unknown = JSON.parse(await readFile(join(outDir, "manifest.webmanifest"), "utf8"));
      expect(manifest).toMatchObject({
        name: "Forgerie",
        short_name: "Forgerie",
        start_url: "./",
        scope: "./",
        display: "fullscreen",
        icons: [
          { src: "./icon-192.png", purpose: "any" },
          { src: "./icon-512.png", purpose: "any" },
          { src: "./icon-maskable-192.png", purpose: "maskable" },
          { src: "./icon-maskable-512.png", purpose: "maskable" },
          { src: "./icon-monochrome-512.png", purpose: "monochrome" },
          { src: "./favicon.svg", purpose: "any" },
        ],
      });

      // Every icon the page or the manifest names ships, at the size it states.
      const icons = (manifest as { icons: { src: string; sizes: string }[] }).icons;
      for (const { src, sizes } of icons) {
        const bytes = await readFile(join(outDir, src));
        if (src.endsWith(".png")) expect(`${src} ${pngSize(bytes)}`).toBe(`${src} ${sizes}`);
      }
      const splashes = Array.from(html.matchAll(/<link rel="apple-touch-startup-image" media="\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\) and \(orientation: (\w+)\)" href="([^"]+)"/g));
      expect(splashes.length).toBeGreaterThan(0);
      for (const [, width, height, ratio, orientation, href] of splashes) {
        const [w, h] = [Number(width) * Number(ratio), Number(height) * Number(ratio)];
        const expected = orientation === "portrait" ? `${w}x${h}` : `${h}x${w}`;
        expect(`${href} ${pngSize(await readFile(join(outDir, href ?? "")))}`).toBe(`${href} ${expected}`);
      }
      for (const href of ["./apple-touch-icon.png", "./social-card.png", "./safari-pinned-tab.svg", "./favicon.ico"]) {
        await expect(readFile(join(outDir, href))).resolves.toBeInstanceOf(Buffer);
      }
      expect(pngSize(await readFile(join(outDir, "apple-touch-icon.png")))).toBe("180x180");
      expect(pngSize(await readFile(join(outDir, "social-card.png")))).toBe("1200x630");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

/** A PNG's pixel size as `WxH`, from its IHDR chunk. */
function pngSize(bytes: Buffer): string {
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

function htmlAssetReferences(html: string): string[] {
  return Array.from(html.matchAll(/\b(?:href|src)="([^"]+)"/g), (match) => match[1] ?? "");
}
