import { useState } from "react";
import type { BacklogClaim, BacklogItem, BacklogList, BacklogSourceSummary } from "../../backlog/backlogApi";
import type { BacklogPlace } from "../../backlog/backlogModel";
import { BacklogView, type BacklogBinding } from "./BacklogView";

export const name = "BacklogView";
export const note = "The backlog: held items first, then one group per project and one per Azure DevOps source, each source with its destination";

const fields = { path: "work/items/a.md", status: "To Do", labels: [], created: "2026-09-20", assignedToMe: true, assignees: [], open: true, readiness: "ready" as const, blockingIds: [] };
const storefront = { kind: "project" as const, projectId: "p-store", projectName: "storefront", repo: "/code/storefront" };
const fabrikam = { kind: "source" as const, sourceId: "src-web", label: "Fabrikam Web" };
const support = { kind: "source" as const, sourceId: "src-desk", label: "Support Desk" };
const routed = { kind: "routed" as const, projectId: "p-store", reason: "source-destination" as const };
const unrouted = { kind: "not-routed" as const, reason: "unset" as const };
const claim = (sessionId: string, itemId: string): BacklogClaim => ({ kind: "claimed", claimId: `c-${sessionId}`, projectId: "p-store", provider: "azure-devops", itemId,
  repo: "/code/storefront", cwd: "/code/storefront/.worktree/s-1", claimedAt: "2026-10-13T09:00:00Z", sessionId, sourceId: "src-web" });
const work = (id: string, title: string, owner: typeof fabrikam, extra: Partial<BacklogItem> = {}): BacklogItem => ({ ...fields, id: `contoso:${id}`, title, provider: "azure-devops",
  path: `contoso/${owner.label}#${id}`, priority: "2", owner, destination: owner === fabrikam ? routed : unrouted, ...extra } as BacklogItem);
const items: BacklogItem[] = [
  work("4811", "Checkout total ignores the second discount code", fabrikam, { claim: claim("s-checkout", "contoso:4811"), readiness: "claimed",
    contested: { claims: [claim("s-checkout", "contoso:4811"), claim("s-old", "contoso:4811")], message: "Azure work item has contested claims held by: s-checkout, s-old." } }),
  work("4812", "Refund button stays grey after a partial refund", fabrikam),
  work("4815", "Gift card balance shows the old currency", fabrikam, { priority: "1" }),
  work("118", "Reply macro drops the agent's signature", support),
  { ...fields, id: "01K2", title: "Move image resizing to the edge worker", provider: "markdown", projectId: "p-store", projectName: "storefront", repo: "/code/storefront",
    owner: storefront, destination: { kind: "routed", projectId: "p-store", reason: "project-owned" }, priority: "high" },
];
const sources: BacklogSourceSummary[] = [
  { sourceId: "src-web", label: "Fabrikam Web", provider: "azure-devops", organization: "contoso", areaPath: "Fabrikam Web\\Checkout", destination: routed, warnings: [] },
  { sourceId: "src-desk", label: "Support Desk", provider: "azure-devops", organization: "contoso", destination: unrouted, warnings: [] },
];
const list: BacklogList = { items, sources, warnings: [], projects: [{ projectId: "p-store", providers: ["markdown"] }], generatedAt: "2026-10-13T10:00:00Z" };

function Stateful({ start }: { start: BacklogPlace }) {
  const [place, setPlace] = useState(start);
  const binding: BacklogBinding = {
    load: { type: "ready", value: list }, onRefresh: () => undefined, projects: [{ id: "p-store", name: "storefront" }],
    api: {
      detail: async (ref) => {
        const item = items.find((entry) => entry.id === ref.itemId)!;
        return { item, body: "The total drops the second code when both codes apply to one line.", initialPrompt: "" };
      },
      release: async () => ({ released: true }),
    },
    look: (id) => id === "s-checkout" ? { state: "working", name: "Checkout discounts", time: "12m" } : undefined,
    onPlace: setPlace, onLaunch: () => undefined, onOpenSession: () => undefined,
  };
  return <BacklogView place={place} binding={binding} />;
}
export default function Sources() { return <Stateful start={{}} />; }
export function NotRoutedItem() { return <Stateful start={{ item: { sourceId: "src-desk", itemId: "contoso:118", provider: "azure-devops" } }} />; }
