import { createRoot } from "react-dom/client";
import { App } from "./App";
import { entryName } from "./appUpdate";
import { liveModelPrefs, ModelPrefsContext } from "./models/modelPrefsApi";
import { AppUpdateNotice } from "./ui/AppUpdateNotice";
import "./ui/theme.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing app root.");
// This module is the entry, so its URL names the running build. The dev server has no build to compare.
const running = import.meta.env.DEV ? undefined : entryName(import.meta.url);
createRoot(root).render(<ModelPrefsContext.Provider value={liveModelPrefs}>
  <App />
  <AppUpdateNotice running={running} />
</ModelPrefsContext.Provider>);
