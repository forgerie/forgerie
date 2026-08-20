import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { DOCUMENT_PREVIEW_SANDBOX } from "../../../shared/workspaceFiles";
import { workspaceDocumentPreviewUrl } from "../api/urls";
import type { WorkspacePanelContext } from "../plugins/types";
import { workspacePanelStyles } from "./shared";

/**
 * The preview tool's state, converted once from app state. `empty` is a real
 * case, not a missing prop: the tool stays open after its document is closed
 * elsewhere (another device, a workspace switch) and must say so.
 */
export type WorkspacePreviewModel =
  | { kind: "empty" }
  | { kind: "document"; path: string; src: string };

export function workspacePreviewModel(
  context: Pick<WorkspacePanelContext, "machine"> & {
    workspace: Pick<WorkspacePanelContext["workspace"], "id" | "projectId">;
    state: Pick<WorkspacePanelContext["state"], "previewDocument">;
  },
  version: number,
): WorkspacePreviewModel {
  const document = context.state.previewDocument;
  if (document === undefined) return { kind: "empty" };
  return {
    kind: "document",
    path: document.path,
    src: workspaceDocumentPreviewUrl(context.workspace.projectId, context.workspace.id, document.path, {
      machineId: context.machine.id,
      ...(version === 0 ? {} : { version }),
    }),
  };
}

@customElement("workspace-preview-panel")
export class WorkspacePreviewPanel extends LitElement {
  static override styles = [
    workspacePanelStyles,
    css`
      :host { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
      /* Rendered documents get the platform's default canvas, not the app
         theme: an unstyled page assumes black-on-white like a browser tab. */
      .document-frame { flex: 1 1 auto; min-height: 0; width: 100%; border: 0; background: #fff; }
    `,
  ];

  @property({ attribute: false }) context?: WorkspacePanelContext;
  /** Bumped by Reload; changes the frame URL so the document refetches. */
  @state() private reloadVersion = 0;

  protected override render(): TemplateResult {
    const context = this.context;
    if (context === undefined) return html``;
    const model = workspacePreviewModel(context, this.reloadVersion);
    if (model.kind === "empty") return html`<p class="muted">No document open. Open an HTML file's preview from Files.</p>`;
    return html`
      <div class="viewer-header">
        <strong>${model.path}</strong>
        <button @click=${() => { this.reloadVersion += 1; }}>Reload</button>
      </div>
      <iframe class="document-frame" src=${model.src} sandbox=${DOCUMENT_PREVIEW_SANDBOX} title=${model.path}></iframe>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "workspace-preview-panel": WorkspacePreviewPanel;
  }
}
