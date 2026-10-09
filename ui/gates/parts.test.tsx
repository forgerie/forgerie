// @vitest-environment happy-dom
/**
 * Every state of every part renders content (caliper-parts, "verify by content").
 *
 * A part is found by its file name, so a broken one is not a compile error. A
 * part whose data cannot arrive still mounts and looks blank. This renders each
 * state the way Caliper finds it and asserts that it drew text.
 */
import { act, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { expectOnlyPending, partFiles, rel } from "./source";

/**
 * States whose whole content is a shape, with the reason. These are checked by
 * eye in Caliper. Listing them keeps that a decision, not a weaker assertion for all.
 */
const TEXTLESS: Record<string, string> = {};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => document.body.replaceChildren());

test("the app publishes parts", () => {
  // Guards the walk: an empty list makes the content check vacuous.
  expect(partFiles.length).toBeGreaterThan(0);
});

test("every part state renders content", async () => {
  const offenders: string[] = [];
  for (const file of partFiles) {
    let module: Record<string, unknown>;
    try { module = await import(file) as Record<string, unknown>; } catch (error) {
      offenders.push(`${rel(file)}: fails to load: ${String(error).split("\n")[0]}`);
      continue;
    }
    const states = Object.entries(module).filter(([key, value]) => (key === "default" || /^[A-Z]/.test(key)) && typeof value === "function");
    for (const [key, State] of states) {
      const label = `${rel(file)}#${key}`;
      const host = document.body.appendChild(document.createElement("div"));
      const root = createRoot(host);
      try {
        const Component = State as ComponentType;
        await act(async () => { root.render(<Component />); });
        // Content is what a person can read or hear: text, or the accessible name of an icon control.
        const names = [...document.body.querySelectorAll("[aria-label], [alt], [title]")]
          .map((element) => element.getAttribute("aria-label") ?? element.getAttribute("alt") ?? element.getAttribute("title") ?? "");
        const text = [document.body.textContent ?? "", ...names].join(" ").trim();
        if (!text && !(label in TEXTLESS)) offenders.push(`${label}: renders no text`);
      } catch (error) {
        offenders.push(`${label}: throws: ${String(error).split("\n")[0]}`);
      } finally {
        await act(async () => { root.unmount(); });
        document.body.replaceChildren();
      }
    }
  }
  expectOnlyPending("part state without content", offenders);
}, 120_000);
