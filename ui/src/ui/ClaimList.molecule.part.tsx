import { ClaimList } from "./ClaimList";

export const name = "Claim list";
export const note = "Findings tagged by confidence or by a research verdict, with evidence";

export default function Findings() {
  return <ClaimList code={"Why no session has the guide\nverified: sessiond started at 18:22, before the guide landed at 21:20\n  `systemctl --user show forgerie-sessiond -p ActiveEnterTimestamp`\ninferred: every live session still has the old system prompt\nopinion: restart now, because no run is in progress\nunknown: whether delegated agents ever saw an earlier copy"} />;
}
export function NoTitle() {
  return <ClaimList code={"verified: the build passes\nunknown: behaviour on the physical Fold"} />;
}
export function ResearchVerdicts() {
  return <ClaimList code={"Fact check\nsupported: unluac supports Lua 5.0\n  SourceForge project page, release notes 1.2.3\npartly: The four-point difference is significant\n  It falls within the overlapping uncertainty intervals.\nunsupported: WebDev scores use the same protocol\n  The supplied evidence contains scores, not the protocol.\ncontradicted: In stock\n  StarryhHope listing, 28 Sep 2026: sold out"} />;
}
export function MixedWithConfidence() {
  return <ClaimList code={"verified: The fix is on main as `721dd29a`\n  `git branch --contains 721dd29a` lists main.\ninferred: The cold boot regression comes from network-online ordering\ncontradicted: In stock\n  StarryhHope listing, 28 Sep 2026: sold out\nunknown: Whether the Fold 8 cover screen clips the composer"} />;
}
