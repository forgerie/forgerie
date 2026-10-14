import assert from "node:assert/strict";
import test from "node:test";
import { fixtureMessages, fixtures } from "./fast-chat-open.mjs";
test("fixtures contain complete turns with stable tool identities and rich content", () => {
  for (const fixture of fixtures) {
    assert.equal(fixture.messages.length, fixture.turns * 9);
    assert.equal(fixture.messages.filter(message => message.role === "user").length, fixture.turns);
    assert.equal(fixture.messages.filter(message => message.role === "toolResult").length, fixture.turns * 6);
    assert.ok(fixture.messages.at(-1).content[0].text.includes(`Readable last turn ${fixture.turns}.`));
    assert.ok(fixture.messages.at(-1).content[0].text.includes("```mermaid"));
  }
  assert.deepEqual(fixtureMessages(20), fixtureMessages(20));
});
