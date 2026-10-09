import { Toast } from "./Toast";
import { ToastRegion } from "./ToastRegion";

export const name = "Toast region";
export const note = "The one corner where every toast shows: the window's top end, under the header";

export default function Stacked() {
  return <>
    <ToastRegion />
    <Toast message="A new version is ready." action={{ label: "Refresh", onPress: () => {} }} onDismiss={() => {}} dismissLabel="Not now" />
    <Toast message={<>Archived <strong>Account meters plugin backport</strong>. Worktree kept.</>} action={{ label: "Undo", onPress: () => {} }} onDismiss={() => {}}
      detail="Its folder or branch changed outside Forgerie. Remove account-meters-plugin-backport yourself if you no longer need it." />
  </>;
}
/** Toasts float over the thread, so this state draws text behind them to show how they stand off it. */
export function OverThread() {
  return <>
    <main>
      {["The parser reads each block into a node, then the printer walks the nodes in order.",
        "A list item that holds a quote keeps its marker, so the printer must not join the two lines.",
        "I changed the printer to keep the marker, and added a test for a quote inside a list.",
        "All 214 tests pass. The build is clean, and the bundle grew by 0.4 kB.",
        "Next, the same rule applies to a code block inside a list, which the printer still joins."]
        .map((text) => <p key={text}>{text}</p>)}
    </main>
    <ToastRegion />
    <Toast message={<>Archived <strong>Account meters plugin backport</strong>. Worktree kept.</>} action={{ label: "Undo", onPress: () => {} }} onDismiss={() => {}}
      detail="Its folder or branch changed outside Forgerie. Remove account-meters-plugin-backport yourself if you no longer need it." />
    <Toast tone="alert" message="“Fix the parser” did not start." action={{ label: "Review", onPress: () => {} }} onDismiss={() => {}} />
  </>;
}
/** The failures the app shows: a start that failed (with Review), and refusals from the session list (no action), short and long. */
export function Failures() {
  return <>
    <main>
      {["The parser reads each block into a node, then the printer walks the nodes in order.",
        "A list item that holds a quote keeps its marker, so the printer must not join the two lines.",
        "I changed the printer to keep the marker, and added a test for a quote inside a list."]
        .map((text) => <p key={text}>{text}</p>)}
    </main>
    <ToastRegion />
    <Toast tone="alert" message="“Fix the parser” did not start." action={{ label: "Review", onPress: () => {} }} onDismiss={() => {}} />
    <Toast tone="alert" message="Stop current session activity before archiving" onDismiss={() => {}} />
    <Toast tone="alert" message="“Move the account meters into the plugin shelf” started, but its first message may not have reached Pi."
      action={{ label: "Review", onPress: () => {} }} onDismiss={() => {}} />
  </>;
}
export function One() {
  return <>
    <ToastRegion />
    <Toast tone="alert" message="Unpin the session before you archive it." onDismiss={() => {}} />
  </>;
}
