/** A scripted stand-in for github.com and api.github.com. Each route answers from a queue, then from its default. */
export interface FakeRequest { method: string; url: string; headers: Record<string, string>; form: URLSearchParams }
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
    const request: FakeRequest = { method: init.method ?? "GET", url: input, headers, form: new URLSearchParams(typeof init.body === "string" ? init.body : "") };
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

function routeOf(request: FakeRequest): string { return `${request.method} ${request.url.split("?")[0] ?? request.url}`; }
