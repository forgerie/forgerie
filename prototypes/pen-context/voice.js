/**
 * PROTOTYPE — pen plus voice.
 *
 * The bet: handwriting into a text field is a solved platform feature and not
 * very interesting. The interesting pairing is marking with the pen while
 * speaking the instruction — the hand points, the mouth explains.
 *
 * Web Speech needs a secure context. Over plain http on the tailnet the browser
 * refuses, so `blockedReason()` says what to open instead.
 */

export function speechSupport() {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!window.isSecureContext) return { ok: false, reason: "Voice needs https. Open the https:// address of this prototype." };
  if (Recognition === undefined) return { ok: false, reason: "This browser has no Web Speech API. Try Chrome." };
  return { ok: true, Recognition };
}

export class Dictation {
  /** @param {{ onPartial?: (text: string) => void, onFinal?: (text: string) => void, onState?: (state: "idle" | "listening") => void }} options */
  constructor(options = {}) {
    this.options = options;
    this.recognition = undefined;
    this.wanted = false;
    this.stopTimer = 0;
  }

  /** Called when the pen touches down: speech and ink start together. */
  hold() {
    window.clearTimeout(this.stopTimer);
    if (this.wanted) return;
    const support = speechSupport();
    if (!support.ok) {
      this.options.onState?.("idle");
      return;
    }
    const recognition = new support.Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.addEventListener("result", (event) => this.consume(event));
    recognition.addEventListener("end", () => {
      this.options.onState?.("idle");
      if (this.wanted) recognition.start();
    });
    recognition.addEventListener("error", () => this.options.onState?.("idle"));
    this.recognition = recognition;
    this.wanted = true;
    recognition.start();
    this.options.onState?.("listening");
  }

  /** Called after the pen lifts: keep listening briefly, then stop. */
  release(delay = 2500) {
    window.clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => this.stop(), delay);
  }

  stop() {
    window.clearTimeout(this.stopTimer);
    this.wanted = false;
    this.recognition?.stop();
    this.recognition = undefined;
    this.options.onState?.("idle");
  }

  consume(event) {
    let partial = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result[0].transcript.trim();
      if (text === "") continue;
      if (result.isFinal) this.options.onFinal?.(text);
      else partial += ` ${text}`;
    }
    if (partial !== "") this.options.onPartial?.(partial.trim());
  }
}
