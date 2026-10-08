import { createRoot } from "react-dom/client";
import { App } from "./App";
import { liveModelPrefs, ModelPrefsContext } from "./models/modelPrefsApi";
import "./ui/theme.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing app root.");
createRoot(root).render(<ModelPrefsContext.Provider value={liveModelPrefs}><App /></ModelPrefsContext.Provider>);
