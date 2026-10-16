/** A scripted stand-in for github.com and api.github.com. Each route answers from a queue, then from its default. */
export interface FakeRequest { method: string; url: string; headers: Record<string, string>; form: URLSearchParams; body: string }
type Answer = Response | ((request: FakeRequest) => Response | Promise<Response>);

export class FakeGitHub {
  readonly requests: FakeRequest[] = [];
  private readonly scripted = new Map<string, Answer[]>();
  private readonly defaults = new Map<string, Answer>();
  private inFlight = 0;
  maxInFlight = 0;

  /** `route` is `METHOD url-without-query`, for example `GET https://api.github.com/user`. */
  on(route: string, ...answers: Answer[]): this { this.scripted.set(route, [...this.scripted.get(route) ?? [], ...answers]); return this; }
  always(route: string, answer: Answer): this { this.defaults.set(route, answer); return this; }
  count(route: string): number { return this.requests.filter((request) => routeOf(request) === route).length; }

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === "string" ? init.body : "";
    const request: FakeRequest = { method: init.method ?? "GET", url: input, headers, form: new URLSearchParams(body), body };
    this.requests.push(request);
    this.inFlight++; this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      // Yield so overlapping callers would actually overlap if the client let them.
      await new Promise((resolve) => setTimeout(resolve, 1));
      const route = routeOf(request);
      const answer = this.scripted.get(route)?.shift() ?? this.defaults.get(route);
      if (answer === undefined) throw new Error(`FakeGitHub has no answer for ${route}`);
      // A body reads once, so a reused answer is cloned on every reply.
      return typeof answer === "function" ? await answer(request) : answer.clone();
    } finally { this.inFlight--; }
  };
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", ...init.headers } });
}

export function issue(number: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number, title: `Issue ${String(number)}`, body: `Body of ${String(number)}`, html_url: `https://github.com/korri-os/korri/issues/${String(number)}`,
    created_at: "2026-10-01T12:00:00Z", author_association: "OWNER", user: { login: "simonwjackson" }, labels: [{ name: "bug" }], ...extra,
  };
}

/** The `state` Forgerie put in a setup form's action, which GitHub sends back. */
export function stateOf(action: string): string {
  const state = new URL(action).searchParams.get("state");
  if (state === null) throw new Error(`No state in ${action}`);
  return state;
}
/** A value the test needs to exist, failing with a message instead of a later TypeError. */
export function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Expected ${what}`);
  return value;
}

function routeOf(request: FakeRequest): string { return `${request.method} ${request.url.split("?")[0] ?? request.url}`; }

/** REST workflow run and attempt jobs, served through the same authenticated caller as PR reads. */
export function serveActionRun(github: FakeGitHub, repo: string, extra: Record<string, unknown> = {}, jobs: Record<string, unknown>[] = []): void {
  const base = `https://api.github.com/repos/${repo}`;
  const run = workflowRun(extra);
  github.always(`GET ${base}/actions/runs/${String(run.id)}`, json(run));
  github.always(`GET ${base}/actions/runs`, json({ total_count: 1, workflow_runs: [run] }));
  github.always(`GET ${base}/actions/runs/${String(run.id)}/attempts/${String(run.run_attempt)}/jobs`, json({ total_count: jobs.length, jobs }));
}
export function workflowRun(extra: Record<string, unknown> = {}) {
  return { id: 4812, run_number: 42, run_attempt: 1, name: "CI", path: ".github/workflows/ci.yml", display_title: "Build", event: "push", head_branch: "main", head_sha: "a".repeat(40), actor: { login: "owner" }, html_url: "https://github.com/owner/repo/actions/runs/4812", status: "in_progress", conclusion: null, created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z", pull_requests: [], ...extra };
}
export function actionJob(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 10, name: "tests", status: "completed", conclusion: "failure", html_url: "https://github.com/owner/repo/actions/runs/4812/job/10", started_at: "2026-10-01T12:00:00Z", completed_at: "2026-10-01T12:00:05Z", check_run_url: "https://api.github.com/repos/owner/repo/check-runs/20", ...extra };
}
