import type { RecapData } from "@shared/sessionRecap";
import { RecapPanel } from "../ui/RecapPanel";
import { Afterword } from "../ui/Afterword";
import { recapSource } from "./recapModel";

export function RecapEntry({ data, needs = "" }: { data: RecapData; needs?: string }) {
  return <Afterword kind="content" source={recapSource(data)}>
    <RecapPanel spacing="flush" recap={{ goal: data.goal, done: data.done, left: data.left, next: data.next ?? "", needs }} labels={{ title: "While you were away" }} />
  </Afterword>;
}
