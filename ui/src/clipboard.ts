// Clipboard write that also works on plain HTTP. Forgerie is reached over
// Tailscale at http://<host>:<port>, which is not a secure context, so
// navigator.clipboard is missing there. Ported from the Lit client's
// src/client/src/clipboard.ts.

/** Resolves true when the text reached the clipboard. Must run inside the user's gesture. */
export async function writeClipboardText(text: string): Promise<boolean> {
  if (window.isSecureContext && "clipboard" in navigator) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { /* Fall through to the selection copy. */ }
  }
  return copyWithSelection(text);
}

function copyWithSelection(text: string): boolean {
  const active = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  area.readOnly = true;
  area.setAttribute("aria-hidden", "true");
  Object.assign(area.style, { position: "fixed", top: "0", left: "-9999px", opacity: "0", pointerEvents: "none" });
  document.body.append(area);
  area.select();
  try {
    // Deprecated, but the only clipboard write available outside a secure context.
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    if (active instanceof HTMLElement) active.focus({ preventScroll: true });
  }
}
