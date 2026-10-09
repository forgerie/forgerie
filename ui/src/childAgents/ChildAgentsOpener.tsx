import { BotIcon } from "lucide-react";
import { BadgeButton } from "../ui/BadgeButton";
import type { ChildSummary } from "./childAgentsModel";

/** Shape: the session header's way into its child agents. The badge counts questions for the reader. */
export function ChildAgentsOpener({ children, onOpen }: { children: readonly ChildSummary[]; onOpen: () => void }) {
  const questions = children.reduce((total, child) => total + child.questions.length, 0);
  const working = children.filter((child) => child.busy).length;
  const parts = [
    questions > 0 ? `${String(questions)} ${questions === 1 ? "question" : "questions"} for you` : undefined,
    working > 0 ? `${String(working)} working` : undefined,
  ].filter((part) => part !== undefined);
  const label = `Child agents${parts.length > 0 ? `, ${parts.join(", ")}` : ""}`;
  return <BadgeButton icon={<BotIcon aria-hidden />} label={label} count={questions} active={working > 0} onPress={onOpen} />;
}
