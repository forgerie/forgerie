import { z } from "zod";

const instructions = z.string();
const choiceCriteria = z.record(z.string(), z.string()).refine((value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 255);
const requestSchema = z.object({
  model: z.string().trim().min(1),
  state: z.union([z.string(), z.record(z.string(), z.json()), z.array(z.json())]),
  questions: z.record(z.string(), z.discriminatedUnion("type", [
    z.object({ type: z.literal("choice"), instructions, criteria: choiceCriteria }),
    z.object({ type: z.literal("score"), instructions, criteria: z.array(z.string()).min(1).max(10) }),
    z.object({ type: z.literal("noul"), instructions, criteria: z.object({ true: z.string(), false: z.string() }).optional() }),
  ])).refine((value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 128),
});
export type DecisionRequest = z.infer<typeof requestSchema>;
const probability = z.number().min(0).max(1);
const probabilities = z.record(z.string(), probability);
const answersSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), z.discriminatedUnion("type", [
    z.object({ type: z.literal("choice"), choice: z.string(), probabilities, confidence: probability }),
    z.object({ type: z.literal("score"), score: z.number().min(0), probabilities, confidence: probability, legend: z.record(z.string(), z.string()).optional() }),
    z.object({ type: z.literal("noul"), noul: probability }),
  ])),
});
export type DecisionAnswers = z.infer<typeof answersSchema>;

/** No opinion is an ordinary result, including every configuration, transport and schema failure.
 * Callers must launch asks in the background, never in turn completion, admission or execution paths.
 */
export interface DecisionClient {
  ask(request: DecisionRequest): Promise<DecisionAnswers | undefined>;
}
export interface DecisionClientConfig { enabled: boolean; baseUrl?: string }
export const disabledDecisionClient: DecisionClient = { ask: () => Promise.resolve(undefined) };

function sameKeys(actual: object, expected: readonly string[]): boolean {
  const keys = Object.keys(actual);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(actual, key));
}
function matchesQuestions(response: DecisionAnswers, request: DecisionRequest): boolean {
  if (!sameKeys(response.answers, Object.keys(request.questions))) return false;
  return Object.entries(request.questions).every(([name, question]) => {
    const answer = response.answers[name];
    if (answer?.type !== question.type) return false;
    if (question.type === "choice" && answer.type === "choice") {
      return Object.hasOwn(question.criteria, answer.choice) && sameKeys(answer.probabilities, Object.keys(question.criteria));
    }
    if (question.type === "score" && answer.type === "score") {
      const levels = question.criteria.map((_level, index) => String(index));
      return answer.score <= question.criteria.length - 1 && sameKeys(answer.probabilities, levels)
        && (answer.legend === undefined || sameKeys(answer.legend, levels));
    }
    return true;
  });
}

/** Reads configuration for every ask so a live master-switch change takes effect without restart.
 * Redirects are refused: the configured gateway alone may receive session text and credentials.
 */
export function createDecisionClient(options: {
  readConfig: () => DecisionClientConfig;
  readApiKey?: () => Promise<string | undefined>;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): DecisionClient {
  return { async ask(request) {
    try {
      // Detach even configuration/credential callbacks from the caller's turn or tool stack.
      await Promise.resolve();
      const config = options.readConfig();
      if (!config.enabled || config.baseUrl === undefined || config.baseUrl.trim() === "") return undefined;
      const url = new URL(config.baseUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return undefined;
      url.pathname = `${url.pathname.replace(/\/+$/u, "")}/v1/systemone`;
      const parsedRequest = requestSchema.safeParse(request);
      if (!parsedRequest.success) return undefined;
      const apiKey = await options.readApiKey?.();
      const response = await (options.fetch ?? fetch)(url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(options.timeoutMs ?? 2000),
        headers: { "content-type": "application/json", ...(apiKey === undefined || apiKey.trim() === "" ? {} : { authorization: `Bearer ${apiKey}` }) },
        body: JSON.stringify(parsedRequest.data),
      });
      if (!response.ok) { await response.body?.cancel(); return undefined; }
      const body: unknown = await response.json();
      const parsed = answersSchema.safeParse(body);
      return parsed.success && matchesQuestions(parsed.data, parsedRequest.data) ? parsed.data : undefined;
    } catch {
      // Optional information must fail open to today's behavior, never to approval or suppression.
      return undefined;
    }
  } };
}
