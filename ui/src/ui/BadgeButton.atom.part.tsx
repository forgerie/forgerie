import { BotIcon } from "lucide-react";
import { BadgeButton } from "./BadgeButton";

export const name = "Badge button";
export const note = "An icon button with a waiting count or a working dot";

export default function Waiting() {
  return <BadgeButton icon={<BotIcon aria-hidden />} label="Child agents, 2 questions for you" count={2} active onPress={() => {}} />;
}
export function Working() {
  return <BadgeButton icon={<BotIcon aria-hidden />} label="Child agents, 1 working" active onPress={() => {}} />;
}
export function Quiet() {
  return <BadgeButton icon={<BotIcon aria-hidden />} label="Child agents" onPress={() => {}} />;
}
