import { WorkflowIcon } from "lucide-react";
import { BadgeButton } from "../ui/BadgeButton";

/** Shape: the session header's way into its saved workflows. The badge counts stops that wait on the reader. */
export function WorkflowOpener({ waiting, running, onOpen }: { waiting: number; running: boolean; onOpen: () => void }) {
  const parts = [waiting > 0 ? `${String(waiting)} waiting for you` : undefined, running ? "one running" : undefined].filter((part) => part !== undefined);
  return <BadgeButton icon={<WorkflowIcon aria-hidden />} label={`Workflows${parts.length > 0 ? `, ${parts.join(", ")}` : ""}`}
    count={waiting} active={running} onPress={onOpen} />;
}
