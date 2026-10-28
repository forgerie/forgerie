import { useRef, useState } from "react";
import { CpuIcon, FileIcon, LocateIcon, XIcon } from "lucide-react";
import type { SessionModel } from "../contracts";
import { thinkingLevelsFor } from "../newSession";
import { LedgeStack, type LedgeStackRow } from "../ui/LedgeStack";
import type { MenuCommand } from "../ui/MenuButton";
import { ModelPicker, type PickerOpen } from "../ui/ModelPicker";
import type { SuggestionModel } from "../backlog/suggestions/suggestionsApi";
import type { ProposalEntry } from "../workflows/workflowsModel";
import { proposalNoun, type HeldProposal, type HeldSuggestion, type HeldWorkflow } from "./proposalLedge";

export interface ProposalLedgeActions {
  onFile: (id: string) => void;
  /** Files and starts a background session. The reader stays in this chat. */
  onFileAndAct: (id: string) => void;
  onDismiss: (id: string) => void;
  /** Brings the proposal's full card into view in the thread. */
  onShow: (proposal: HeldProposal) => void;
  /** Opens a workflow proposal's sheet. */
  onReview: (entry: ProposalEntry) => void;
  onDismissProposal: (id: string) => void;
}

/** File and act on another model: the chat's models, and what a pick does. Absent: the row offers no other model. */
export interface OtherModel {
  listModels: (signal: AbortSignal) => Promise<SessionModel[]>;
  /** The model and level File and act starts on now, for the panel's current choice. */
  launch: (id: string) => { model?: SessionModel | undefined; thinkingLevel?: string | undefined; words: string };
  /** Starts on the picked model: the binding sets it for this launch, then files and acts. */
  onPick: (id: string, model: SuggestionModel) => void;
}

/**
 * Shape: what the agent proposed, at the input. Each open backlog suggestion and workflow proposal is a summary row:
 * a kind (`Issue`, `Backlog`, `Workflow`), the title, and its actions. A suggestion files, or files and starts a
 * background session; a workflow opens its sheet for review. More holds the rest. The words show the full card in
 * the thread, which stays the record. Two or more fold into a stack with the newest in front.
 */
export function ProposalLedge({ proposals, actions, otherModel }: {
  /** Newest first. */
  proposals: readonly HeldProposal[];
  actions: ProposalLedgeActions;
  otherModel?: OtherModel | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<{ id: string; open: PickerOpen }>();
  const anchor = useRef<HTMLLIElement>(null);
  const show = (proposal: HeldProposal) => () => actions.onShow(proposal);
  const showCommand = (proposal: HeldProposal): MenuCommand => ({ label: "Show in chat", icon: <LocateIcon aria-hidden />, onSelect: show(proposal) });

  const suggestionRow = (proposal: HeldSuggestion): LedgeStackRow => {
    const { id, busy } = proposal;
    const launch = otherModel?.launch(id);
    return {
      key: proposal.key, kind: proposal.kind, title: proposal.title, gist: proposal.gist, onTitle: show(proposal),
      titleHint: "Show the full card in the chat", problem: proposal.problem,
      status: proposal.status === undefined ? undefined : { text: proposal.status, tone: "live" },
      anchor: picking?.id === id ? anchor : undefined,
      actions: proposal.retry !== undefined
        ? [{ label: "Retry", tone: "primary", disabled: busy, onPress: () => (proposal.retry === "file-and-act" ? actions.onFileAndAct : actions.onFile)(id) }]
        : proposal.duplicate ? [{ label: "Review", tone: "primary", title: "A close match exists. Show the card to decide.", onPress: show(proposal) }]
        : proposal.offer ? [
          { label: "File", wideOnly: true, icon: <FileIcon aria-hidden />, disabled: busy, title: "File it and keep it for later", onPress: () => actions.onFile(id) },
          { label: "File and act", tone: "primary", disabled: busy, onPress: () => actions.onFileAndAct(id),
            title: launch ? `File it and start a background session on ${launch.words}` : "File it and start a background session" },
        ] : [],
      menuLabel: `More for ${proposal.title}`,
      menu: [
        ...(proposal.offer && proposal.retry === undefined && otherModel ? [{ label: "File and act on another model…", icon: <CpuIcon aria-hidden />, disabled: busy,
          onSelect: () => setPicking({ id, open: { query: "" } }) }] : []),
        showCommand(proposal), "separator",
        { label: "Dismiss", icon: <XIcon aria-hidden />, disabled: busy, onSelect: () => actions.onDismiss(id) },
      ],
    };
  };
  const workflowRow = (proposal: HeldWorkflow): LedgeStackRow => ({
    key: proposal.key, kind: "Workflow", kindTone: "live", title: proposal.title, gist: proposal.gist, onTitle: show(proposal),
    titleHint: "Show it in the chat",
    status: proposal.status === undefined ? undefined : { text: proposal.status, tone: "live" },
    actions: [{ label: "Review", tone: "primary", title: "Review the plan and start it", onPress: () => actions.onReview(proposal.entry) }],
    menuLabel: `More for ${proposal.title}`,
    menu: [showCommand(proposal), "separator", { label: "Dismiss", icon: <XIcon aria-hidden />, onSelect: () => actions.onDismissProposal(proposal.id) }],
  });

  const pickedLaunch = picking && otherModel ? otherModel.launch(picking.id) : undefined;
  return <>
    <LedgeStack rows={proposals.map((proposal) => proposal.type === "suggestion" ? suggestionRow(proposal) : workflowRow(proposal))}
      open={open} onToggle={() => setOpen(!open)}
      labels={{ noun: proposalNoun, show: (count) => `Show all ${String(count)} ${proposalNoun(count)}`, fold: "Fold" }} />
    {picking && otherModel && <ModelPicker bare anchor={anchor} open={picking.open} minWidthRem={18}
      onOpenChange={(next) => setPicking(next ? { ...picking, open: next } : undefined)}
      // The row's More opened the panel, so focus goes back to it.
      returnFocus={() => anchor.current?.querySelector<HTMLElement>("[aria-haspopup=\"menu\"]")?.focus({ preventScroll: true })}
      binding={{ model: pickedLaunch?.model, thinkingLevel: pickedLaunch?.thinkingLevel, disabled: false, thinking: false,
        listModels: otherModel.listModels, listThinkingLevels: async () => thinkingLevelsFor(pickedLaunch?.model),
        onModel: async (provider, modelId) => { otherModel.onPick(picking.id, { modelSpec: `${provider}/${modelId}`, thinkingLevel: pickedLaunch?.thinkingLevel }); },
        onThinkingLevel: async () => undefined }} />}
  </>;
}
