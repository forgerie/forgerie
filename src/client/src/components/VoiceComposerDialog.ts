import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PromptAttachment, PromptAttachmentDelivery } from "../../../shared/apiTypes";
import type { ComposerCapabilities } from "../composerCapabilities";
import { VOICE_COMPOSER_WAITING, voiceComposerBusy, type VoiceComposerState } from "../appShell/voiceComposerState";
import "./ModalSurface";
import "./PromptEditor";

/**
 * Exported so its presentation contract can be asserted directly, the way the
 * new-session pop-up's is. The rule these styles encode is easy to undo by
 * accident and expensive to notice by eye.
 */
export const voiceComposerDialogStyles = css`
    /* Above the wheel (40), which is one of the things that opens this. The
       size container makes the container-relative sizing below resolve against
       this surface rather than against the viewport. */
    :host { position: fixed; inset: 0; z-index: 50; display: block; color: var(--pi-text); font: var(--pi-text-md) system-ui, sans-serif; container-type: size; }
    /* The composer island is the surface, exactly as it is in the new-session
       pop-up. A dialog box here would draw a second border, background, and
       shadow around something that already carries all three, and would take
       width from a control row that needs every pixel at the folded size. */
    modal-surface {
      --modal-surface-background: transparent;
      /* The composer anchors its model and command menus to its own controls,
         and they open above the island. A clipping dialog paints them away. */
      --modal-surface-overflow: visible;
      --modal-surface-border: none;
      --modal-surface-shadow: none;
      --modal-surface-radius: 0;
      --modal-surface-width: min(42rem, calc(100% - clamp(1rem, 4cqi, 2rem)));
      --modal-surface-height: auto;
      --modal-surface-max-width: 100%;
      --modal-surface-max-height: calc(100% - clamp(1rem, 4cqb, 2rem));
      /* Focus rests on the dialog section, because focusing the text would
         raise the on-screen keyboard. A ring around the whole surface tells a
         reader nothing they can act on, so it is suppressed here rather than
         for every dialog. */
      --modal-surface-section-outline: none;
    }
    .voice { box-sizing: border-box; max-height: calc(100cqb - clamp(1rem, 4cqb, 2rem)); min-height: 0; display: flex; flex-direction: column; }
    prompt-editor { display: block; min-width: 0; }
    .voice-hint { margin: var(--pi-space-sm) 0 0; color: var(--pi-text-secondary); font-size: var(--pi-text-sm); }
  `;

/**
 * Speak a message without a keyboard.
 *
 * This dialog holds no composer of its own. It hosts the same `prompt-editor`
 * the chat and the new-session modal host, in voice-first mode, and that is the
 * entire design. An earlier version of this file carried its own textarea,
 * status line, and buttons, which meant every improvement to the real composer
 * stopped at this door: no attachments, no slash commands, no model picker, no
 * prompt history. A spoken message needs all of those exactly as often as a
 * typed one does, because it is the same message.
 *
 * What is left here is what a dialog is actually for:
 *
 * - **Placement.** Centered, like every other dialog in the app, using the
 *   shared `modal-surface` defaults rather than a bespoke sheet.
 * - **Dismissal.** A live microphone or a running countdown makes the surface
 *   busy, so a stray backdrop press cannot silently discard a spoken turn.
 * - **Ownership.** Keyed on the session by its host, so switching destinations
 *   tears the dialog down instead of re-pointing a live microphone somewhere
 *   else.
 */
@customElement("voice-composer-dialog")
export class VoiceComposerDialog extends LitElement {
  /** The same capability declaration the chat composer receives. */
  @property({ attribute: false }) capabilities: ComposerCapabilities = {};
  @property() sessionId?: string;
  @property() machineId = "local";
  @property() cwd?: string;
  @property() projectId?: string;
  @property() workspaceId?: string;
  @property({ attribute: false }) promptHistory: readonly string[] = [];
  @property({ type: Boolean }) sending = false;
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) canSteer = false;
  @property({ type: Boolean }) isCompacting = false;
  @property({ type: Boolean }) queuedCompactionAvailable = true;
  @property({ attribute: false }) onSendPrompt?: (text: string, streamingBehavior?: "steer" | "followUp", attachments?: PromptAttachment[], delivery?: PromptAttachmentDelivery) => void;
  @property({ attribute: false }) onDismiss?: () => void;

  @state() private voiceState: VoiceComposerState = VOICE_COMPOSER_WAITING;

  override render(): TemplateResult {
    return html`
      <modal-surface
        label="Speak to this session"
        .busy=${voiceComposerBusy(this.voiceState)}
        .onClose=${() => { this.dismiss(); }}
        .onBusyEscape=${() => { this.dismiss(); }}
      >
        <div class="voice">
          <!-- No initialFocus is passed to modal-surface, so focus lands on the
               dialog section rather than in the editor. Focusing the text would
               raise the on-screen keyboard, which is the one thing this dialog
               exists to avoid. Every control here stays reachable by touch.

               There is no dialog header either. The way out is the composer's
               own dismiss control, which is where the new-session pop-up puts
               it, and which cancels the microphone on its way out. A title bar
               would be the one piece of chrome this surface has that its
               sibling does not. -->
          <prompt-editor
            aria-label="Spoken message"
            .voiceMode=${"voice-first"}
            .capabilities=${this.composerCapabilities()}
            .sessionId=${this.sessionId}
            .machineId=${this.machineId}
            .cwd=${this.cwd}
            .projectId=${this.projectId}
            .workspaceId=${this.workspaceId}
            .promptHistory=${this.promptHistory}
            .disabled=${this.disabled}
            .sending=${this.sending}
            .canSteer=${this.canSteer}
            .isCompacting=${this.isCompacting}
            .queuedCompactionAvailable=${this.queuedCompactionAvailable}
            .editorLabel=${"Spoken message"}
            .placeholderText=${"Speak, or type here."}
            .draftStorageKeyOverride=${null}
            .completionBoundary=${this}
            .onVoiceStateChange=${(state: VoiceComposerState) => { this.voiceState = state; }}
            .onSend=${(text: string, streamingBehavior?: "steer" | "followUp", attachments?: PromptAttachment[], delivery?: PromptAttachmentDelivery) => { this.send(text, streamingBehavior, attachments, delivery); }}
          ></prompt-editor>
          ${this.voiceState.kind !== "failed" || !this.voiceState.retryable ? nothing : html`
            <p class="voice-hint">Press the microphone to try again.</p>
          `}
        </div>
      </modal-surface>
    `;
  }

  /**
   * The session's own capabilities, plus the way out.
   *
   * Everything the chat composer offers arrives untouched. Only the dismiss
   * control is added, because leaving is a property of being in a dialog
   * rather than of the session.
   */
  private composerCapabilities(): ComposerCapabilities {
    return { ...this.capabilities, dismiss: { label: "Discard", onDismiss: () => { this.dismiss(); } } };
  }

  private send(text: string, streamingBehavior?: "steer" | "followUp", attachments?: PromptAttachment[], delivery?: PromptAttachmentDelivery): void {
    this.onSendPrompt?.(text, streamingBehavior, attachments, delivery);
    this.onDismiss?.();
  }

  /**
   * Close, and take the microphone with it.
   *
   * The composer aborts its own capture when it disconnects, so dismissing is
   * enough. Nothing here reaches into the dictation lifecycle.
   */
  private dismiss(): void {
    this.onDismiss?.();
  }

  static override styles = voiceComposerDialogStyles;
}

declare global {
  interface HTMLElementTagNameMap {
    "voice-composer-dialog": VoiceComposerDialog;
  }
}
