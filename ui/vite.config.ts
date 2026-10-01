import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { DEFAULT_AUI_ALLOWED_HOSTS, speechProxyRequestHeaders } from "./src/speech/speechProxy";

const allowedHosts = [...DEFAULT_AUI_ALLOWED_HOSTS, ...(process.env.FORGERIE_AUI_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean)];
const certPath = process.env.FORGERIE_AUI_TLS_CERT;
const keyPath = process.env.FORGERIE_AUI_TLS_KEY;
if (!!certPath !== !!keyPath) throw new Error("Set both FORGERIE_AUI_TLS_CERT and FORGERIE_AUI_TLS_KEY.");
const https = certPath && keyPath ? { cert: readFileSync(certPath), key: readFileSync(keyPath) } : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    https,
    host: "::",
    allowedHosts,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8504", ws: true,
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
