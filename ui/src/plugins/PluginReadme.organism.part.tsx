import { PluginReadme } from "./PluginReadme";

export const name = "Plugin README";
export const note = "A Pi package's README on its settings page";

const repository = { blob: "https://github.com/example/pi-goal/blob/HEAD/", raw: "https://raw.githubusercontent.com/example/pi-goal/HEAD/", directory: "" };
const text = [
  "# pi-goal",
  "",
  "Keeps a long-running **goal** in view across sessions. See [the guide](docs/guide.md) and [the changelog](CHANGELOG.md).",
  "",
  "## Install",
  "",
  "```sh",
  "pi install npm:pi-goal",
  "```",
].join("\n");

export default function Ready() {
  return <PluginReadme name="Goal" packageName="pi-goal" load={{ type: "ready", value: { file: "README.md", truncated: false, repository, text } }} />;
}
export function CutShort() {
  return <PluginReadme name="Goal" packageName="pi-goal" load={{ type: "ready", value: { file: "README.md", truncated: true, repository, text } }} />;
}
export function NoRepository() {
  return <PluginReadme name="Goal" packageName="pi-goal" load={{ type: "ready", value: { file: "README.md", truncated: true, text } }} />;
}
export function Failed() {
  return <PluginReadme name="Goal" packageName="pi-goal" load={{ type: "failed", message: "EACCES: permission denied, open 'README.md'" }} />;
}
