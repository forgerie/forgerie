import { OverturnFooter } from "./OverturnFooter";
import { GUESS } from "./fixtures/decisions";

export const name = "Overturn footer";
export const note = "A sheet's footer while the reader overturns a decision";

export default function Writing() {
  return <OverturnFooter target={GUESS} pending={false} onSend={() => Promise.resolve(true)} onCancel={() => {}} onDismissError={() => {}} />;
}
export function Sending() {
  return <OverturnFooter target={GUESS} pending onSend={() => Promise.resolve(true)} onCancel={() => {}} onDismissError={() => {}} />;
}
export function Failed() {
  return <OverturnFooter target={GUESS} pending={false} error="Durable storage is unavailable. Try again in a moment."
    onSend={() => Promise.resolve(false)} onCancel={() => {}} onDismissError={() => {}} />;
}
/** Another tab overturned it first: the field is gone, and the reason can be dismissed. */
export function AlreadyOverturned() {
  return <OverturnFooter pending={false} error="This decision is already overturned." onSend={() => Promise.resolve(false)} onCancel={() => {}} onDismissError={() => {}} />;
}
