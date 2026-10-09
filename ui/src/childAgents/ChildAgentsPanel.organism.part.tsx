import { useState } from "react";
import { ChildAgentsPanel, type ChildAgentsActions } from "./ChildAgentsPanel";
import { CHILDREN, STREAMING, TRANSCRIPT } from "./fixtures/children";

export const name = "Child agents panel";
export const note = "A session's child agents: the list, then one child's record with steer, stop, and answer";

const noop: ChildAgentsActions = { onOpenChild: () => {}, onBack: () => {}, onClose: () => {}, onSend: () => Promise.resolve(),
  onStop: () => {}, onAnswer: () => Promise.resolve() };

export default function List() {
  const [openId, setOpenId] = useState<number>();
  return <ChildAgentsPanel children={CHILDREN} openId={openId} transcript={openId === undefined ? undefined : TRANSCRIPT}
    actions={{ ...noop, onOpenChild: setOpenId, onBack: () => setOpenId(undefined) }} />;
}
export function ChildAsking() {
  return <ChildAgentsPanel children={CHILDREN} openId={21} transcript={TRANSCRIPT} actions={noop} />;
}
export function ChildStreaming() {
  return <ChildAgentsPanel children={CHILDREN} openId={15} transcript={STREAMING} actions={noop} />;
}
export function ChildIdle() {
  return <ChildAgentsPanel children={CHILDREN} openId={33} transcript={{ ...TRANSCRIPT, busy: false }} actions={noop} />;
}
export function Empty() {
  return <ChildAgentsPanel children={[]} actions={noop} />;
}
export function Failed() {
  return <ChildAgentsPanel children={CHILDREN} error="Question q:40 is not open" actions={noop} />;
}
