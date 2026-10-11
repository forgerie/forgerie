// Routes: src/server/sessions (issue proposals), owned by the server. This file only calls them.
import { useRef, useState } from "react";
import { z } from "zod";
import { IssueProposalCard, type IssueDecision, type IssueDecisionFailure } from "./IssueProposalCard";
import type { IssueProposal, IssueProposalOutcome } from "./issueProposal";

/** The session transport's request, such as `browserTransport.request`. */
export type IssueRequest = (path: string, init: RequestInit) => Promise<Response>;

const outcomeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("created"), number: z.number().int(), title: z.string(), url: z.string() }),
  z.object({ state: z.literal("dismissed") }),
]);
const conflictSchema = z.object({ outcome: outcomeSchema });
const errorSchema = z.object({ error: z.string() });
// Creating waits on GitHub; dismissing is a local write.
const TIMEOUT_MS: Record<IssueDecision, number> = { create: 60_000, dismiss: 15_000 };

/**
 * Sends one decision and resolves to the outcome the server saved. A 409
 * means it was decided already, elsewhere or by an earlier press: its saved
 * outcome is the answer, not a failure. Anything else throws words for the reader.
 */
async function decide(request: IssueRequest, sessionId: string, cwd: string, proposalId: string, decision: IssueDecision): Promise<IssueProposalOutcome> {
  let response: Response;
  try {
    response = await request(`/api/sessions/${encodeURIComponent(sessionId)}/issue-proposals/${encodeURIComponent(proposalId)}/${decision}`, {
      method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd }),
      signal: AbortSignal.timeout(TIMEOUT_MS[decision]),
    });
  } catch (error) {
    throw new Error(error instanceof DOMException && error.name === "TimeoutError"
      ? "The server did not answer in time. Retry to find out whether the issue exists."
      : "The request did not reach the server. Check the connection, then retry.", { cause: error });
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) {
    const outcome = outcomeSchema.safeParse(body);
    if (outcome.success) return outcome.data;
    throw new Error("The server's answer could not be read.");
  }
  if (response.status === 409) {
    const conflict = conflictSchema.safeParse(body);
    if (conflict.success) return conflict.data.outcome;
  }
  const problem = errorSchema.safeParse(body);
  throw new Error(problem.success ? problem.data.error : `The server answered with status ${String(response.status)}.`);
}

/**
 * Binding for one proposal row: it calls the create and dismiss routes and
 * holds what is in flight, the last failure, and the route's answer. Once
 * the transcript carries the outcome, the transcript wins. A failure is local:
 * it never reaches the transcript, and a reload shows the card open again.
 */
export function IssueProposalEntry({ proposal, sessionId, cwd, readOnly, request }: {
  proposal: IssueProposal;
  sessionId: string | undefined;
  cwd: string | undefined;
  readOnly: boolean;
  request: IssueRequest;
}) {
  const [pending, setPending] = useState<IssueDecision>();
  const [failure, setFailure] = useState<IssueDecisionFailure>();
  const [answer, setAnswer] = useState<IssueProposalOutcome>();
  // A second press before React draws the disabled buttons must not send a second request.
  const inFlight = useRef(false);
  const outcome = proposal.outcome ?? answer;
  const send = async (decision: IssueDecision) => {
    if (inFlight.current || sessionId === undefined || cwd === undefined) return;
    inFlight.current = true;
    setPending(decision);
    setFailure(undefined);
    try { setAnswer(await decide(request, sessionId, cwd, proposal.proposalId, decision)); }
    catch (error) { setFailure({ decision, message: error instanceof Error ? error.message : String(error) }); }
    finally { inFlight.current = false; setPending(undefined); }
  };
  const decidable = !readOnly && sessionId !== undefined && cwd !== undefined && outcome === undefined;
  return <IssueProposalCard proposal={proposal} outcome={outcome} pending={pending} failure={failure}
    onCreate={decidable ? () => { void send("create"); } : undefined}
    onDismiss={decidable ? () => { void send("dismiss"); } : undefined} />;
}
