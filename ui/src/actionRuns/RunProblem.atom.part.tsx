import { RunProblem } from "./RunProblem";
import { permissionError } from "./fixtures/actionRuns";

export const name = "Run problem";
export const note = "Why a run cannot be read or changed; a missing Actions permission links to where it is granted";

export default function Permission() { return <RunProblem error={permissionError} subject="this run" />; }
export function PermissionWithoutLink() { return <RunProblem error={'Forgerie\'s GitHub App may not do this on forgerie/forgerie: it needs "Actions: read".'} subject="this run" />; }
export function Refused() { return <RunProblem error="GitHub answered 404: Not Found." subject="this run" lead="Forgerie could not read this run." />; }
