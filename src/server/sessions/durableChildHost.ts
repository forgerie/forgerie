import type { ChildRun } from "../../shared/childRuns.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DurableSdkTools } from "./durableSdkTools.js";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { durableChildExtensions, type DurableChildExtensions, type DurableChildExtensionOptions } from "./durableChildAgents.js";
import { ChildAgentCatalog } from "./durableChildProfiles.js";
import type { SessionWorktrees } from "../workspaces/sessionWorktrees.js";
import type { DurableChildWorktrees } from "./durableChildWorktrees.js";
import type { ChildRunStore } from "./childRunStore.js";
import type { ChildSkill } from "./durableChildRuntime.js";

export interface DurableChildSessionRef { id: string; cwd: string }

/** What a Durable session needs from the daemon to host child agents. */
export interface DurableChildHost {
  extensions(input: { cwd: string; agentDir: string; projectContext: string; sessionSkills?: readonly ChildSkill[]; sessionTools?: () => DurableSdkTools; worktrees?: DurableChildWorktrees; flushRunRecords?: () => Promise<void>; commit?: DurableChildExtensionOptions["commit"] }): Promise<DurableChildExtensions>;
  worktrees?: SessionWorktrees;
  runRecords?: ChildRunStore;
  runFinished?: (run: ChildRun) => Promise<void>;
  runRecordError?: (error: unknown) => void;
  /** Called when a session gains or loses live child work, so worktree cleanup can protect its owner. */
  liveChanged(ref: DurableChildSessionRef, live: boolean): void;
}

/**
 * Best-effort index of sessions with live child work, used to protect worktrees during cleanup. Startup recovery
 * discovers unfinished work from Durable journals, so a missed index write cannot strand a child.
 */
export class LiveChildSessionIndex {
  private refs = new Map<string, DurableChildSessionRef>();
  private loaded: Promise<void> | undefined;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async list(): Promise<DurableChildSessionRef[]> {
    await this.load();
    return [...this.refs.values()];
  }

  set(ref: DurableChildSessionRef, live: boolean): Promise<void> {
    this.writing = this.writing.then(async () => {
      await this.load();
      const had = this.refs.has(ref.id);
      if (live === had) return;
      if (live) this.refs.set(ref.id, { id: ref.id, cwd: ref.cwd });
      else this.refs.delete(ref.id);
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${String(process.pid)}.tmp`;
      await writeFile(temp, `${JSON.stringify([...this.refs.values()], null, 2)}\n`, "utf8");
      await rename(temp, this.path);
    });
    return this.writing;
  }

  private load(): Promise<void> {
    this.loaded ??= readFile(this.path, "utf8").then((text) => {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) return;
      for (const item of parsed.values()) {
        const ref = sessionRef(item);
        if (ref !== undefined) this.refs.set(ref.id, ref);
      }
    }, () => undefined);
    return this.loaded;
  }
}

function sessionRef(value: unknown): DurableChildSessionRef | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const id: unknown = Reflect.get(value, "id");
  const cwd: unknown = Reflect.get(value, "cwd");
  return typeof id === "string" && typeof cwd === "string" ? { id, cwd } : undefined;
}

export interface DurableChildHostOptions {
  /** The user's own agent folder, normally `~/.agents`. Its files rank below project files and above profile files. */
  homeAgentsDir?: string;
  /** Built-in agent folders, after project and profile files, in order. */
  builtinAgentsDirs?: readonly string[];
  index?: LiveChildSessionIndex;
  worktrees?: SessionWorktrees;
  extraTools?: readonly ToolRegistration[];
  childToolsDeny?: readonly string[];
  onIndexError?: (error: unknown) => void;
  runRecords?: ChildRunStore;
  onRunFinished?: (run: ChildRun) => Promise<void>;
  onRunRecordError?: (error: unknown) => void;
}

export function createDurableChildHost(options: DurableChildHostOptions = {}): DurableChildHost {
  return {
    ...(options.onRunFinished === undefined ? {} : { runFinished: options.onRunFinished }),
    ...(options.runRecords === undefined ? {} : { runRecords: options.runRecords }),
    ...(options.onRunRecordError === undefined ? {} : { runRecordError: options.onRunRecordError }),
    ...(options.worktrees === undefined ? {} : { worktrees: options.worktrees }),
    async extensions({ cwd, agentDir, projectContext, sessionSkills, sessionTools, worktrees, flushRunRecords, commit }) {
      const catalog = ChildAgentCatalog.forSession(cwd, agentDir, {
        ...(options.homeAgentsDir === undefined ? {} : { home: options.homeAgentsDir }),
        ...(options.builtinAgentsDirs === undefined ? {} : { builtin: options.builtinAgentsDirs }) });
      const agents = await catalog.list();
      return durableChildExtensions({ catalog, agents, projectContext, ...(commit === undefined ? {} : { commit }),
        ...(sessionTools === undefined ? {} : { sessionTools }), childToolsDeny: options.childToolsDeny ?? [], ...(sessionSkills === undefined ? {} : { sessionSkills }), ...(flushRunRecords === undefined ? {} : { flushRunRecords }), ...(worktrees === undefined ? {} : { worktrees }), ...(options.extraTools === undefined ? {} : { extraTools: options.extraTools }) });
    },
    liveChanged(ref, live) {
      void options.index?.set(ref, live).catch((error: unknown) => { options.onIndexError?.(error); });
    },
  };
}
