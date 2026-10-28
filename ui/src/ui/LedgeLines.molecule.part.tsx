import { Ledge } from "./Ledge";
import { LedgeLines, type LedgeLine } from "./LedgeLines";

export const name = "Ledge lines";
export const note = "Lines that wait in order, nearest the input: one line beside its action, or a counted head and lines cut to one line that a press opens";

const clear = { label: "Clear all", title: "Removes every queued message. The current run continues.", onPress: () => undefined };
const lines: LedgeLine[] = [
  { key: "1", kind: "Steer", kindTone: "strong", text: "Also check the session store, it might clear the rows the same way." },
  { key: "2", kind: "Follow-up", text: "When that's done, run the Fold postures and send me the light and dark shots." },
  { key: "3", kind: "Follow-up", text: "Then write the test for the resume path. It should cover a read that returns after the app comes back, a read that fails, and a read that is still running when the app goes to the background again, because that third case is the one that flashed on the Fold this morning and I want to be sure it stays fixed." },
];
export default function Three() {
  return <Ledge label="Waiting at the input" open>
    <LedgeLines label="Queued messages" listLabel="Queue, in delivery order" head={<><strong>3</strong> queued, sent in this order</>} action={clear} lines={lines} />
  </Ledge>;
}
export function One() {
  return <Ledge label="Waiting at the input" open>
    <LedgeLines label="Queued messages" listLabel="Queue, in delivery order" head={null} action={{ ...clear, label: "Clear" }} lines={[lines[1]!]} />
  </Ledge>;
}
/** A compaction waits as a command, in the code face. */
export function Command() {
  return <Ledge label="Waiting at the input" open>
    <LedgeLines label="Queued messages" listLabel="Queue, in delivery order" head={<><strong>2</strong> queued, sent in this order</>} action={clear}
      lines={[lines[1]!, { key: "c", kind: "Compaction", face: "code", text: "/compact keep the release plan and the open questions" }]} />
  </Ledge>;
}
