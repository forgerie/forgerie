import { Ledge } from "./Ledge";
import { LedgeRow } from "./LedgeRow";

export const name = "Ledge row";
export const note = "One offer at the input as a summary row: kind, title, a gist or a failure's reason, then its actions and More; File moves into More under 30rem";

const noop = () => undefined;
const more = [{ label: "Show in chat", onSelect: noop }, "separator" as const, { label: "Dismiss", onSelect: noop }];
const file = [{ label: "File", wideOnly: true, onPress: noop }, { label: "File and act", tone: "primary" as const, onPress: noop }];
export default function Suggestion() {
  return <Ledge label="Waiting at the input" open><ul>
    <LedgeRow kind="Issue" title="Retry once when the provider stream drops before message.end" onTitle={noop} titleHint="Show the full card in the chat"
      gist="A stream that closes early ends the reply with no error, so you read half an answer." actions={file} menu={more} menuLabel="More" />
  </ul></Ledge>;
}
export function Workflow() {
  return <Ledge label="Waiting at the input" open><ul>
    <LedgeRow kind="Workflow" kindTone="live" title="Split theme.css into one file per surface" onTitle={noop}
      gist="3 stages, 2 workers. Every part renders again at the four Fold postures before it lands."
      actions={[{ label: "Review", tone: "primary", onPress: noop }]} menu={more} menuLabel="More" />
  </ul></Ledge>;
}
export function Failed() {
  return <Ledge label="Waiting at the input" open><ul>
    <LedgeRow kind="Backlog" title="Give the pinned dock a height budget when the Fold is on its side" onTitle={noop}
      problem="Not filed: the backlog folder is read-only." actions={[{ label: "Retry", tone: "primary", onPress: noop }]} menu={more} menuLabel="More" />
  </ul></Ledge>;
}
export function Filing() {
  return <Ledge label="Waiting at the input" open><ul>
    <LedgeRow kind="Issue" title="Retry once when the provider stream drops before message.end" onTitle={noop}
      status={{ text: "Filing and starting…", tone: "live" }} actions={file} menu={more} />
  </ul></Ledge>;
}
/** A title with no break points: it cuts with an ellipsis, and the press shows the rest. */
export function LongWord() {
  return <Ledge label="Waiting at the input" open><ul>
    <LedgeRow kind="Issue" title="Handle ERR_HTTP2_PROTOCOL_ERROR_DURING_STREAM_RESET_AFTER_GOAWAY_FRAME_RECEIVED in streamRelay.ts" onTitle={noop}
      actions={file} menu={more} menuLabel="More" />
  </ul></Ledge>;
}
