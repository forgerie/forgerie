import type { ReactNode } from "react";
import "./Lede.css";

/** Atom: the one quiet paragraph that opens a page and says what the page is for. */
export function Lede({ children }: { children: ReactNode }) {
  return <p className="lede">{children}</p>;
}
