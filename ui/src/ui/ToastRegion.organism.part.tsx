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
export function One() {
  return <>
    <ToastRegion />
    <Toast tone="alert" message="Unpin the session before you archive it." onDismiss={() => {}} />
  </>;
}
