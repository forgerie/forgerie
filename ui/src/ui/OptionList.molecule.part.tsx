import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { OptionList, type OptionGroup } from "./OptionList";

export const name = "Option list";
export const note = "Choices in named groups, with search, one status line, and a command at the foot";

const favorites: OptionGroup = { key: "favorites", label: "Favorites", options: [
  { id: "proxy/opus", name: "Claude Opus 5.5", details: [{ text: "default", strong: true }, "Proxy", "1m context"] },
  { id: "proxy/flash", name: "Gemini 3.8 Flash", details: ["Proxy", "1m context"] },
] };
const anthropic: OptionGroup = { key: "anthropic", label: "Anthropic", options: [
  { id: "anthropic/haiku", name: "Claude Haiku 4.5", variant: "latest", details: ["200k context"] },
  { id: "anthropic/haiku-dated", name: "Claude Haiku 4.5", variant: "2025-10-01", details: ["200k context"] },
] };
const hidden: OptionGroup = { key: "local", label: "Local", options: [
  { id: "local/llama", name: "Llama 3 8B", tone: "faint", details: ["8.2k context", "hidden"] },
] };

function Searchable({ groups, extra }: { groups: readonly OptionGroup[]; extra?: OptionGroup }) {
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState("proxy/opus");
  const [showing, setShowing] = useState(false);
  const needle = query.trim().toLowerCase();
  const all = showing && extra ? [...groups, extra] : groups;
  const shown = all.map((group) => ({ ...group, options: group.options
    .filter((option) => !needle || option.name.toLowerCase().includes(needle))
    .map((option) => ({ ...option, current: option.id === current })) })).filter((group) => group.options.length > 0);
  return <OptionList label="Models" groups={shown}
    search={{ value: query, onChange: setQuery, label: "Search models", placeholder: "Search models" }}
    status={shown.length === 0 ? { tone: "status", text: `No model matches "${query.trim()}".` } : undefined}
    action={extra ? { label: showing ? "Hide models you do not show" : "Show 1 hidden model", pressed: showing,
      icon: showing ? <EyeOffIcon aria-hidden size={14} /> : <EyeIcon aria-hidden size={14} />, onPress: () => setShowing(!showing) } : undefined}
    input={{ type: "focus", onChoose: setCurrent }} />;
}

export default function Grouped() { return <Searchable groups={[favorites, anthropic]} extra={hidden} />; }
export function Loading() {
  return <OptionList label="Projects" groups={[]} status={{ tone: "status", text: "Loading projects…" }} input={{ type: "focus", onChoose: () => {} }} />;
}
export function Failed() {
  return <OptionList label="Models" groups={[favorites]} alert="Model not found: anthropic/claude-haiku-4-5"
    input={{ type: "focus", onChoose: () => {} }} />;
}
export function Unavailable() {
  return <OptionList label="Models" groups={[]} status={{ tone: "alert", text: "Models unavailable: HTTP 404" }} input={{ type: "focus", onChoose: () => {} }} />;
}
