import { ExternalLinkIcon, KeyRoundIcon } from "lucide-react";
import type { BacklogWarning } from "../../backlog/backlogApi";
import type { GitHubAppLoad } from "../../backlog/useGitHubApp";

const reposOf = (warnings: readonly BacklogWarning[]) => [...new Set(warnings.map((warning) => warning.path))];
function list(names: readonly string[]): string {
  return names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`;
}

/**
 * System molecule: what stands between a project and its GitHub issues, and the one step that removes
 * it. Setting up leaves for GitHub and comes back here; installing opens GitHub in a new tab. It sits
 * above the list, because it is about every GitHub project at once.
 */
export function GitHubConnect({ load, warnings, busy, error, onSetUp, onRefresh }: {
  load: GitHubAppLoad; warnings: readonly BacklogWarning[]; busy: boolean; error?: string | undefined;
  onSetUp: () => void; onRefresh: () => void;
}) {
  const state = load.type === "ready" ? load.value : undefined;
  const missing = warnings.filter((warning) => warning.kind === "provider-install");
  const refused = state?.state === "configured" && warnings.some((warning) => warning.kind === "provider-auth");
  if (state?.state === "configured" && missing.length === 0 && !refused && !error) return null;
  return <section className="bl-warning bl-github" aria-label="GitHub">
    <KeyRoundIcon aria-hidden size={16} />
    <div className="bl-warning-text" aria-live="polite">
      {load.type === "failed" ? <p>Forgerie could not say whether GitHub is set up: {load.message}</p>
        : !state ? <p>{busy ? "Finishing the GitHub setup…" : "Checking GitHub…"}</p>
        : state.state === "not-configured" ? <>
          <p>Set up GitHub to list the issues of {list(reposOf(warnings)) || "your projects"}. Forgerie creates its own GitHub App. Agents use it to work on issues and pull requests. GitHub asks you to confirm.</p>
          <span className="bl-github-actions"><button type="button" className="bl-github-connect" disabled={busy} onClick={onSetUp}>
            {busy ? "Opening GitHub…" : "Set up GitHub"}</button></span>
        </>
        : refused ? <>
          <p>GitHub no longer accepts {state.app.slug}. It was deleted, or its key was revoked. Remove it from the backlog menu, then set GitHub up again.</p>
        </>
        : missing.length ? <>
          <p>{state.app.slug} is not installed on {list(reposOf(missing))}. Install it there, then come back.</p>
          <span className="bl-github-actions">
            <a className="bl-github-connect" href={state.installUrl} target="_blank" rel="noopener noreferrer">Install on GitHub<ExternalLinkIcon aria-hidden size={14} /></a>
            <button type="button" className="bl-text-button" onClick={onRefresh}>Check again</button>
          </span>
          <p className="bl-github-wait">Installing on an organization you do not own sends its owners a request.</p>
        </> : null}
      {error ? <p className="bl-github-error" role="alert">{error}</p> : null}
    </div>
  </section>;
}
