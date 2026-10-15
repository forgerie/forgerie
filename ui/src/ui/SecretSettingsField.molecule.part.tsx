import { SecretSettingsField } from "./SecretSettingsField";
export const name = "SecretSettingsField";
export const note = "A write-only settings row with fixture reads and writes. It clears drafts and never renders server errors.";
const read = async () => false;
export default function Ready() {
  return <SecretSettingsField label="Credential" read={read} busy={false} write={async () => true} clear={read}
    describe={present => ({ present: present === true, editable: true, value: present ? "Set here" : "Not set", hint: "The saved value is never shown." })}
    failure={() => "Could not save. Try again."} />;
}
