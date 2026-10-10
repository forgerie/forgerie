import { expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { ConfiguredServicesLauncher, servicesFixture } from "../workspaces/workspaceServices.testSupport.js";
import { servicesToolRuntime } from "./workspaceServicesTool.testSupport.js";
import type { DurableSessionRuntime } from "./durableSessionRuntime.js";

it("executes the native tool through Durable and disposes observers on fork and close without stopping services", async () => {
  const launcher = new ConfiguredServicesLauncher(); launcher.ready = false;
  const f = await servicesFixture(launcher);
  let runtime: DurableSessionRuntime | undefined;
  try {
    const record = await f.add("one");
    const sdk = await servicesToolRuntime(record.path, f.root, f.services); runtime = sdk.runtime;
    sdk.provider.setResponses([
      fauxAssistantMessage([fauxToolCall("workspace_services", { action: "start", approve: true })], { stopReason: "toolUse" }),
      fauxAssistantMessage("services started"),
    ]);
    await runtime.session.prompt("Start this repository's services. I approve execution.");
    expect(runtime.session.messages.some((message) => message.role === "toolResult" && message.toolName === "workspace_services" && !message.isError)).toBe(true);
    expect(sdk.provider.state.callCount).toBe(2);
    expect(launcher.launches).toBe(1);
    const leaf = sdk.manager.getLeafId();
    if (leaf === null) throw new Error("Missing saved native-tool conversation");
    await runtime.fork(leaf, { position: "at" });
    launcher.ready = true;
    // An outgoing SDK callback is stale now. A leaked observer would throw here.
    await f.services.action(record.id, { action: "restart", service: "web" });
    await runtime.dispose();
    launcher.status = "Error";
    await f.services.action(record.id, { action: "restart", service: "web" });
    expect(await f.services.status(record.id)).toMatchObject({ kind: "running" });
    expect(launcher.alive).toBe("alive");
    expect(sdk.errors).toEqual([]);
    expect(sdk.provider.state.callCount).toBe(2);
  } finally { await runtime?.dispose(); await f.dispose(); }
});
