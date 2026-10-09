import { ClaimList } from "./ClaimList";

export const name = "Claim list";
export const note = "Findings tagged verified, inferred, opinion or unknown, with evidence";

export default function Findings() {
  return <ClaimList code={"Why no session has the guide\nverified: sessiond started at 18:22, before the guide landed at 21:20\n  `systemctl --user show forgerie-sessiond -p ActiveEnterTimestamp`\ninferred: every live session still has the old system prompt\nopinion: restart now, because no run is in progress\nunknown: whether delegated agents ever saw an earlier copy"} />;
}
export function NoTitle() {
  return <ClaimList code={"verified: the build passes\nunknown: behaviour on the physical Fold"} />;
}
