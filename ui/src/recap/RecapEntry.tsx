import type { RecapData } from "@shared/sessionRecap";
import { RuledBrief } from "../ui/RuledBrief";
import { Afterword } from "../ui/Afterword";
import { recapSource, recapSummary } from "./recapModel";

export function RecapEntry({ data, needs = "" }: { data: RecapData; needs?: string }) {
  return <Afterword kind="content" source={recapSource(data)}>
    <RuledBrief title="While you were away" text={recapSummary(data)} urgent={{ label: "Needs you", text: needs }} />
  </Afterword>;
}
