import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ComposerDictationCapability } from "../composerCapabilities";
import { PromptDictationController } from "../controllers/promptDictationController";
import {
  VOICE_COMPOSER_LISTENING,
  VOICE_SEND_COUNTDOWN_MS,
  voiceComposerBusy,
  voiceComposerDue,
  voiceComposerEdited,
  voiceComposerFromDictation,
  voiceComposerHeard,
  voiceComposerHold,
  voiceComposerRemainingMs,
  voiceComposerTranscript,
  type VoiceComposerState,
} from "../appShell/voiceComposerState";
import "./ModalSurface";

/** How often the ring redraws. Fine enough to look continuous, coarse enough to be cheap. */
const TICK_MS = 80;

/**
 * Speak a message without a keyboard.
 *
 * Three rules hold this dialog together, and each one is a decision that cost
 * something:
 *
 * - **It opens already listening.** The wheel's release is the start of
 *   recording, not a request to record, so `connectedCallback` starts capture
 *   rather than waiting for a control. The cost is that a mis-hold opens a live
 *   microphone; the wheel's dead zone is what makes that unlikely, and Discard
 *   is what makes it recoverable.
 * - **Nothing is focused on open.** `modal-surface` focuses its `initialFocus`
 *   target when it has one, so this dialog deliberately passes none and lets
 *   focus land on the dialog section. Focusing the text would raise the Android
 *   keyboard, which is the one thing this dialog exists to avoid.
 * - **A finished transcript sends itself.** Not at once: it counts down for
 *   {@link VOICE_SEND_COUNTDOWN_MS} in plain sight, and any touch on the text
 *   stops it. Whisper mishears, and a wrong sentence must be catchable without
 *   being fast.
 *
 * Finish and the countdown are two different gates and both are needed.
 * `liveSpeechService.ts` disables automatic turn detection on purpose --
 * "explicit completion is the product policy" -- so nothing will ever decide
 * a turn is over. Finish ends the recording. The countdown then gates sending
 * text that Whisper may have got wrong.
 *
 * The countdown lives here and not in `PromptDictationController` because the
 * controller's job ends when it hands over a transcript. Putting the timer
 * there would hand the same countdown to the inline composer microphone, which
 * does not want one.
 */
@customElement("voice-composer-dialog")
export class VoiceComposerDialog extends LitElement {
  @property({ attribute: false }) capability?: ComposerDictationCapability;
  /** Identifies the destination, so a session change abandons the capture. */
  @property() ownerKey = "";
  @property({ attribute: false }) onSendText?: (text: string) => void;
  @property({ attribute: false }) onDismiss?: () => void;

  @state() private composerState: VoiceComposerState = VOICE_COMPOSER_LISTENING;
  @state() private tick = 0;

  private controller: PromptDictationController | undefined;
  private ticker: number | undefined;
  private transcriptBuffer = "";

  override connectedCallback(): void {
    super.connectedCallback();
    this.startListening();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopTicking();
    this.controller?.dispose();
    this.controller = undefined;
  }

  override render() {
    const state = this.composerState;
    const transcript = voiceComposerTranscript(state);
    return html`
      <modal-surface
        label="Speak to this session"
        .busy=${voiceComposerBusy(state)}
        .onClose=${() => { this.dismiss(); }}
        .onBusyEscape=${() => { this.dismiss(); }}
      >
        <div class="head">
          <h2>Speak</h2>
          <button type="button" class="close" aria-label="Close" @click=${() => { this.dismiss(); }}>&times;</button>
        </div>

        <div class="status">${this.renderIndicator()}<span class="status-text">${this.statusLine()}</span></div>

        <div class="transcript" @pointerdown=${() => { this.hold(); }}>
          ${transcript === undefined
            ? html`<p class="waiting">${state.kind === "failed" ? state.message : "Speech appears here as it is transcribed."}</p>`
            : html`<textarea
                .value=${transcript}
                aria-label="Message to send"
                rows="4"
                @input=${(event: Event) => { this.edit(event); }}
              ></textarea>`}
        </div>

        <div class="actions">
          <button type="button" class="discard" @click=${() => { this.dismiss(); }}>Discard</button>
          ${this.renderPrimaryAction(transcript)}
        </div>
      </modal-surface>
    `;
  }

  /**
   * Finish, or Send, depending on whether there is anything to send yet.
   *
   * Finish is not a fallback. Turn detection can be unavailable on the server,
   * over budget for the turn, or simply slower than a reader who has already
   * stopped talking, and in every one of those cases the promise that a pause
   * ends the turn is not kept. Without this control the dialog would listen
   * until the 60 s cap with no way out but Discard.
   */
  private renderPrimaryAction(transcript: string | undefined) {
    if (transcript !== undefined) {
      return html`<button type="button" class="send" @click=${() => { this.send(); }}>Send &uarr;</button>`;
    }
    if (this.composerState.kind === "failed") {
      return html`<button type="button" class="cancel" @click=${() => { this.dismiss(); }}>Close</button>`;
    }
    return html`<button type="button" class="finish" @click=${() => { this.finishTurn(); }}>Finish &uarr;</button>`;
  }

  /**
   * The ring, or the reason there is no ring.
   *
   * `tick` is read here rather than the remaining time being stored, so the
   * deadline stays the single fact and a slow or throttled tick can only draw
   * late, never send early.
   */
  private renderIndicator() {
    const state = this.composerState;
    if (state.kind !== "counting") return html`<span class="dot ${state.kind}" aria-hidden="true"></span>`;
    const remaining = voiceComposerRemainingMs(state, Date.now());
    const left = Math.max(0, Math.min(1, remaining / VOICE_SEND_COUNTDOWN_MS));
    const circumference = 2 * Math.PI * 20;
    return html`
      <span class="ring-wrap">
        <svg class="ring" viewBox="0 0 46 46" aria-hidden="true" data-tick=${this.tick}>
          <circle cx="23" cy="23" r="20" class="ring-track"></circle>
          <circle
            cx="23" cy="23" r="20" class="ring-value"
            stroke-dasharray=${`${String(circumference * left)} ${String(circumference)}`}
          ></circle>
        </svg>
        <span class="ring-number">${(remaining / 1000).toFixed(1)}</span>
      </span>
    `;
  }

  private statusLine(): string {
    const state = this.composerState;
    switch (state.kind) {
      case "listening":
        return state.endsItself
          ? "Listening. Stop talking and it sends itself."
          : "Listening. Nothing will end this turn but you.";
      case "working":
        return "Working out what you said.";
      case "counting":
        return "Sending. Touch the text to stop it.";
      case "held":
        return "Held. Send when you are ready.";
      case "failed":
        return state.retryable ? "That did not work. Try again." : "Speech is unavailable.";
    }
  }

  /**
   * Open the microphone.
   *
   * `press` then `release` is the tap gesture the controller already models,
   * and it lands in `auto` — open, with the end of the turn judged for you.
   * That is exactly what releasing the wheel asked for.
   */
  private startListening(): void {
    const capability = this.capability;
    if (capability === undefined) return;
    const ownerKey = () => this.ownerKey;
    const controller = new PromptDictationController({
      scheduler: {
        now: () => Date.now(),
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (handle) => { if (typeof handle === "number") window.clearTimeout(handle); },
      },
      draft: {
        get ownerKey() { return ownerKey(); },
        beginDictation: () => { this.transcriptBuffer = ""; return true; },
        commitTranscript: (transcript) => { this.transcriptBuffer = transcript; return true; },
        finishDictation: () => { this.heard(this.transcriptBuffer); },
        abortDictation: () => { this.transcriptBuffer = ""; },
      },
      speechApi: capability.speechApi,
      createCaptureSession: capability.createCaptureSession,
      onStateChange: (dictation) => {
        this.composerState = voiceComposerFromDictation(dictation, this.composerState);
      },
    });
    this.controller = controller;
    controller.press();
    controller.release();
    this.readCapability(capability, controller);
  }

  /**
   * Ask the service what it can do, before claiming anything to the reader.
   *
   * The controller assumes `ready` until told otherwise, which would make the
   * dialog promise that a pause ends the turn and then take it back a second
   * later. Automatic turn detection is disabled by product policy, so that
   * promise is one this dialog can never keep and must never make.
   */
  private readCapability(capability: ComposerDictationCapability, controller: PromptDictationController): void {
    void capability.getStatus()
      .then((status) => {
        if (this.controller !== controller) return;
        controller.setCapability(status.capability, "Speech dictation is unavailable.");
      })
      .catch(() => {
        // A status that cannot be read is not itself a failure: capture may
        // still work, and a real attempt reports a truer reason than this one.
      });
  }

  /**
   * End the turn now and transcribe what was said.
   *
   * The controller already models this: a press while the microphone is open
   * completes from the current capture. It is the same action as tapping the
   * composer microphone a second time.
   */
  private finishTurn(): void {
    this.controller?.press();
  }

  private heard(transcript: string): void {
    const next = voiceComposerHeard(transcript, Date.now());
    this.composerState = next;
    if (next.kind === "counting") this.startTicking();
  }

  private startTicking(): void {
    this.stopTicking();
    this.ticker = window.setInterval(() => {
      const now = Date.now();
      if (voiceComposerDue(this.composerState, now)) {
        this.send();
        return;
      }
      if (this.composerState.kind !== "counting") {
        this.stopTicking();
        return;
      }
      this.tick += 1;
    }, TICK_MS);
  }

  private stopTicking(): void {
    if (this.ticker === undefined) return;
    window.clearInterval(this.ticker);
    this.ticker = undefined;
  }

  /** A touch on the text stops the send and keeps every word of it. */
  private hold(): void {
    const next = voiceComposerHold(this.composerState);
    if (next === this.composerState) return;
    this.composerState = next;
    this.stopTicking();
  }

  private edit(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) return;
    this.stopTicking();
    this.composerState = voiceComposerEdited(this.composerState, target.value);
  }

  private send(): void {
    const text = voiceComposerTranscript(this.composerState)?.trim();
    this.stopTicking();
    if (text === undefined || text === "") return;
    this.onSendText?.(text);
    this.dismiss();
  }

  private dismiss(): void {
    this.stopTicking();
    this.controller?.cancel();
    this.onDismiss?.();
  }

  static override styles = css`
    /* Above the wheel (40), which is what opened this and must not draw over it. */
    :host { position: fixed; inset: 0; z-index: 50; color: var(--pi-text); font: var(--pi-text-md) system-ui, sans-serif; }
    modal-surface {
      --modal-surface-width: min(560px, calc(100vw - 24px));
      --modal-surface-max-height: min(720px, calc(100dvh - 24px));
    }
    .head { display: flex; align-items: center; gap: 8px; padding: 14px 16px 6px; }
    h2 { flex: 1 1 auto; margin: 0; font-size: var(--pi-text-md); color: var(--pi-text); }
    .close { background: none; border: none; color: var(--pi-dim); font-size: 22px; line-height: 1; padding: 6px 10px; cursor: pointer; }

    .status { display: flex; align-items: center; gap: 10px; padding: 4px 16px 10px; min-height: 52px; }
    .status-text { color: var(--pi-dim); font-size: var(--pi-text-sm); }
    .dot { width: 14px; height: 14px; border-radius: 50%; background: var(--pi-accent); }
    .dot.working { background: var(--pi-dim); }
    .dot.held, .dot.failed { background: none; border: 2px solid var(--pi-border); }

    /* The number sits inside the ring, so the ring needs to be its containing
       block. Without the wrapper it would position against :host and land in
       the corner of the viewport. */
    .ring-wrap { position: relative; display: inline-flex; width: 40px; height: 40px; align-items: center; justify-content: center; flex: 0 0 auto; }
    .ring { position: absolute; inset: 0; width: 40px; height: 40px; transform: rotate(-90deg); }
    .ring-track { fill: none; stroke: var(--pi-border-muted); stroke-width: 3; }
    .ring-value { fill: none; stroke: var(--pi-accent); stroke-width: 3; stroke-linecap: round; }
    .ring-number { position: relative; font-size: var(--pi-text-sm); color: var(--pi-dim); font-variant-numeric: tabular-nums; }

    /* One target. A touch anywhere on it stops the send; a touch on the text
       also focuses it, which is the only way the keyboard ever appears here. */
    .transcript { padding: 0 16px; }
    .waiting { margin: 0; padding: 14px 12px; min-height: 96px; color: var(--pi-dim); border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-control); }
    textarea {
      width: 100%; box-sizing: border-box; resize: none; padding: 12px;
      font: inherit; font-size: var(--pi-text-md); color: var(--pi-text);
      background: var(--pi-surface); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control);
    }

    .actions { display: flex; gap: 10px; padding: 14px 16px; }
    .actions button { flex: 0 0 auto; padding: 16px 18px; font: inherit; border-radius: var(--pi-radius-control); border: 1px solid var(--pi-border); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
    .cancel, .send, .finish { flex: 1 1 auto; font-weight: 600; }
    .send, .finish { background: var(--pi-selection-bg); }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "voice-composer-dialog": VoiceComposerDialog;
  }
}
