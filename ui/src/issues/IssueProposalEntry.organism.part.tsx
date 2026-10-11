import { IssueProposalEntry, type IssueRequest } from "./IssueProposalEntry";
import { CREATED, DISMISSED, GITHUB_FAILED, LONG, SHORT } from "./fixtures/proposals";

export const name = "Issue proposal entry";
export const note = "The proposal row with its decisions wired to a local stand-in for the routes; press the buttons";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A stand-in for the routes that answers after a short wait, so Creating… shows. It never fetches. */
const answering = (answer: (path: string, call: number) => Response): IssueRequest => {
  let calls = 0;
  return (path) => new Promise((resolve) => { calls += 1; const response = answer(path, calls); setTimeout(() => { resolve(response); }, 900); });
};

const routes = answering((path) => path.endsWith("/dismiss") ? json(200, DISMISSED) : json(200, CREATED));
export default function Live() {
  return <IssueProposalEntry proposal={SHORT} sessionId="session-1" cwd="/srv/forgerie" readOnly={false} request={routes} />;
}

const decidedElsewhere = answering(() => json(409, { error: "This proposal was already decided.", outcome: DISMISSED }));
export function DecidedInAnotherTab() {
  return <IssueProposalEntry proposal={SHORT} sessionId="session-1" cwd="/srv/forgerie" readOnly={false} request={decidedElsewhere} />;
}

const failsOnce = answering((path, call) => path.endsWith("/dismiss") ? json(200, DISMISSED)
  : call === 1 ? json(502, { error: GITHUB_FAILED }) : json(200, { ...CREATED, number: 1204, title: LONG.title }));
export function GitHubFailsOnce() {
  return <IssueProposalEntry proposal={LONG} sessionId="session-1" cwd="/srv/forgerie" readOnly={false} request={failsOnce} />;
}

export function ReadOnly() {
  return <IssueProposalEntry proposal={SHORT} sessionId="session-1" cwd="/srv/forgerie" readOnly request={routes} />;
}
