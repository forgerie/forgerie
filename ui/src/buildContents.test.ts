// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { describe, expect, it } from "vitest";

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("production client build contents", () => {
  it("emits deployment-relative HTML and PWA URLs", { timeout: 120_000 }, async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgerie-client-build-"));
    try {
      await build({
        root: uiRoot,
        configFile: join(uiRoot, "vite.config.ts"),
        logLevel: "silent",
        build: { outDir, emptyOutDir: true },
      });

      const html = await readFile(join(outDir, "index.html"), "utf8");
      expect(html).toContain("<title>Forgerie</title>");
      expect(html).toContain("interactive-widget=resizes-content");
      const references = htmlAssetReferences(html);
      expect(references).toContain("./favicon.svg");
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
          { src: "./pwa-icon-192.png" },
          { src: "./pwa-icon-512.png" },
        ],
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

function htmlAssetReferences(html: string): string[] {
  return Array.from(html.matchAll(/\b(?:href|src)="([^"]+)"/g), (match) => match[1] ?? "");
}
