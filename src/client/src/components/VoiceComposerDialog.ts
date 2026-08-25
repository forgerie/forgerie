import { LitElement, css, html, nothing } from "lit";
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
import {
  VOICE_CAPTURE_NONE,
  voiceCaptureClock,
  voiceCaptureDisplay,
  voiceCaptureDisplayChanged,
  voiceCaptureNoted,
  type VoiceCaptureDisplay,
  type VoiceCaptureProgress,
} from "../appShell/voiceCaptureProgress";
import { SPEECH_POLICY } from "../../../shared/speechPolicy";
import "./ModalSurface";

/** How often the ring redraws. Fine enough to look continuous, coarse enough to be cheap. */
const TICK_MS = 80;

/**
 * How often the listening frame re-checks whether it is still hearing a voice.
 *
 * Voiced audio arriving is an event; a voice stopping is not, so the silence
 * has to be noticed on a clock rather than waited for.
 */
const LISTEN_TICK_MS = 150;

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
  @state() private capture: VoiceCaptureDisplay = { hearing: false, seconds: 0 };
  @state() private tick = 0;

  private controller: PromptDictationController | undefined;
  private ticker: number | undefined;
  private tickerRate: number | undefined;
  private transcriptBuffer = "";
  private progress: VoiceCaptureProgress = VOICE_CAPTURE_NONE;
  private sampleRateHz = SPEECH_POLICY.audio.sampleRateHz;

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
        <header>
          <h2>Speak</h2>
          <button type="button" class="close" aria-label="Close" @click=${() => { this.dismiss(); }}>&times;</button>
        </header>

        <div class="body">
          <p class="status" role="status" aria-live="polite">
            ${this.renderIndicator()}<span class="status-text">${this.statusLine()}</span>
            ${this.capture.seconds === 0 ? nothing : html`<span class="clock">${voiceCaptureClock(this.capture)}</span>`}
          </p>

          ${transcript === undefined
            ? nothing
            : html`<textarea
                class="transcript"
                .value=${transcript}
                aria-label="Message to send"
                rows="2"
                @pointerdown=${() => { this.hold(); }}
                @input=${(event: Event) => { this.edit(event); }}
              ></textarea>`}
        </div>

        <footer>
          <button type="button" class="discard" @click=${() => { this.dismiss(); }}>Discard</button>
          ${this.renderPrimaryAction(transcript)}
        </footer>
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
    if (state.kind === "listening") {
      // Bright while a voice is arriving, dim between words. This is the only
      // honest liveness signal available: the pipeline reports voiced audio,
      // never amplitude, so there is nothing here to draw a level from.
      return html`<span class=${`dot listening ${this.capture.hearing ? "hearing" : ""}`} aria-hidden="true"></span>`;
    }
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
        if (this.capture.hearing) return "Hearing you.";
        if (this.capture.seconds > 0) {
          return state.endsItself ? "Gone quiet." : "Gone quiet. Finish when you are done.";
        }
        // Before a first word there is nothing to report but the contract, and
        // whether the turn ends itself is the part a reader has to know.
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
        return state.message;
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
      // The dialog owns this seam, so it can watch the voiced audio going past
      // without the speech controller growing a second event channel for one
      // caller's benefit. Everything the controller asked for is forwarded
      // untouched; the tap is additive.
      createCaptureSession: async (options) => {
        const session = await capability.createCaptureSession({
          ...options,
          onSpeechActivity: (activity) => {
            this.noteSpeech(activity);
            options.onSpeechActivity(activity);
          },
        });
        this.sampleRateHz = session.actualSampleRateHz;
        return session;
      },
      onStateChange: (dictation) => {
        this.composerState = voiceComposerFromDictation(dictation, this.composerState);
        this.syncTicker();
      },
    });
    this.controller = controller;
    controller.press();
    controller.release();
    this.readCapability(capability, controller);
    this.syncTicker();
  }

  private noteSpeech(activity: { readonly sampleCount: number }): void {
    this.progress = voiceCaptureNoted(this.progress, activity, this.sampleRateHz, Date.now());
    this.refreshCapture();
  }

  /** Publish the capture readout only when a reader would see a difference. */
  private refreshCapture(): void {
    const next = voiceCaptureDisplay(this.progress, Date.now());
    if (!voiceCaptureDisplayChanged(this.capture, next)) return;
    this.capture = next;
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
    this.composerState = voiceComposerHeard(transcript, Date.now());
    this.syncTicker();
  }

  /**
   * One timer, at whichever rate the current frame needs.
   *
   * Counting needs a ring that moves. Listening needs to notice a silence,
   * which no event reports. Everything else needs no clock at all.
   */
  private syncTicker(): void {
    const kind = this.composerState.kind;
    if (kind === "counting") { this.startTicking(TICK_MS); return; }
    if (kind === "listening") { this.startTicking(LISTEN_TICK_MS); return; }
    this.stopTicking();
  }

  private startTicking(everyMs: number): void {
    if (this.tickerRate === everyMs && this.ticker !== undefined) return;
    this.stopTicking();
    this.tickerRate = everyMs;
    this.ticker = window.setInterval(() => {
      const now = Date.now();
      if (voiceComposerDue(this.composerState, now)) {
        this.send();
        return;
      }
      if (this.composerState.kind === "listening") {
        this.refreshCapture();
        return;
      }
      if (this.composerState.kind !== "counting") {
        this.stopTicking();
        return;
      }
      this.tick += 1;
    }, everyMs);
  }

  private stopTicking(): void {
    if (this.ticker === undefined) return;
    window.clearInterval(this.ticker);
    this.ticker = undefined;
    this.tickerRate = undefined;
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
    /* A bottom sheet, not a centred dialog. Every control here is meant for a
       thumb on a phone held in one hand, and a box floating in the middle of
       the screen puts them at the far end of that thumb's reach. It also takes
       only the height it needs: this surface has one job at a time. */
    modal-surface {
      --modal-surface-place-items: end center;
      --modal-surface-backdrop-padding: 0;
      --modal-surface-width: min(560px, 100vw);
      --modal-surface-max-height: min(720px, 100dvh);
      --modal-surface-radius: var(--pi-radius-surface) var(--pi-radius-surface) 0 0;
    }
    /* Hairline separators, per the dialog grammar. Chrome recedes; the
       sentence you are about to send is the brightest thing here. */
    header {
      display: flex; align-items: center; gap: var(--pi-space-sm);
      padding: var(--pi-space-md) var(--pi-space-lg);
      border-block-end: 1px solid var(--pi-border-muted);
    }
    h2 { flex: 1 1 auto; margin: 0; font-size: var(--pi-text-lg); font-weight: 650; color: var(--pi-text-bright); }
    .close {
      background: none; border: none; color: var(--pi-dim); cursor: pointer;
      font-size: var(--pi-text-lg); line-height: 1;
      padding: var(--pi-space-xs) var(--pi-space-sm); border-radius: var(--pi-radius-inline);
    }
    .close:hover { background: var(--pi-surface-hover); color: var(--pi-text); }

    .body { padding: var(--pi-space-lg); display: flex; flex-direction: column; gap: var(--pi-space-md); }

    /* The status line is the only thing on screen while listening, so it is
       read at body size rather than as metadata. */
    .status {
      display: flex; align-items: center; gap: var(--pi-space-md); margin: 0;
      min-height: 34px; color: var(--pi-text); font-size: var(--pi-text-md);
    }
    .status-text { flex: 1 1 auto; }
    .clock { color: var(--pi-text-secondary); font-size: var(--pi-text-sm); font-variant-numeric: tabular-nums; }

    .dot { width: 10px; height: 10px; border-radius: var(--pi-radius-pill); flex: 0 0 auto; background: var(--pi-accent); }
    .dot.working { background: var(--pi-muted); }
    .dot.held, .dot.failed { background: none; border: 1px solid var(--pi-border); }

    /* Waiting for a voice: the app's ambient status pulse, which says the
       microphone is open without claiming anything is arriving. */
    .dot.listening { background: var(--pi-muted); animation: listening 1.6s ease-in-out infinite; }
    /* A voice is arriving. This is driven by voiced-audio reports, so it is
       evidence rather than decoration, and it stops pulsing because there is
       now something real to show. */
    .dot.listening.hearing {
      background: var(--pi-accent); animation: none;
      transform: scale(1.5); transition: transform var(--pi-motion-fast) ease-out;
    }
    @keyframes listening { 50% { opacity: .35; } }
    @media (prefers-reduced-motion: reduce) {
      .dot.listening { animation: none; }
      .dot.listening.hearing { transform: none; }
    }

    /* The number sits inside the ring, so the ring needs to be its containing
       block. Without the wrapper it would position against :host and land in
       the corner of the viewport. */
    .ring-wrap { position: relative; display: inline-flex; width: 34px; height: 34px; align-items: center; justify-content: center; flex: 0 0 auto; }
    .ring { position: absolute; inset: 0; width: 34px; height: 34px; transform: rotate(-90deg); }
    .ring-track { fill: none; stroke: var(--pi-border-muted); stroke-width: 2.5; }
    .ring-value { fill: none; stroke: var(--pi-accent); stroke-width: 2.5; stroke-linecap: round; }
    .ring-number { position: relative; font-size: var(--pi-text-xs); color: var(--pi-text-secondary); font-variant-numeric: tabular-nums; }

    /* One target. A touch anywhere on it stops the send; a touch on the text
       also focuses it, which is the only way the keyboard ever appears here. */
    /* Sized to the sentence, not to a guess. An empty box the height of a
       paragraph reads as content that failed to arrive. */
    .transcript {
      display: block; width: 100%; box-sizing: border-box; resize: none;
      field-sizing: content; min-height: 3lh; max-height: 40dvh;
      padding: var(--pi-space-md);
      font-family: inherit; color: var(--pi-text-bright);
      /* Static 16 px: mobile browsers zoom the page when a focused input is
         smaller, and this field is focused by the repair tap on purpose. */
      font-size: var(--pi-control-font-size);
      line-height: 1.45;
      background: var(--pi-bg); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-control);
    }
    .transcript:focus-visible, .close:focus-visible, footer button:focus-visible {
      outline: var(--pi-focus-ring, 2px solid var(--pi-accent)); outline-offset: 2px;
    }

    /* A sheet sits on the bottom edge, so the gesture bar is its problem now. */
    footer {
      display: flex; gap: var(--pi-space-md);
      padding: var(--pi-space-md) var(--pi-space-lg);
      padding-block-end: calc(var(--pi-space-md) + var(--pi-app-safe-area-bottom, 0px));
      border-block-start: 1px solid var(--pi-border-muted);
    }
    footer button {
      flex: 0 0 auto; min-height: 48px; padding: 0 var(--pi-space-lg);
      font-family: inherit; font-size: var(--pi-text-md);
      border-radius: var(--pi-radius-control); cursor: pointer;
    }
    /* Bordered-neutral secondary, one filled accent primary. */
    .discard { background: none; border: 1px solid var(--pi-border); color: var(--pi-text-secondary); }
    .discard:hover { background: var(--pi-surface-hover); color: var(--pi-text); }
    .cancel, .send, .finish {
      flex: 1 1 auto; font-weight: 650; border: none;
      background: var(--pi-accent); color: var(--pi-bg);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "voice-composer-dialog": VoiceComposerDialog;
  }
}
