// Screenshot entry for the actual production component's Caliper scenarios. No duplicate renderer or API calls.
import { createRoot } from "react-dom/client";
import "../src/ui/theme.css";
import * as scenarios from "../src/childAgents/ChildAgentsPanel.organism.part";
const name = new URLSearchParams(location.search).get("state") ?? "default";
const Scenario = Object.entries(scenarios).find(([key, value]) => key === name && typeof value === "function")?.[1];
if (typeof Scenario !== "function") throw new Error(`Unknown child-control state ${name}`);
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(<Scenario />);
