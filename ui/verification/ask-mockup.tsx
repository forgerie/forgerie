// Static hi-fi mockup: the composer in ask mode. No runtime, no network.
// ?state=<name> renders one state full page; ?state=all renders a sheet.
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUpIcon, ChevronLeftIcon, CornerDownLeftIcon, ImageIcon, InfoIcon, MicIcon, PaperclipIcon, SquareIcon, XIcon } from "lucide-react";
import "../src/ui/theme.css";
import "./ask-mockup.css";

interface Option { label: string; detail?: string }
interface Question { question: string; detail?: string; options: Option[]; multiple?: boolean }
const questions: Question[] = [
  { question: "Where should session drafts be kept?", detail: "Both survive a reconnect. Only storage survives a reload.", options: [
    { label: "In memory", detail: "Lost on reload. No new storage." },
    { label: "Local storage", detail: "Survives reload on this browser only." },
    { label: "On the server", detail: "Follows you across devices. Needs a new endpoint." }] },
  { question: "Which checks should run before each commit?", multiple: true, options: [
    { label: "Lint" }, { label: "Typecheck" }, { label: "Unit tests" }, { label: "Posture captures" }] },
  { question: "What should the new module be called?", options: [] },
];

interface State {
  label: string;
  note: string;
  step?: number;
  answered?: number[];
  picked?: number[];
  text?: string;
  interim?: string;
  dictating?: boolean;
  slash?: boolean;
  image?: boolean;
  normal?: boolean;
}
const states: Record<string, State> = {
  options: { label: "Ask mode", note: "Questions sit on top of the normal input. Tap an option or type.", step: 0 },
  typed: { label: "Typed answer", note: "Typing answers the current question. A typed answer replaces the option.", step: 0, answered: [0], text: "Memory for now. Move it to the server once sessions sync across devices." },
  dictating: { label: "Voice", note: "Dictation fills the same input. Interim words are grey.", step: 0, answered: [0], dictating: true, text: "Keep it in local storage", interim: " but clear it when the session" },
  multi: { label: "Several choices", note: "Question 2 allows several options. Back is on the step row.", step: 1, answered: [0, 1], picked: [0, 2] },
  last: { label: "Last question", note: "No options: the input is the whole answer. The action becomes Send answers.", step: 2, answered: [0, 1, 2], text: "draftStore" },
  slash: { label: "Slash command", note: "A command cannot be a form answer. The bar says so before you send.", step: 0, slash: true, text: "/rev" },
  image: { label: "Image attached", note: "An image cannot be a form answer. It goes out as a chat message and closes the questions.", step: 0, image: true, text: "This is what I mean. Match the layout in the screenshot." },
  normal: { label: "After the ask", note: "The questions are gone. The draft from before the ask is back.", normal: true, text: "Also check the reconnect notice on the folded cover screen." },
};

function Transcript() {
  return <div className="message-group">
    <div className="message message-user"><div className="user-bubble message-text"><p>Add draft persistence to the session client.</p></div></div>
    <div className="message message-assistant"><div className="message-text">
      <div className="trace-line"><span className="trace-marker" aria-hidden>{">"}</span><span className="trace-text"><span className="trace-label">ran 4 tools: read, bash</span></span></div>
      <div className="markdown"><p>The store already keeps the draft in memory across reconnects. Before I change storage, I need three decisions from you.</p></div>
      <div className="trace-line"><span className="trace-marker" aria-hidden>{">"}</span><span className="trace-text"><span className="trace-label">asked 3 questions</span></span></div>
    </div></div>
  </div>;
}

function Rail({ step, answered }: { step: number; answered: number[] }) {
  return <div className="askbar-head">
    <button className="icon-button quiet-button" aria-label="Previous question" disabled={step === 0}><ChevronLeftIcon size={18} /></button>
    <ol className="askbar-rail">
      {questions.map((_, index) => <li key={index} data-current={index === step || undefined} data-answered={answered.includes(index) || undefined} />)}
    </ol>
    <span className="askbar-count">{step + 1} of {questions.length}</span>
  </div>;
}

function Options({ question, picked, typed }: { question: Question; picked: number[]; typed: boolean }) {
  if (question.options.length === 0) return null;
  return <div className="askbar-options" data-kind={question.multiple ? "checkbox" : "radio"}>
    {question.options.map((option, index) => <label key={option.label} className="askbar-option">
      <input type={question.multiple ? "checkbox" : "radio"} name="mock" readOnly checked={!typed && picked.includes(index)} />
      <span className="askbar-option-text"><span>{option.label}</span>{option.detail && <small>{option.detail}</small>}</span>
    </label>)}
  </div>;
}

function Bar({ state }: { state: State }) {
  const step = state.step ?? 0;
  const question = questions[step]!;
  const chat = state.slash || state.image;
  const last = step === questions.length - 1;
  const typed = !!state.text && !chat && !question.multiple;
  return <div className="composer askbar" data-mode={state.normal ? "chat" : "ask"}>
    <div className="composer-shell">
      {!state.normal && <section className="askbar-questions" aria-label="Questions from the agent" data-muted={chat || undefined}>
        <Rail step={step} answered={state.answered ?? []} />
        <div className="askbar-body">
          <h2 className="askbar-question">{question.question}</h2>
          {question.detail && <p className="askbar-detail">{question.detail}</p>}
          <Options question={question} picked={state.picked ?? []} typed={typed} />
        </div>
      </section>}
      <div className="askbar-input">
        {state.slash && <div className="askbar-popover" role="listbox">
          {[["/review", "Review the changes since main"], ["/revert-last", "Undo the last edit"], ["/reverse-plan", "Plan backward from a goal"]].map(([name, detail], index) =>
            <div key={name} className="askbar-command" aria-selected={index === 0}><span className="askbar-command-name">{name}</span><span>{detail}</span></div>)}
        </div>}
        {chat && <p className="askbar-route"><InfoIcon size={14} aria-hidden />
          {state.slash ? "Commands run as chat messages. Sending closes these questions." : "Images go as a chat message. Sending closes these questions, and the agent reads your message as the answer."}</p>}
        {state.image && <div className="askbar-attachments"><span className="askbar-chip"><ImageIcon size={14} aria-hidden />layout-folded.png<button className="askbar-chip-remove" aria-label="Remove layout-folded.png"><XIcon size={12} /></button></span></div>}
        <div className="composer-input askbar-text" data-empty={!state.text || undefined}>
          {state.text ? <>{state.text}{state.interim && <span className="askbar-interim">{state.interim}</span>}<span className="askbar-caret" /></>
            : <span className="askbar-placeholder">{state.normal ? "Send a message..." : question.options.length ? "Or answer in your own words" : "Type your answer"}</span>}
        </div>
        <div className="composer-actions askbar-actions">
          <button className="icon-button quiet-button" aria-label="Attach an image"><PaperclipIcon size={18} /></button>
          <button className="icon-button quiet-button askbar-mic" data-live={state.dictating || undefined} aria-label={state.dictating ? "Stop dictation" : "Dictate"}>
            {state.dictating ? <SquareIcon size={12} fill="currentColor" /> : <MicIcon size={18} />}
          </button>
          {state.dictating && <span className="askbar-listening">Listening</span>}
          <span className="askbar-spacer" />
          {state.normal ? <button className="primary icon-button" aria-label="Send message"><ArrowUpIcon size={16} /></button>
            : chat ? <button className="primary askbar-primary">Send message<ArrowUpIcon size={16} aria-hidden /></button>
            : <>
              <button className="askbar-skip">Skip</button>
              <button className="primary askbar-primary">{last ? "Send answers" : "Next"}{!last && <CornerDownLeftIcon size={14} aria-hidden className="askbar-key" />}</button>
            </>}
        </div>
      </div>
    </div>
  </div>;
}

function Session({ state }: { state: State }) {
  return <main className="session-shell">
    <header className="session-header">
      <div className="session-heading"><span className="product-name">Forgerie</span><h1 className="session-title">Draft persistence</h1></div>
      <span className="connection-status">{state.normal ? "Connected" : "Waiting for you"}</span>
    </header>
    <div className="thread"><div className="transcript"><div className="thread-column">
      <Transcript />
      <div className="composer-region"><Bar state={state} /></div>
    </div></div></div>
  </main>;
}

function Sheet(): ReactNode {
  return <div className="mock-sheet">
    {Object.entries(states).map(([key, state]) => <figure key={key} className="mock-frame">
      <figcaption><strong>{state.label}</strong><span>{state.note}</span></figcaption>
      <div className="mock-device"><Session state={state} /></div>
    </figure>)}
  </div>;
}

const key = new URLSearchParams(location.search).get("state") ?? "all";
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
if (key === "all") document.documentElement.classList.add("mock-sheet-page");
createRoot(root).render(key === "all" ? <Sheet /> : <Session state={states[key] ?? states["options"]!} />);
