import { useState } from "react";
import { SecretEdit } from "./SecretEdit";
export const name = "SecretEdit";
export const note = "A password draft with only public status and wrapping actions. Saved values never prefill it.";
export default function Ready() {
  const [draft, setDraft] = useState("");
  return <SecretEdit label="Credential" status="Not set" value={draft} onChange={setDraft} disabled={false}
    save={{ label: "Save", disabled: !draft.trim(), onPress: () => setDraft("") }}
    remove={{ label: "Remove", disabled: true, onPress: () => {} }} />;
}
