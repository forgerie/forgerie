import { LaneGrid, type LaneGroup } from "./LaneGrid";
import { PaceBar } from "./PaceBar";
import { SignalDot } from "./SignalDot";
import { RotateCcwIcon } from "lucide-react";
import { Figure } from "./Figure";

export const name = "Lane grid";
export const note = "Groups of measurement lanes on shared columns, with captions, markers, and spanning trailing cells";

const groups: LaneGroup[] = [
  { key: "a", name: "Northwind", blocks: [{ key: "a1", label: "ops@northwind.example", caption: "ops@northwind.example",
    rows: [
      { key: "short", label: "5h", mark: <PaceBar value={73} pace={76} />, value: <Figure>73</Figure>, words: "Five-hour: 73% left" },
      { key: "week", label: "7d", mark: <PaceBar value={20} pace={50} state="short" />, value: <Figure>20</Figure>, words: "Seven-day: 20% left, behind pace" },
      { key: "side", label: "Side", mark: <PaceBar value={55} pace={50} />, value: <Figure>55</Figure>, words: "Side: 55% left" },
    ],
    spans: [{ start: 0, end: 1, content: <Figure>4h</Figure> }, { start: 1, end: 3, content: <Figure tone="bad">↓4d</Figure> }] }] },
  { key: "b", name: "Contoso", blocks: [
    { key: "b1", label: "first@contoso.example, marked", caption: "first@contoso.example", marked: true,
      rows: [{ key: "w", mark: <PaceBar value={62} pace={50} state="surplus" heat={0.2} />, value: <Figure>62</Figure>, words: "Seven-day: 62% left, ahead of pace" }],
      spans: [{ start: 0, end: 1, content: <Figure tone="warn">↑5d</Figure> }] },
    { key: "b2", label: "second@contoso.example", caption: "second@contoso.example",
      rows: [{ key: "w", mark: <PaceBar value={100} pace={100} />, value: <Figure>100</Figure>, words: "Seven-day: 100% left" }],
      spans: [{ start: 0, end: 1, content: <Figure>7d</Figure> }] },
    { key: "b3", label: "third@contoso.example, out of service", caption: "third@contoso.example", struck: true, note: "No windows reported", rows: [], spans: [] },
  ] },
  { key: "c", name: "Fabrikam", blocks: [{ key: "c1", label: "pool", rows: [
    { key: "p", mark: <SignalDot off />, words: "Pool: refusing work" },
  ], spans: [{ start: 0, end: 1, content: <Figure>19h</Figure> }] }] },
  { key: "d", name: "Tailspin", blocks: [{ key: "d1", label: "key", rows: [
    { key: "c", mark: <Figure tone="plain">$7</Figure>, words: "Credits: $7 left" },
  ], spans: [{ start: 0, end: 1, content: <Figure tone="faint">—</Figure> }] }] },
];

export default function Captioned() {
  return <LaneGrid groups={groups} />;
}
export function Uncaptioned() {
  return <LaneGrid groups={groups} captions={false} />;
}
export function Dense() {
  return <LaneGrid dense captions={false} groups={groups.map((group) => ({ ...group, blocks: group.blocks.slice(0, 1).map((block) =>
    ({ ...block, rows: block.rows.slice(0, 1).map((row) => ({ ...row, label: undefined })), spans: block.spans.slice(0, 1), marked: false })) }))} />;
}
export function Faded() {
  return <LaneGrid faded captions={false} groups={groups} />;
}
export function EmptyGroup() {
  return <LaneGrid groups={[{ key: "x", name: "Northwind", note: "No accounts", blocks: [] }]} />;
}
export function WithActions() {
  const withActions = groups.map((group) => group.key !== "b" ? group : { ...group, blocks: group.blocks.map((block, index) => index === 2 ? block
    : { ...block, action: { label: index === 0 ? "3 credits, the first lapses soon" : "1 credit", icon: <RotateCcwIcon />,
      count: index === 0 ? "3" : "1", tone: index === 0 ? "warn" as const : "live" as const, onPress: () => {} } }) });
  return <LaneGrid groups={withActions} />;
}
