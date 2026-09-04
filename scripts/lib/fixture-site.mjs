/**
 * Builds and serves the layout fixtures under `scripts/layout`.
 *
 * Both the layout checker and the screenshot capture need the same site: the
 * real components, built by the real bundler, carrying the app's own tokens.
 * Stating it once means a capture cannot photograph a page the checker never
 * measures.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { build } from "vite";
import { appTokensPlugin } from "./app-token-css.mjs";

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

export async function buildFixture(outDir) {
  await build({
    configFile: false,
    root: resolve("scripts/layout"),
    base: "./",
    logLevel: "error",
    plugins: [appTokensPlugin()],
    build: { outDir, emptyOutDir: true },
  });
}

/**
 * Chromium refuses module scripts over file://, and the fixture is a real
 * module build, so it is served the way the app is served.
 */
export async function serveDirectory(directory) {
  const server = createServer((request, response) => {
    const requested = new URL(request.url ?? "/", "http://localhost").pathname;
    const filePath = resolve(directory, `.${requested === "/" ? "/index.html" : requested}`);
    if (!filePath.startsWith(resolve(directory))) {
      response.statusCode = 403;
      response.end();
      return;
    }
    stat(filePath).then(
      () => {
        response.setHeader("Content-Type", CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream");
        createReadStream(filePath).pipe(response);
      },
      () => {
        response.statusCode = 404;
        response.end();
      },
    );
  });
  await new Promise((ready) => { server.listen(0, "127.0.0.1", ready); });
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    close: () => new Promise((done) => { server.close(done); }),
  };
}
