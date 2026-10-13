import { CardDeck, DocumentFirst, RouteSpine } from "./variants";

export const name = "Workflow proposal mockups";
export const note = "Mockup only: three layouts for a proposal whose plan renders with the chat's blocks";

export default function A() { return <DocumentFirst />; }
export function B() { return <RouteSpine />; }
export function C() { return <CardDeck />; }
export function CInputsOpen() { return <CardDeck inputsOpen />; }
