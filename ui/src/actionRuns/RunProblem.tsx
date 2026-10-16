import { permissionProblem } from "./actionRunModel";

/**
 * Shape: why a run cannot be shown or changed, in words the reader can act
 * on. A missing Actions permission names the permission and links to where
 * it is granted; any other refusal is the server's own words after `lead`.
 */
export function RunProblem({ error, subject, lead }: {
  error: string;
  /** What could not be read, such as "this run" or "the runs on this commit". */
  subject: string;
  /** A sentence before the server's words, such as "Forgerie could not read this run." */
  lead?: string | undefined;
}) {
  const permission = permissionProblem(error);
  if (permission) return <>
    <p>Forgerie's GitHub App needs <strong>Actions: read</strong> to read {subject}.</p>
    <p>{permission.url ? <><a href={permission.url} target="_blank" rel="noreferrer">Grant it in the app's settings on GitHub</a>, then accept the new permissions on the app's installation.</>
      : "Grant it in the app's settings on GitHub, then accept the new permissions on the app's installation."}</p>
  </>;
  return <p>{lead ? `${lead} ` : ""}{error}</p>;
}
