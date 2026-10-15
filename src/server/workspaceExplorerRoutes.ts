import { join } from "node:path";
import { PROJECT_PI_WEB_CONFIG_PATH } from "./workspaces/projectPiWebConfig.js";
import type { BrowserFileAccess } from "./browserFileAccess.js";
import type { WorkspacePathAccess } from "./workspaces/pathAccessPolicy.js";
import type { WorkspaceContext } from "./workspaces/workspaceContext.js";
import type { FastifyInstance } from "fastify";
import type { WorkspaceFileConflictResponse, WriteWorkspaceFileOptions } from "../shared/apiTypes.js";
import type { PiWebConfigService } from "./configRoutes.js";
import type { ProjectService } from "./projects/projectService.js";
import { DOCUMENT_PREVIEW_SANDBOX } from "../shared/workspaceFiles.js";
import { readWorkspaceDocumentPreview } from "./workspaces/documentPreviewService.js";
import { deleteWorkspaceFile, moveWorkspaceFile, readWorkspaceFile, WorkspaceFileConflictError, writeWorkspaceFile } from "./workspaces/fileContentService.js";
import { isAbsoluteishFileSuggestionQuery, listFileSuggestions, listPathSuggestions } from "./workspaces/fileSuggestions.js";
import { listWorkspaceTree } from "./workspaces/fileTreeService.js";
import { readWorkspaceImagePreview } from "./workspaces/imagePreviewService.js";
import { resolveWorkspaceContext } from "./workspaces/workspaceContext.js";
import { pathAccessForWorkspaceContext } from "./workspaces/effectivePathAccess.js";
import type { WorkspaceService } from "./workspaces/workspaceService.js";

const arbitraryFileContentType = /^([a-z]+\/[a-z0-9.+-]+)$/u;

export interface WorkspaceExplorerRouteOptions {
  fileAccess?: (() => Promise<BrowserFileAccess>) | undefined;
  config?: Pick<PiWebConfigService, "read">;
}

export function registerWorkspaceExplorerRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceService, prefix = "/api", options: WorkspaceExplorerRouteOptions = {}): void {
  registerWorkspaceFileContentParsers(app);
  const accessFor = async (context: WorkspaceContext): Promise<WorkspacePathAccess> => {
    const browserFiles = await options.fileAccess?.();
    await browserFiles?.assertReadable(join(context.project.path, PROJECT_PI_WEB_CONFIG_PATH));
    return { ...await pathAccessForWorkspaceContext(context, options.config), ...browserFiles === undefined ? {} : { browserFiles } };
  };

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/tree`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await listWorkspaceTree(context.root, request.query.path, await accessFor(context));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await readWorkspaceFile(context.root, request.query.path, await accessFor(context));
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put<{ Params: { projectId: string; workspaceId: string }; Body: Buffer; Querystring: { path?: string; createDirs?: string; overwrite?: string; expectedVersion?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      const writeOptions: WriteWorkspaceFileOptions = {
        createDirs: request.query.createDirs !== "false",
        overwrite: request.query.overwrite !== "false",
        ...request.query.expectedVersion === undefined ? {} : { expectedVersion: request.query.expectedVersion },
      };
      return await writeWorkspaceFile(context.root, request.query.path, request.body, writeOptions, await options.fileAccess?.());
    } catch (error) {
      if (error instanceof WorkspaceFileConflictError) {
        const conflict: WorkspaceFileConflictResponse = { error: error.message, code: "conflict", ...error.version === undefined ? {} : { version: error.version } };
        return reply.code(409).send(conflict);
      }
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await deleteWorkspaceFile(context.root, request.query.path, await options.fileAccess?.());
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { projectId: string; workspaceId: string }; Querystring: { fromPath?: string; toPath?: string; createDirs?: string; overwrite?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file/move`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await moveWorkspaceFile(context.root, request.query.fromPath, request.query.toPath, {
        createDirs: request.query.createDirs !== "false",
        overwrite: request.query.overwrite === "true",
      }, await options.fileAccess?.());
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file/preview`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      const preview = await readWorkspaceImagePreview(context.root, request.query.path, await accessFor(context));
      return await reply
        .type(preview.mimeType)
        .header("Cache-Control", "private, max-age=3600")
        .header("Content-Length", String(preview.size))
        .header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'")
        .header("Last-Modified", new Date(preview.modifiedAt).toUTCString())
        .header("X-Content-Type-Options", "nosniff")
        .send(preview.stream);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Renderable view of a workspace document. Unlike `file/preview`, the file
  // path lives in the URL path so a page's relative references (`assets/x.css`)
  // resolve back through this same route. The CSP sandbox keeps a directly
  // navigated document in an opaque origin; no-cache because agents rewrite
  // these files and relative subresources cannot carry cache-busting versions.
  app.get<{ Params: { projectId: string; workspaceId: string; "*": string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/preview/*`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      const preview = await readWorkspaceDocumentPreview(context.root, request.params["*"], await accessFor(context));
      if (preview.mimeType === "text/html") void reply.header("Content-Security-Policy", `sandbox ${DOCUMENT_PREVIEW_SANDBOX}`);
      return await reply
        .type(preview.mimeType)
        .header("Cache-Control", "private, no-cache")
        .header("Content-Length", String(preview.size))
        .header("Last-Modified", new Date(preview.modifiedAt).toUTCString())
        .header("X-Content-Type-Options", "nosniff")
        .send(preview.stream);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { q?: string; kind?: "tracked" | "untracked" | "other"; mode?: "file" | "path"; scope?: "tracked" | "all" } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/files`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      const query = request.query.q ?? "";
      const pathAccess = isAbsoluteishFileSuggestionQuery(query) ? await accessFor(context) : { ...options.fileAccess === undefined ? {} : { browserFiles: await options.fileAccess() } };
      if (request.query.mode === "path") return await listPathSuggestions(context.root, query, pathAccess);
      return await listFileSuggestions(context.root, query, { kind: request.query.kind, scope: request.query.scope, pathAccess });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function registerWorkspaceFileContentParsers(app: FastifyInstance): void {
  // Fastify's default parser only handles JSON; workspace file writes need to
  // accept text and arbitrary binary payloads. This route module is registered
  // for both local aliases, so parser registration must tolerate repeats.
  if (!app.hasContentTypeParser("text/plain")) app.addContentTypeParser("text/plain", { parseAs: "string" }, (_request, body, done) => { done(null, Buffer.from(body)); });
  if (!app.hasContentTypeParser("application/octet-stream")) app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => { done(null, body); });
  if (!app.hasContentTypeParser(arbitraryFileContentType)) app.addContentTypeParser(arbitraryFileContentType, { parseAs: "buffer" }, (_request, body, done) => { done(null, body); });
}
