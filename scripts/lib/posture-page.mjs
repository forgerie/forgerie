/**
 * Opens a page at one Fold 8 posture and drives it to the state under test.
 *
 * Capture and audit both need the same thing: a real viewport, a real colour
 * scheme, and a short path of real input to reach a surface that a cold load
 * does not show. Stating that once means an audit can reach every screen the
 * capture tool can reach, instead of only the one a cold URL lands on.
 *
 * Emulation goes through CDP rather than window sizing. A Chromium window is
 * not a viewport: it clamps small widths and budgets height differently, which
 * previously produced clipped-control reports that the device did not have.
 */
import { evaluate, openPage, sleep } from "./cdp.mjs";
import { FOLD8_DPR } from "./fold8-postures.mjs";

const DEEP_QUERY = `
  (() => {
    const walk = (root, test) => {
      for (const element of root.querySelectorAll("*")) {
        if (test(element)) return element;
        if (element.shadowRoot) {
          const found = walk(element.shadowRoot, test);
          if (found) return found;
        }
      }
      return undefined;
    };
    window.__forgerieDeepFind = (test) => walk(document, test);
  })()
`;

const CDP_MODIFIERS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, shift: 8 };

/** Opens a page already emulating the posture and colour scheme. */
export async function openPosturePage({ debugPort, posture, colorScheme }) {
  const cdp = await openPage(debugPort);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: posture.width,
    height: posture.height,
    deviceScaleFactor: FOLD8_DPR,
    mobile: true,
  });
  // Emulate the OS preference rather than force-darkening rendered pixels:
  // the app's auto theme pair resolves from prefers-color-scheme, so this
  // exercises the real resolution path.
  if (colorScheme !== undefined) {
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: colorScheme }],
    });
  }
  return cdp;
}

/** Navigates, then walks the requested input path, settling between steps. */
export async function drivePage(cdp, options) {
  const { url, settle = 4000, timeout = 20000, inputMode, presses = [], clickTitles = [], label = "page" } = options;

  const loaded = cdp.waitForEvent("Page.loadEventFired", timeout).catch(() => undefined);
  await cdp.send("Page.navigate", { url });
  await loaded;
  await sleep(settle);

  // Headless Chromium sends a mouse pointer, so a run cannot reach the touch
  // affordances on its own. Dispatching a real pointerdown with a pointerType
  // drives the app's own observer, rather than writing the result the observer
  // is supposed to produce.
  if (inputMode !== undefined) {
    await evaluate(cdp, `
      (() => {
        document.dispatchEvent(new PointerEvent("pointerdown", {
          pointerType: ${JSON.stringify(inputMode)},
          bubbles: true,
        }));
      })()
    `);
    await sleep(300);
  }

  // Real key input through CDP, not a synthetic DOM event: surfaces opened by
  // a keyboard shortcut are reached the way the user reaches them.
  for (const combo of presses) {
    await pressCombo(cdp, combo);
    await sleep(settle);
  }

  // Repeated click titles run in order, so a run can walk a short path (open
  // the workspace sheet, then pick a tool tab).
  for (const clickTitle of clickTitles) {
    await evaluate(cdp, DEEP_QUERY);
    const clicked = await evaluate(cdp, `
      (() => {
        const target = window.__forgerieDeepFind((element) =>
          element.tagName === "BUTTON" && element.getAttribute("title") === ${JSON.stringify(clickTitle)});
        if (!target) return false;
        target.click();
        return true;
      })()
    `);
    if (clicked !== true) throw new Error(`No button titled ${JSON.stringify(clickTitle)} in ${label}`);
    await sleep(settle);
  }
}

/**
 * Named keys, which do not follow the `KeyA` / charCode pattern letters do.
 *
 * A shortcut bound to Enter is dispatched as `KeyENTER` with the virtual key
 * code of "E" without this table, so the page receives an entirely different
 * key and the surface under test never opens.
 */
const CDP_NAMED_KEYS = {
  enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
  backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
};

/** Dispatches a combo such as "ctrl+k", "shift+meta+p", or "ctrl+alt+enter". */
export async function pressCombo(cdp, combo) {
  const parts = combo.split("+").map((part) => part.trim().toLowerCase()).filter((part) => part !== "");
  const key = parts.pop();
  if (key === undefined) throw new Error(`--press needs a key, got ${JSON.stringify(combo)}`);
  let modifiers = 0;
  for (const part of parts) {
    const bit = CDP_MODIFIERS[part];
    if (bit === undefined) throw new Error(`Unknown modifier ${JSON.stringify(part)} in ${JSON.stringify(combo)}`);
    modifiers |= bit;
  }
  const named = CDP_NAMED_KEYS[key];
  const base = named === undefined
    ? { modifiers, key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }
    : { modifiers, ...named };
  await cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyDown" });
  await cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}

export function requireColorScheme(value) {
  if (value === "dark" || value === "light") return value;
  throw new Error(`--color-scheme must be dark or light, got ${JSON.stringify(value)}`);
}
