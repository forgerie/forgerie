/// <reference types="vitest/config" />
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { caliper } from "@simonwjackson/caliper";
import { DEFAULT_AUI_ALLOWED_HOSTS, speechProxyRequestHeaders } from "./src/speech/speechProxy";

const allowedHosts = [...DEFAULT_AUI_ALLOWED_HOSTS, ...(process.env.FORGERIE_AUI_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean)];
const certPath = process.env.FORGERIE_AUI_TLS_CERT;
const keyPath = process.env.FORGERIE_AUI_TLS_KEY;
if (!!certPath !== !!keyPath) throw new Error("Set both FORGERIE_AUI_TLS_CERT and FORGERIE_AUI_TLS_KEY.");
const https = certPath && keyPath ? { cert: readFileSync(certPath), key: readFileSync(keyPath) } : undefined;
const backend = process.env.FORGERIE_API_URL ?? "http://127.0.0.1:8504";

/** Names the entry script in build.json, so an open app can tell that a new build was deployed (src/appUpdate.ts). */
function buildManifest(): Plugin {
  return {
    name: "forgerie-build-manifest",
    apply: "build",
    generateBundle(_options, bundle) {
      const entries = Object.values(bundle).filter((output) => output.type === "chunk" && output.isEntry);
      const entry = entries.length === 1 ? entries[0] : undefined;
      if (!entry) throw new Error(`build.json names one entry script; the build has ${String(entries.length)}.`);
      this.emitFile({ type: "asset", fileName: "build.json", source: `${JSON.stringify({ entry: entry.fileName.split("/").pop() })}\n` });
    },
  };
}

/**
 * The acceptance device, the Samsung Galaxy Z Fold 8, in its four postures (AGENTS.md).
 * The CSS viewports were measured on the device in Chrome, so they exclude the browser's bars.
 * The millimetres are an estimate: the viewport at DPR 2.625, divided by the panel's pixel
 * density from its published size (main 7.6" 2448 x 1848, cover 5.5" 1972 x 1248).
 */
const MAIN_MM_PER_CSS_PX = (2.625 / (Math.hypot(2448, 1848) / 7.6)) * 25.4;
const COVER_MM_PER_CSS_PX = (2.625 / (Math.hypot(1972, 1248) / 5.5)) * 25.4;
function fold(id: string, name: string, cssWidth: number, cssHeight: number, mmPerPx: number) {
  const mm = (px: number) => Math.round(px * mmPerPx * 10) / 10;
  return { id, name, cssWidth, cssHeight, widthMm: mm(cssWidth), heightMm: mm(cssHeight),
    viewportNote: "Viewport measured on the device. Size in mm is an estimate from the panel's published size." };
}
const foldPostures = [
  fold("fold8-unfolded-portrait", "Fold 8 unfolded, portrait", 704, 783, MAIN_MM_PER_CSS_PX),
  fold("fold8-unfolded-landscape", "Fold 8 unfolded, landscape", 932, 553, MAIN_MM_PER_CSS_PX),
  fold("fold8-folded-portrait", "Fold 8 folded, portrait", 475, 638, COVER_MM_PER_CSS_PX),
  fold("fold8-folded-landscape", "Fold 8 folded, landscape", 711, 374, COVER_MM_PER_CSS_PX),
];
/** A desktop window, for sheets that change layout above the Fold's widths. The millimetres assume a 24" 1920 x 1080 monitor. */
const desktop = { id: "desktop-1440", name: "Desktop, 1440 x 900", cssWidth: 1440, cssHeight: 900, widthMm: 398.3, heightMm: 248.9 };

export default defineConfig({
  // Caliper is a dev-server tool. Vitest also starts a serve-mode server, which must not announce itself to the Caliper app.
  plugins: [react(), buildManifest(), ...(process.env.VITEST ? [] : [caliper({ devices: [...foldPostures, desktop] })])],
  // Relative asset URLs: Forgerie can be served below a path prefix.
  base: "./",
  resolve: {
    // Wire contracts shared with Forgerie's server.
    alias: { "@shared": fileURLToPath(new URL("../src/shared", import.meta.url)) },
    // Shared contracts import zod from the server's node_modules; keep one copy.
    dedupe: ["zod"],
  },
  build: { outDir: "../dist/client", emptyOutDir: true },
  test: { setupFiles: ["./src/testSetup.ts"] },
  server: {
    https,
    host: "::",
    allowedHosts,
    // Worktree dev servers may reuse installed dependencies through a symlink.
    // Font URLs need the real dependency root, not access to the whole parent checkout.
    fs: { allow: [".", "../src/shared", realpathSync(fileURLToPath(new URL("./node_modules", import.meta.url)))] },
    proxy: {
      "/aui": { target: backend },
      "/api": {
        target: backend, ws: true,
        configure(proxy) {
          proxy.on("proxyReq", (upstream, request) => {
            const headers = speechProxyRequestHeaders(request.url, request.headers, allowedHosts);
            if (!headers) return;
            upstream.setHeader("host", headers.host);
            upstream.setHeader("origin", headers.origin);
          });
        },
      },
    },
  },
});
