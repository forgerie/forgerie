import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResourceDiagnostic, Skill } from "@earendil-works/pi-coding-agent";

/** Resolve the Pi resource package that Forgerie adds only to hosted sessions. */
export function bundledForgerieSkillsPackagePath(): string {
  return fileURLToPath(new URL("../../../skills/", import.meta.url));
}

/**
 * Agent files Forgerie writes for its Durable children. They shadow pi-subagents' built-in files of the same name,
 * whose instructions describe pi-subagents' tools, and lose to project and profile files.
 */
export function bundledForgerieAgentsPath(): string {
  return fileURLToPath(new URL("../../../agents/", import.meta.url));
}

/** Keep Forgerie's hosted-session skill when the shared Pi profile has the same name. */
export function preferBundledForgerieSkills(result: {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
}): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
  return {
    skills: result.skills,
    diagnostics: result.diagnostics.filter((diagnostic) => !isIntentionalBundledSkillCollision(diagnostic)),
  };
}

function isIntentionalBundledSkillCollision(diagnostic: ResourceDiagnostic): boolean {
  const collision = diagnostic.collision;
  if (diagnostic.type !== "collision" || collision?.resourceType !== "skill") return false;

  const relativeWinnerPath = relative(bundledForgerieSkillsPackagePath(), collision.winnerPath);
  return relativeWinnerPath !== ""
    && relativeWinnerPath !== ".."
    && !relativeWinnerPath.startsWith(`..${sep}`)
    && !isAbsolute(relativeWinnerPath);
}
