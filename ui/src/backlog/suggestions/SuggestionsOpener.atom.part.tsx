import { useState } from "react";
import { SuggestionsOpener } from "./SuggestionsOpener";

export const name = "Backlog suggestions opener";
export const note = "The header's count of open suggestions; live when a background session needs you, a dot while one works";

function Opener(view: { label: string; count: number; quiet: boolean; active: boolean }) {
  const [opened, setOpened] = useState(0);
  return <><SuggestionsOpener {...view} onOpen={() => setOpened(opened + 1)} />{opened ? <p>Opened {opened} times</p> : null}</>;
}
export default function Open() { return <Opener label="Backlog suggestions, 2 open" count={2} quiet active={false} />; }
export function OpenAndWorking() { return <Opener label="Backlog suggestions, 2 open, 1 in background working" count={2} quiet active />; }
export function Working() { return <Opener label="Backlog suggestions, 0 open, 1 in background working" count={0} quiet active />; }
export function NeedsYou() { return <Opener label="Backlog suggestions, 1 open, 1 in background needs you" count={1} quiet={false} active={false} />; }
export function Nothing() { return <Opener label="Backlog suggestions, 0 open" count={0} quiet active={false} />; }
