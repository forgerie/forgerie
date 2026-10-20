import { test } from "vitest";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { destinationReady, matchTokenPaints, routeLabel, summarize } from "./stack-latency-contract.mjs";

test("small samples do not claim tail percentiles", () => {
  assert.deepEqual(summarize([3, 1, 2]), { n: 3, min: 1, median: 2, max: 3, p95: null, p99: null });
  assert.equal(summarize(Array.from({ length: 100 }, (_, i) => i)).p95, 94);
  assert.equal(summarize(Array.from({ length: 100 }, (_, i) => i)).p99, null);
  assert.equal(summarize(Array.from({ length: 1000 }, (_, i) => i)).p99, 989);
  assert.throws(() => summarize([]));
  assert.throws(() => summarize([NaN]));
});
test("stream tokens can share a render while preserving event identity", () => {
  assert.deepEqual(matchTokenPaints([{ seq: 5, at: 10 }, { seq: 8, at: 11 }], [{ length: 4, observed: 12, paintOpportunity: 20 }], 2),
    [{ seq: 8, batchedTokens: 2, receiveToDomMs: 1, receiveToPaintOpportunityMs: 9 }]);
});
test("streaming rejects missing events, duplicate identities and unrelated DOM changes", () => {
  assert.throws(() => matchTokenPaints([], [{ length: 1, observed: 12, paintOpportunity: 20 }], 0));
  assert.throws(() => matchTokenPaints([{ seq: 5, at: 10 }, { seq: 5, at: 11 }], [], 0));
  assert.throws(() => matchTokenPaints([{ seq: 5, at: 10 }], [{ length: 5000, observed: 12, paintOpportunity: 20 }], 0));
  assert.throws(() => matchTokenPaints([{ seq: 5, at: 10 }], [{ length: 1, observed: 9, paintOpportunity: 20 }], 0));
});
test("route labels discard query values and session/process identities", () => {
  assert.equal(routeLabel("http://localhost/api/sessions/private/processes/secret/output?cwd=/private&token=secret"), "/api/sessions/:id/processes/:id/output");
});
for (const [name, title, text, selected, visible, expected] of [
  ["destination transcript", "Destination", "A unique destination reply", "true", true, true],
  ["generic marker", "Destination", "start of chat", "true", true, false],
  ["old transcript under selected shell", "Destination", "Old reply", "true", true, false],
  ["generic native heading with exact destination reply", "Session", "A unique destination reply", "true", true, true],
  ["hidden retained screen", "Destination", "A unique destination reply", "true", false, false],
  ["unselected row", "Destination", "A unique destination reply", "false", true, false],
]) test(name, async () => {
  const window = new Window({ url: "http://localhost/?session=destination" });
  try {
    const document = window.document;
    document.body.innerHTML = `<div id="picker-row-destination" aria-selected="${selected}"></div><section class="session-shell"><h1 class="session-title">${title}</h1><div class="transcript"><div class="message-text">${text}</div></div><textarea data-composer-input></textarea></section>`;
    // happy-dom has no layout; geometry is a controlled input to this predicate.
    for (const node of document.querySelectorAll("*")) node.getBoundingClientRect = () => ({ width: visible ? 100 : 0, height: 100, top: 0, bottom: 100 });
    assert.equal(destinationReady(document, { id: "destination", title: "Destination", marker: "auniquedestinationreply" }), expected);
  } finally { await window.happyDOM.close(); }
});
