import { useRef, useState } from "react";
import { CpuIcon, FileIcon, LocateIcon, MessageSquareIcon, PlayIcon, XIcon } from "lucide-react";
import type { SessionModel } from "../contracts";
import { thinkingLevelsFor } from "../newSession";
import { LedgeStack, type LedgeStackRow } from "../ui/LedgeStack";
import { MenuButton, type MenuCommand } from "../ui/MenuButton";
import { ModelPicker, type PickerOpen } from "../ui/ModelPicker";
import type { SuggestionModel } from "../backlog/suggestions/suggestionsApi";
import type { ProposalEntry } from "../workflows/workflowsModel";
import { batchOf, leftOutWords, proposalNoun, type HeldProposal, type HeldSuggestion, type HeldWorkflow } from "./proposalLedge";

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
  /** Files each, one at a time. */
  onFileAll: (ids: readonly string[]) => void;
  /** Files each and starts a background session for each, one at a time. */
  onFileAndActAll: (ids: readonly string[]) => void;
  /** Files each, then this chat's agent works on them in order. Absent: no Here, such as while the chat is offline. */
  onFileAndActHere?: ((ids: readonly string[]) => void) | undefined;
}

/** File and act on another model: the chat's models, and what a pick does. Absent: the ledge offers no other model. */
export interface OtherModel {
  listModels: (signal: AbortSignal) => Promise<SessionModel[]>;
  /** The model and level File and act starts on now, for the panel's current choice and the menus' words. */
  launch: (id: string) => { model?: SessionModel | undefined; thinkingLevel?: string | undefined; words: string };
  /** Starts each on the picked model: the binding sets it for these launches, then files and acts. */
  onPick: (ids: readonly string[], model: SuggestionModel) => void;
}

/** When File and act here reaches the agent: now, or after the run it is in. */
export type HereTiming = "now" | "after-run";

/**
 * Shape: what the agent proposed, at the input. Each open backlog suggestion and workflow proposal is a summary row:
 * a kind (`Issue`, `Backlog`, `Workflow`), the title, and its actions. A suggestion files, or files and starts a
 * background session; a workflow opens its sheet for review. More holds the rest, with File and act here, which has
 * this chat do the work. The words show the full card in the thread, which stays the record. Two or more fold into a
 * stack with the newest in front. Open, the list's head offers one menu for every ready suggestion at once.
 */
export function ProposalLedge({ proposals, actions, otherModel, here = "now" }: {
  /** Newest first. */
  proposals: readonly HeldProposal[];
  actions: ProposalLedgeActions;
  otherModel?: OtherModel | undefined;
  here?: HereTiming;
}) {
  const [open, setOpen] = useState(false);
  // A pick from a row's More, or from the head's All menu for every ready suggestion.
  const [picking, setPicking] = useState<{ ids: readonly string[]; from: "row" | "head"; open: PickerOpen }>();
  const anchor = useRef<HTMLLIElement>(null);
  const headAnchor = useRef<HTMLSpanElement>(null);
  const show = (proposal: HeldProposal) => () => actions.onShow(proposal);
  const showCommand = (proposal: HeldProposal): MenuCommand => ({ label: "Show in chat", icon: <LocateIcon aria-hidden />, onSelect: show(proposal) });
  const hereSoon = here === "now";

  const suggestionRow = (proposal: HeldSuggestion): LedgeStackRow => {
    const { id, busy } = proposal;
    const launch = otherModel?.launch(id);
    const offered = proposal.offer && proposal.retry === undefined;
    return {
      key: proposal.key, kind: proposal.kind, title: proposal.title, gist: proposal.gist, onTitle: show(proposal),
      titleHint: "Show the full card in the chat", problem: proposal.problem,
      status: proposal.status === undefined ? undefined : { text: proposal.status, tone: "live" },
      anchor: picking?.from === "row" && picking.ids[0] === id ? anchor : undefined,
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
        ...(offered && actions.onFileAndActHere ? [{ label: "File and act here", icon: <MessageSquareIcon aria-hidden />, disabled: busy,
          detail: hereSoon ? "This chat works on it next" : "This chat works on it after this run", onSelect: () => actions.onFileAndActHere?.([id]) }] : []),
        ...(offered && otherModel ? [{ label: "File and act on another model…", icon: <CpuIcon aria-hidden />, disabled: busy,
          onSelect: () => setPicking({ ids: [id], from: "row", open: { query: "" } }) }] : []),
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

  // One ready suggestion has its own row's actions, so the All menu starts at two.
  const batch = batchOf(proposals);
  const { ids } = batch;
  const count = String(ids.length);
  const models = [...new Set(ids.map((id) => otherModel?.launch(id).words ?? "this chat's model"))];
  const on = models.length === 1 ? `on ${models[0]!}` : "each on its own model";
  const headAction = ids.length < 2 ? undefined : <span ref={headAnchor}>
    <MenuButton text={`All ${count} suggestions`} shortText={`All ${count}`} label={`Act on all ${count} suggestions`} layer="window"
      heading={leftOutWords(batch)} commands={[
        { label: `File all ${count}`, icon: <FileIcon aria-hidden />, detail: "Keep them in the backlog for later", onSelect: () => actions.onFileAll(ids) },
        { label: `File and act on all ${count}`, icon: <PlayIcon aria-hidden />, detail: `Starts ${count} sessions ${on}`, onSelect: () => actions.onFileAndActAll(ids) },
        ...(actions.onFileAndActHere ? [{ label: `File and act on all ${count} here`, icon: <MessageSquareIcon aria-hidden />,
          detail: hereSoon ? "This chat works through them, one at a time" : "After this run, this chat works through them, one at a time",
          onSelect: () => actions.onFileAndActHere?.(ids) }] : []),
        ...(otherModel ? [{ label: `File and act on all ${count} on another model…`, icon: <CpuIcon aria-hidden />, detail: `One model for all ${count} sessions`,
          onSelect: () => setPicking({ ids, from: "head", open: { query: "" } }) }] : []),
      ]} />
  </span>;

  const pickedLaunch = picking && otherModel ? otherModel.launch(picking.ids[0]!) : undefined;
  const pickAnchor = picking?.from === "head" ? headAnchor : anchor;
  return <>
    <LedgeStack rows={proposals.map((proposal) => proposal.type === "suggestion" ? suggestionRow(proposal) : workflowRow(proposal))}
      open={open} onToggle={() => setOpen(!open)} headAction={headAction}
      labels={{ noun: proposalNoun, show: (rows) => `Show all ${String(rows)} ${proposalNoun(rows)}`, fold: "Fold" }} />
    {picking && otherModel && <ModelPicker bare anchor={pickAnchor} open={picking.open} minWidthRem={18}
      onOpenChange={(next) => setPicking(next ? { ...picking, open: next } : undefined)}
      // The menu that opened the panel gets focus back.
      returnFocus={() => pickAnchor.current?.querySelector<HTMLElement>("[aria-haspopup=\"menu\"]")?.focus({ preventScroll: true })}
      binding={{ model: pickedLaunch?.model, thinkingLevel: pickedLaunch?.thinkingLevel, disabled: false, thinking: false,
        listModels: otherModel.listModels, listThinkingLevels: async () => thinkingLevelsFor(pickedLaunch?.model),
        onModel: async (provider, modelId) => { otherModel.onPick(picking.ids, { modelSpec: `${provider}/${modelId}`, thinkingLevel: pickedLaunch?.thinkingLevel }); },
        onThinkingLevel: async () => undefined }} />}
  </>;
}
