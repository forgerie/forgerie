import type { RecapData } from "@shared/sessionRecap";
import { AwayNote } from "../ui/AwayNote";
import { Afterword } from "../ui/Afterword";
import { recapSource, recapSummary } from "./recapModel";

export function RecapEntry({ data, needs = "" }: { data: RecapData; needs?: string }) {
  return <Afterword kind="content" source={recapSource(data)}>
    <AwayNote title="While you were away" summary={recapSummary(data)} needs={needs} />
  </Afterword>;
}
