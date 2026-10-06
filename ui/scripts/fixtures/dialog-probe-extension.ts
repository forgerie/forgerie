// A test-only Pi extension. `/dialog-probe` opens a confirm, a select, and an
// input dialog in turn and writes what the user answered to
// dialog-probe-result.json in the session folder. Used by real-dialog-check.mjs.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

interface ProbeUi {
  confirm(title: string, message: string): Promise<boolean>;
  select(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
}
interface ProbeApi {
  registerCommand(name: string, command: { description: string; handler: (args: string, ctx: { ui: ProbeUi; cwd: string }) => Promise<void> }): void;
}

export default function (pi: ProbeApi) {
  pi.registerCommand("dialog-probe", {
    description: "Open one dialog of each kind (test only)",
    handler: async (_args, ctx) => {
      const confirmed = await ctx.ui.confirm("Deploy the probe?", "This is an automated UI test. Nothing is deployed.");
      const target = await ctx.ui.select("Pick a probe target", ["staging", "production", "nowhere"]);
      const name = await ctx.ui.input("Name the probe", "probe-name");
      writeFileSync(join(ctx.cwd, "dialog-probe-result.json"), JSON.stringify({ confirmed, target: target ?? null, name: name ?? null }));
    },
  });
}
