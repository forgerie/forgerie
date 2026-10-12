// @vitest-environment happy-dom
// The proposal row inside the real thread: the row keeps its local state while the binding's renderer changes.
import { act, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Thread } from "../ui/Thread";
import type { SystemArtifactView } from "../ui/Messages";
import { IssueProposalEntry, type IssueRequest } from "./IssueProposalEntry";
import type { IssueProposalArtifact } from "./issueProposal";
import { GITHUB_FAILED, SHORT } from "./fixtures/proposals";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const row: ThreadMessageLike = { id: "proposal", role: "system", content: [{ type: "text", text: "" }],
  metadata: { custom: { issueProposal: SHORT } satisfies IssueProposalArtifact } };
const messages = [row];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The thread with a renderer that, like the session's, is rebuilt whenever some unrelated data (`tick`) changes. */
function Fixture({ tick, request }: { tick: number; request: IssueRequest }) {
  const runtime = useExternalStoreRuntime({ messages, convertMessage: (message: ThreadMessageLike) => message, onNew: async () => {} });
  const systemArtifact = useCallback<SystemArtifactView>((custom) => {
    const proposal = (custom as Partial<IssueProposalArtifact> | undefined)?.issueProposal;
    return proposal && <IssueProposalEntry key={proposal.proposalId} proposal={proposal} sessionId="session-1" cwd="/srv/forgerie" readOnly={false} request={request} />;
  // `tick` stands for the session's other data (runs, children): each change gives the renderer a new identity.
  }, [tick, request]);
  return <AssistantRuntimeProvider runtime={runtime}><Thread systemArtifact={systemArtifact} /></AssistantRuntimeProvider>;
}
const button = (name: string) => [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === name);

describe("an issue proposal in the thread", () => {
  it("keeps Creating… and then the failure while the session's renderer changes", async () => {
    let answer: ((response: Response) => void) | undefined;
    const request = vi.fn<IssueRequest>(() => new Promise((resolve) => { answer = resolve; }));
    await act(async () => { root.render(<Fixture tick={0} request={request} />); });
    await act(async () => { button("Create issue")?.click(); });
    expect(button("Creating…")?.disabled).toBe(true);
    await act(async () => { root.render(<Fixture tick={1} request={request} />); });
    expect(button("Creating…")?.disabled).toBe(true);
    expect(button("Dismiss")?.disabled).toBe(true);
    await act(async () => { answer?.(json(502, { error: GITHUB_FAILED })); });
    await act(async () => { root.render(<Fixture tick={2} request={request} />); });
    expect(document.querySelector("[role='alert']")?.textContent).toBe(GITHUB_FAILED);
    expect(button("Retry")?.disabled).toBe(false);
    expect(request).toHaveBeenCalledOnce();
  });
});
