// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChainWaitStatus } from "./ChainWaitStatus";
import { MODELS } from "./fixtures/chains";

let root: Root;
const NOW = Date.UTC(2026, 9, 28, 14, 0, 0);
const wait = { from: "anthropic/claude-opus-5-5:high", error: "429 Too Many Requests", until: NOW + 42_000, to: "openai/gpt-5" };
const line = () => document.querySelector(".readout-line")!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ now: NOW });
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("counts down each second to the model the server names, then says it moves on", async () => {
  await act(async () => root.render(<ChainWaitStatus wait={wait} models={MODELS} />));
  expect(line().textContent).toBe("Waiting 0:42 for Claude Opus 5.5 (High), then GPT-5");
  expect(line().querySelector("[aria-label]")?.getAttribute("aria-label")).toBe("42 seconds left");
  await act(async () => { vi.advanceTimersByTime(1_000); });
  expect(line().textContent).toBe("Waiting 0:41 for Claude Opus 5.5 (High), then GPT-5");
  await act(async () => { vi.advanceTimersByTime(41_000); });
  expect(line().textContent).toBe("Moving on from Claude Opus 5.5 (High) to GPT-5…");
});

it("names no other model for a same-model retry", async () => {
  await act(async () => root.render(<ChainWaitStatus wait={{ from: wait.from, error: wait.error, until: wait.until }} models={MODELS} now={NOW} />));
  expect(line().textContent).toBe("Waiting 0:42 for Claude Opus 5.5 (High)");
  await act(async () => root.render(<ChainWaitStatus wait={{ from: wait.from, error: wait.error, until: NOW - 1 }} models={MODELS} now={NOW} />));
  expect(line().textContent).toBe("Moving on from Claude Opus 5.5 (High)…");
});

it("offers Stop only when given one", async () => {
  const onStop = vi.fn();
  await act(async () => root.render(<ChainWaitStatus wait={{ from: wait.from, error: wait.error, until: wait.until }} models={MODELS} now={NOW} onStop={onStop} />));
  expect(line().textContent).toBe("Waiting 0:42 for Claude Opus 5.5 (High)Stop");
  await act(async () => line().querySelector("button")!.click());
  expect(onStop).toHaveBeenCalledOnce();
  await act(async () => root.render(<ChainWaitStatus wait={wait} models={MODELS} now={NOW} />));
  expect(line().textContent).toBe("Waiting 0:42 for Claude Opus 5.5 (High), then GPT-5");
  expect(line().querySelector("button")).toBeNull();
});
