import { Ledge } from "./Ledge";
import { LedgeLines } from "./LedgeLines";

export const name = "Ledge";
export const note = "The surface that grows out of the input bar's top edge: the bar's width, surface and edge; its bands split by a faint line; closed, it draws nothing";

const noop = () => undefined;
export default function Open() {
  return <Ledge label="Waiting at the input" open>
    <LedgeLines label="Queued messages" listLabel="Queue, in delivery order" head={null} action={{ label: "Clear", onPress: noop }}
      lines={[{ key: "1", kind: "Follow-up", text: "When that's done, run the Fold postures and send me the light and dark shots." }]} />
  </Ledge>;
}
/** Folded away by the reader, or holding nothing: no box at all. */
export function Closed() {
  return <Ledge label="Waiting at the input" open={false}>
    <LedgeLines label="Queued messages" listLabel="Queue, in delivery order" head={null} action={{ label: "Clear", onPress: noop }}
      lines={[{ key: "1", kind: "Follow-up", text: "When that's done, run the Fold postures and send me the light and dark shots." }]} />
  </Ledge>;
}
