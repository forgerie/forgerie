import { useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon, KeyRoundIcon } from "lucide-react";
import type { BacklogWarning } from "../../backlog/backlogApi";
import type { GitHubAuthLoad } from "../../backlog/useGitHubAuth";
import { writeClipboardText } from "../../clipboard";

/** The command that registers the GitHub App, run once per machine in the Forgerie folder. */
export const GITHUB_WIZARD = "scripts/github-app-wizard.sh";

function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="bl-text-button" onClick={() => { void writeClipboardText(text).then((ok) => setCopied(ok)); }}>
    {copied ? <CheckIcon aria-hidden size={14} /> : <CopyIcon aria-hidden size={14} />}{copied ? done : label}</button>;
}

const repos = (warnings: readonly BacklogWarning[]) => [...new Set(warnings.map((warning) => warning.path))];
function list(names: readonly string[]): string {
  return names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`;
}
function until(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : ` The code works until ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
}

/**
 * System molecule: what stands between a project and its GitHub issues, and the one step that
 * removes it. It sits above the list, because it is about every GitHub project at once.
 */
export function GitHubConnect({ load, warnings, busy, error, onConnect, onCancel }: {
  load: GitHubAuthLoad; warnings: readonly BacklogWarning[]; busy: boolean; error?: string | undefined;
  onConnect: () => void; onCancel: () => void;
}) {
  const names = list(repos(warnings));
  const state = load.type === "ready" ? load.value : undefined;
  if (state?.state === "connected") return null;
  return <section className="bl-warning bl-github" aria-label="GitHub login">
    <KeyRoundIcon aria-hidden size={16} />
    <div className="bl-warning-text" aria-live="polite">
      {load.type === "failed" ? <p>Forgerie could not say whether it is logged in to GitHub: {load.message}</p>
        : !state ? <p>Checking the GitHub login…</p>
        : state.state === "not-configured" ? <>
          <p>GitHub is not set up on this machine, so the issues of {names} are not listed. In the Forgerie folder, run:</p>
          <pre><code>{GITHUB_WIZARD}</code></pre>
          <CopyButton text={GITHUB_WIZARD} label="Copy command" done="Copied" />
        </>
        : state.state === "pending" ? <>
          <p>Enter this code on GitHub to let Forgerie read issues.{until(state.expiresAt)}</p>
          <output className="bl-code" aria-label={`Login code ${state.userCode}`}>{state.userCode}</output>
          <span className="bl-github-actions">
            <CopyButton text={state.userCode} label="Copy code" done="Code copied" />
            <a className="bl-text-button" href={state.verificationUri} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon aria-hidden size={14} />Open GitHub</a>
            <button type="button" className="bl-text-button" disabled={busy} onClick={onCancel}>Cancel</button>
          </span>
          <p className="bl-github-wait">Waiting for you to approve it. This page updates by itself.</p>
        </>
        : <>
          {state.reason ? <p>{state.reason}</p> : null}
          <p>Connect GitHub to list the issues of {names}. Forgerie only reads them.</p>
          <span className="bl-github-actions"><button type="button" className="bl-github-connect" disabled={busy} onClick={onConnect}>Connect GitHub</button></span>
        </>}
      {error ? <p className="bl-github-error" role="alert">{error}</p> : null}
    </div>
  </section>;
}
