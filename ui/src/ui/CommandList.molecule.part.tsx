import { CommandList } from "./CommandList";

export const name = "Command list";
export const note = "Shell commands to run in order, each copyable, with a note";

export default function Deploy() {
  return <CommandList code={"# Rebuild the browser app and server\nnpm run build\n# Restart the units that serve it\nsystemctl --user restart forgerie-web.service forgerie-sessiond.service\n# Check that the web unit answers\ncurl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:8504/"} />;
}
export function One() {
  return <CommandList code={"systemctl --user restart forgerie-sessiond.service"} />;
}
export function Continued() {
  return <CommandList code={"# Capture every posture in the dark scheme\nnode scripts/capture-postures.mjs \\\n  --url http://127.0.0.1:8504/ \\\n  --out /tmp/shots --color-scheme dark"} />;
}
