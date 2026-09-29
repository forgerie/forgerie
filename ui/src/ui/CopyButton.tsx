import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// System molecule: both copy actions report denial, including insecure HTTP contexts.
export function CopyButton({ getText, label }: { getText: () => string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);
  async function copy() {
    clearTimeout(timeout.current);
    try {
      await navigator.clipboard.writeText(getText());
      setState("copied");
      timeout.current = setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  }
  return <span className="copy-action">
    <span className="copy-status" role="status">{state === "failed" ? "Copy failed. Select the text to copy it." : state === "copied" ? "Copied" : ""}</span>
    <button type="button" aria-label={label} title={label} className="icon-button quiet-button" onClick={() => void copy()}>
      {state === "copied" ? <CheckIcon aria-hidden size={16} /> : <CopyIcon aria-hidden size={16} />}
    </button>
  </span>;
}
