import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import type { DurableSessionRuntime } from "./durableSessionRuntime.js";
import { servicesToolRuntime } from "./workspaceServicesTool.testSupport.js";
import { expect, it } from "vitest";
import { ConfiguredServicesLauncher, servicesFixture } from "../workspaces/workspaceServices.testSupport.js";
import { createWorkspaceServicesTool, createWorkspaceServicesObserver } from "./workspaceServicesTool.js";

it("scopes native controls to the current worktree and enforces execution approval", async () => {
  const launcher = new ConfiguredServicesLauncher(); const f = await servicesFixture(launcher);
  let runtime: DurableSessionRuntime | undefined;
  try {
    const record = await f.add("one");
    runtime = (await servicesToolRuntime(record.path, f.root, f.services)).runtime;
    const tool = createWorkspaceServicesTool(record.path, f.services);
    const context = runtime.session.extensionRunner.createToolContext("native-test", undefined);
    const cancelled = new AbortController(); cancelled.abort();
    await expect(tool.execute("start", { action: "start", approve: true }, cancelled.signal, undefined, context)).rejects.toThrow();
    expect(launcher.launches).toBe(0);
    await expect(tool.execute("start", { action: "start" }, undefined, undefined, context)).rejects.toThrow("approval");
    await tool.execute("start", { action: "start", approve: true }, undefined, undefined, context);
    await expect(tool.execute("start-service", { action: "start", service: "web" }, undefined, undefined, context)).rejects.toThrow("approval");
    await tool.execute("start-service", { action: "start", service: "web", approve: true }, undefined, undefined, context);
    await expect(tool.execute("logs", { action: "logs" }, undefined, undefined, context)).rejects.toThrow("service name");
    const logs = await tool.execute("logs", { action: "logs", service: "web", lines: 5 }, undefined, undefined, context);
    const text = logs.content[0]; if (text?.type !== "text") throw new Error("Missing tool text"); expect(text.text).toContain("last line");
    const wait = await tool.execute("wait", { action: "wait", timeoutMs: 1000 }, undefined, undefined, context);
    const ready = wait.content[0]; if (ready?.type !== "text") throw new Error("Missing tool text"); expect(ready.text).toContain('"ready"');
    await tool.execute("stop", { action: "stop" }, undefined, undefined, context);
    const outside = createWorkspaceServicesTool(f.root, f.services);
    await expect(outside.execute("outside", { action: "status" }, undefined, undefined, context)).rejects.toThrow("managed worktree");
  } finally { await runtime?.dispose(); await f.dispose(); }
});

it("loads the native extension through Pi and queues observations without waking a turn", async () => {
  const launcher = new ConfiguredServicesLauncher(); launcher.ready = false;
  const f = await servicesFixture(launcher);
  try {
    const record = await f.add("one");
    const observer = createWorkspaceServicesObserver(record.path, f.services);
    const loader = new DefaultResourceLoader({ cwd: record.path, agentDir: join(f.root, "agent"), noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [observer.extension] });
    await loader.reload();
    const loaded = loader.getExtensions(); expect(loaded.errors).toEqual([]);
    const messages: unknown[] = [];
    loaded.runtime.sendMessage = (message, options) => { messages.push({ message, options }); };
    const extension = loaded.extensions.find((item) => item.path === "<inline:forgerie-workspace-services>");
    if (extension === undefined) throw new Error("Missing services extension");
    for (const handler of extension.handlers.get("session_start") ?? []) await handler({ type: "session_start" });
    await f.services.action(record.id, { action: "start", approve: true });
    expect(messages).toHaveLength(0);
    launcher.ready = true;
    await f.services.action(record.id, { action: "restart", service: "web" });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ message: { customType: "forgerie-workspace-services", content: "Workspace services changed:\nweb: ready, restarts 0", display: true }, options: { triggerTurn: false, deliverAs: "nextTurn" } });
    await f.services.action(record.id, { action: "restart", service: "web" });
    expect(messages).toHaveLength(1);
    launcher.status = "Error"; launcher.exitCode = 7;
    await f.services.action(record.id, { action: "restart", service: "web" });
    expect(messages).toHaveLength(2);
    for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown" });
    launcher.status = "Running";
    await f.services.action(record.id, { action: "restart", service: "web" });
    expect(messages).toHaveLength(2);
    for (const handler of extension.handlers.get("session_start") ?? []) await handler({ type: "session_start" });
    observer.dispose(); loaded.runtime.invalidate();
    launcher.status = "Error";
    await f.services.action(record.id, { action: "restart", service: "web" });
    expect(messages).toHaveLength(2);
  } finally { await f.dispose(); }
});

it("does not subscribe a main-checkout session to another worktree's services", async () => {
  const f = await servicesFixture(new ConfiguredServicesLauncher());
  try {
    const loader = new DefaultResourceLoader({ cwd: f.root, agentDir: join(f.root, "agent"), noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [createWorkspaceServicesObserver(f.root, f.services).extension] });
    await loader.reload();
    const loaded = loader.getExtensions(); expect(loaded.errors).toEqual([]);
    const messages: unknown[] = [];
    loaded.runtime.sendMessage = (message) => { messages.push(message); };
    for (const extension of loaded.extensions) for (const handler of extension.handlers.get("session_start") ?? []) await handler({ type: "session_start" });
    const record = await f.add("one"); await f.services.action(record.id, { action: "start", approve: true });
    expect(messages).toHaveLength(0);
  } finally { await f.dispose(); }
});
