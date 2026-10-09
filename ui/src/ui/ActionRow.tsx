import type { ReactNode } from "react";
import "./ActionRow.css";

/**
 * Molecule: one list item that is not a link. Its name and a short status
 * share the first line; a second line says where it is. Its commands sit at
 * the end and stay there while the words wrap.
 */
export function ActionRow({ name, status, tone, detail, actions }: {
  name: string;
  /** A word or two about its state. */
  status?: string | undefined;
  tone?: "danger" | undefined;
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  return <li className="action-row">
    <span className="action-row-name">{name}</span>
    {status ? <span className="action-row-status" data-tone={tone}>{status}</span> : null}
    {detail ? <span className="action-row-detail">{detail}</span> : null}
    {actions ? <span className="action-row-actions">{actions}</span> : null}
  </li>;
}
