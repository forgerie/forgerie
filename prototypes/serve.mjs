/**
 * Minimal static server for prototypes. No dependencies — this repo's Node is
 * enough, and prototypes must not add any.
 *
 * Usage: node serve.mjs <root-dir> [port] [host]
 *
 * Host defaults to loopback. Pass 0.0.0.0 to reach it from another device on
 * the tailnet; there is no auth here, so only do that on a trusted network.
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 8600);
const host = process.argv[4] ?? "127.0.0.1";

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".md", "text/plain; charset=utf-8"],
]);

const server = createServer((request, response) => {
  void serve(request, response).catch(() => {
    response.writeHead(500).end("server error");
  });
});

async function serve(request, response) {
  const requestPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  // Contain every request inside the root; a traversal attempt resolves outside and is rejected.
  const target = resolve(join(root, normalize(requestPath)));
  if (target !== root && !target.startsWith(root + sep)) {
    response.writeHead(403).end("forbidden");
    return;
  }

  const filePath = await resolveFile(target);
  if (filePath === undefined) {
    response.writeHead(404).end("not found");
    return;
  }

  response.writeHead(200, {
    "content-type": CONTENT_TYPES.get(extname(filePath)) ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(response);
}

async function resolveFile(target) {
  try {
    const info = await stat(target);
    if (!info.isDirectory()) return target;
  } catch {
    return undefined;
  }
  const indexPath = join(target, "index.html");
  try {
    await stat(indexPath);
    return indexPath;
  } catch {
    return undefined;
  }
}

server.listen(port, host, () => {
  process.stdout.write(`serving ${root} at http://${host}:${String(port)}/\n`);
});
