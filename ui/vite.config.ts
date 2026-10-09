/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { DEFAULT_AUI_ALLOWED_HOSTS, speechProxyRequestHeaders } from "./src/speech/speechProxy";

const allowedHosts = [...DEFAULT_AUI_ALLOWED_HOSTS, ...(process.env.FORGERIE_AUI_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean)];
const certPath = process.env.FORGERIE_AUI_TLS_CERT;
const keyPath = process.env.FORGERIE_AUI_TLS_KEY;
if (!!certPath !== !!keyPath) throw new Error("Set both FORGERIE_AUI_TLS_CERT and FORGERIE_AUI_TLS_KEY.");
const https = certPath && keyPath ? { cert: readFileSync(certPath), key: readFileSync(keyPath) } : undefined;
const backend = process.env.FORGERIE_API_URL ?? "http://127.0.0.1:8504";

export default defineConfig({
  plugins: [react()],
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
    fs: { allow: [".", "../src/shared"] },
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
