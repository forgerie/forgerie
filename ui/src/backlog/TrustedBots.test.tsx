// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BacklogGitHubConfigSchema, type BacklogConfig } from "@shared/backlog";
import { BacklogSettingsView } from "./BacklogSettings.binding";
import { createBacklogSettingsApi, type BacklogSettingsApi } from "./backlogSettingsApi";
import { trustedBotProblems, trustedBotsToSend, TRUSTED_BOT_LIMIT } from "./backlogSettingsModel";

let root: Root;
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => (node.getAttribute("aria-label") ?? node.textContent) === name);
const click = async (node: HTMLElement | null | undefined) => { expect(node).toBeTruthy(); await act(async () => node!.click()); await settle(); };
const box = (name: string) => document.querySelector<HTMLInputElement>(`[aria-label="${name}"]`);
const type = async (input: HTMLInputElement | null, value: string) => {
  expect(input).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input!.dispatchEvent(new Event("input", { bubbles: true })); });
};
const text = () => document.body.textContent ?? "";
const EMPTY = "No bots listed. Their comments reach the agent as hidden text.";
const BAD_LOGIN = "Use the bot's GitHub login, which ends in [bot], such as coderabbitai[bot].";
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); const host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

/** One project, read and saved through the real API client, so the read is checked against the wire schema. */
async function open(backlog: BacklogConfig) {
  const saves: unknown[] = [];
  const api: BacklogSettingsApi = createBacklogSettingsApi(async (path, init) => {
    if (init?.method === "PUT") { saves.push(JSON.parse(String(init.body))); return Response.json({ saved: true }); }
    return Response.json(path === "/api/projects" ? [{ id: "p", name: "Project", path: "/repo" }]
      : { sources: [], projects: [{ projectId: "p", source: "forgerie", revision: 1, backlog }] });
  });
  await act(async () => root.render(<BacklogSettingsView api={api} selected="p" onOpen={() => {}} back={null} close={null} />)); await settle();
  return saves;
}
const github = (extra: Partial<NonNullable<BacklogConfig["github"]>> = {}): BacklogConfig => ({ providers: ["markdown", "github"], github: { authors: "trusted", ...extra } });
const listed = ["coderabbitai[bot]", "sourcery-ai[bot]"];

describe("trusted bots", () => {
  it("shows the empty state, adds a bot, and sends it", async () => {
    const saves = await open(github());
    expect(text()).toContain(EMPTY);
    await click(button("Add bot"));
    expect(document.activeElement).toBe(box("Trusted bot 1"));
    await type(box("Trusted bot 1"), " coderabbitai[bot] ");
    expect(text()).not.toContain(EMPTY);
    await click(button("Save changes"));
    expect(saves).toEqual([{ backlog: { providers: ["markdown", "github"], github: { authors: "trusted", trustedBots: ["coderabbitai[bot]"] } }, baseRevision: 1 }]);
  });

  it("reads the list, removes one bot by its named Remove, and leaves the list out once it is empty", async () => {
    const saves = await open(github({ trustedBots: listed }));
    expect(box("Trusted bot 1")?.value).toBe("coderabbitai[bot]");
    await click(button("Remove sourcery-ai[bot]"));
    expect(document.activeElement).toBe(box("Trusted bot 1"));
    await click(button("Save changes"));
    await click(button("Remove coderabbitai[bot]"));
    expect(document.activeElement).toBe(button("Add bot"));
    expect(text()).toContain(EMPTY);
    await click(button("Save changes"));
    expect(saves).toEqual([
      { backlog: github({ trustedBots: ["coderabbitai[bot]"] }), baseRevision: 1 },
      { backlog: github(), baseRevision: 1 },
    ]);
  });

  it("holds Save on an invalid login and names the problem on its row", async () => {
    const saves = await open(github({ trustedBots: listed }));
    await type(box("Trusted bot 2"), "sourcery-ai");
    expect(text()).toContain(BAD_LOGIN);
    expect(box("Trusted bot 2")?.getAttribute("aria-invalid")).toBe("true");
    const described = box("Trusted bot 2")!.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain(BAD_LOGIN);
    expect(described).toContain("Text from these bots reaches the agent. Other outside authors stay hidden.");
    expect(box("Trusted bot 1")?.hasAttribute("aria-invalid")).toBe(false);
    expect(button("Save changes")?.disabled).toBe(true);
    await type(box("Trusted bot 2"), "sourcery-ai[bot]");
    expect(text()).not.toContain(BAD_LOGIN);
    expect(button("Save changes")?.disabled).toBe(false);
    expect(saves).toEqual([]);
  });

  it("holds Save on a bot listed twice in any letter case", async () => {
    await open(github({ trustedBots: listed }));
    await click(button("Add bot"));
    await type(box("Trusted bot 3"), "CodeRabbitAI[bot]");
    expect(text()).toContain("Already listed as coderabbitai[bot].");
    expect(button("Save changes")?.disabled).toBe(true);
  });

  it("hides the field while all authors are listed, and still sends the list unchanged", async () => {
    const saves = await open(github({ trustedBots: listed }));
    expect(text()).toContain("Trusted bots");
    await click(document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Trusted authors only"]'));
    expect(text()).not.toContain("Trusted bots");
    expect(box("Trusted bot 1")).toBeNull();
    await click(button("Save changes"));
    expect(saves).toEqual([{ backlog: { providers: ["markdown", "github"], github: { authors: "all", trustedBots: listed } }, baseRevision: 1 }]);
  });

  it("hides the field while GitHub is off, and sends no GitHub settings", async () => {
    const saves = await open({ providers: ["markdown"] });
    expect(text()).not.toContain("Trusted bots");
    await click(document.querySelector<HTMLInputElement>(".choice-list-rows li:nth-child(2) input"));
    expect(text()).toContain(EMPTY);
    await click(document.querySelector<HTMLInputElement>(".choice-list-rows li:nth-child(2) input"));
    expect(text()).not.toContain("Trusted bots");
    await click(button("Save changes"));
    expect(saves).toEqual([{ backlog: { providers: ["markdown"] }, baseRevision: 1 }]);
  });

  it("turns Add bot off at the limit", async () => {
    await open(github({ trustedBots: Array.from({ length: TRUSTED_BOT_LIMIT }, (_, index) => `bot-${String(index)}[bot]`) }));
    expect(button("Add bot")?.disabled).toBe(true);
    expect(text()).toContain(`A project lists at most ${String(TRUSTED_BOT_LIMIT)} bots.`);
  });
});

describe("trusted bot rows", () => {
  it("names a problem only on a filled row, and sends only filled rows without one", () => {
    const rows = ["coderabbitai[bot]", " ", "coderabbit", "CODERABBITAI[bot]", "-lead[bot]", "a".repeat(40) + "[bot]", "sourcery-ai[bot]"];
    expect(trustedBotProblems(rows)).toEqual([undefined, undefined, BAD_LOGIN, "Already listed as coderabbitai[bot].", BAD_LOGIN, BAD_LOGIN, undefined]);
    expect(trustedBotsToSend(rows)).toEqual(["coderabbitai[bot]", "sourcery-ai[bot]"]);
  });
  it("holds the limit the wire schema holds", () => {
    expect(TRUSTED_BOT_LIMIT).toBe((BacklogGitHubConfigSchema.properties.trustedBots as { maxItems?: number }).maxItems);
  });
});
