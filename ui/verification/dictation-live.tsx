// Acceptance consumer, not a preview: calls the real microphone and speech API, never Pi prompt routes.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantRuntimeProvider, useExternalStoreRuntime } from "@assistant-ui/react";
import { ForgerieDictationAdapter } from "../src/speech/ForgerieDictationAdapter";
import { DictationProvider } from "../src/DictationProvider";
import { useThreadMessages } from "../src/useThreadMessages";
import { SessionFrame } from "../src/ui/SessionFrame";
import { Thread } from "../src/ui/Thread";
import "../src/ui/theme.css";
function LiveDictation() {
  const [dictation] = useState(() => new ForgerieDictationAdapter());
  const runtime = useExternalStoreRuntime({ messages: useThreadMessages([], false), onNew: async () => {}, adapters: { dictation } });
  return <AssistantRuntimeProvider runtime={runtime}><DictationProvider adapter={dictation}>
    <SessionFrame name="Live dictation acceptance" status="Connected"><Thread /></SessionFrame>
  </DictationProvider></AssistantRuntimeProvider>;
}
createRoot(document.getElementById("root")!).render(<LiveDictation />);
