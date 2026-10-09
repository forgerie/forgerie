/** What a key does on a tree row, following the ARIA tree pattern. */
export type TreeStep =
  | { type: "focus"; index: number }
  | { type: "fold"; key: string; open: boolean }
  | { type: "open"; key: string };

/** What any tree needs to know about a row to follow the ARIA tree pattern. A failed folder note is `openable`: Enter reads it again. */
export interface StepRow { key: string; parent: string | undefined; folder: boolean; open: boolean; openable: boolean }
export function keyStep(rows: readonly StepRow[], index: number, key: string): TreeStep | undefined {
  const row = rows[index];
  if (!row) return undefined;
  const { folder, open: isOpen } = row;
  switch (key) {
    case "ArrowDown": return index + 1 < rows.length ? { type: "focus", index: index + 1 } : undefined;
    case "ArrowUp": return index > 0 ? { type: "focus", index: index - 1 } : undefined;
    case "Home": return { type: "focus", index: 0 };
    case "End": return { type: "focus", index: rows.length - 1 };
    case "ArrowRight":
      if (!folder) return undefined;
      return isOpen ? (rows[index + 1]?.parent === row.key ? { type: "focus", index: index + 1 } : undefined) : { type: "fold", key: row.key, open: true };
    case "ArrowLeft": {
      if (isOpen) return { type: "fold", key: row.key, open: false };
      const parent = rows.findIndex((item) => item.key === row.parent);
      return parent >= 0 ? { type: "focus", index: parent } : undefined;
    }
    case "Enter":
    case " ":
      if (folder) return { type: "fold", key: row.key, open: !isOpen };
      return row.openable ? { type: "open", key: row.key } : undefined;
    default: return undefined;
  }
}
