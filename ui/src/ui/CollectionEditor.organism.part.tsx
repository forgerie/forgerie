import { useState } from "react";
import { CollectionEditor, type EditableCollection } from "./CollectionEditor";
export const name = "Collection editor";
const choices = [{ id: "a", label: "Core", detail: "/code/core" }, { id: "b", label: "Plugins", detail: "/code/plugins" }];
export default function Ready() {
  const [items, setItems] = useState<EditableCollection[]>([{ id: "one", label: "KORI", choiceIds: ["a", "b"] }]);
  return <CollectionEditor emptyText="No collections yet." collections={items} choices={choices} pending={false}
    onSave={async (id, label, choiceIds) => setItems((current) => [...current.filter((item) => item.id !== id), { id: id ?? `item-${current.length}`, label, choiceIds }])}
    onRemove={async (id) => setItems((current) => current.filter((item) => item.id !== id))} />;
}
export function Empty() { return <CollectionEditor emptyText="No collections yet." collections={[]} choices={choices} pending={false} onSave={async () => undefined} onRemove={async () => undefined} />; }
export function Conflict() { return <CollectionEditor emptyText="No collections yet." collections={[{ id: "one", label: "A long collection label that wraps without hiding controls", choiceIds: ["a", "missing"] }]} choices={choices} pending={false} error="The group changed. Reload before saving." onSave={async () => { throw new Error("Conflict"); }} onRemove={async () => { throw new Error("Conflict"); }} />; }
