import { PropertyList } from "./PropertyList";
import { SettingsField } from "./settings/SettingsField";

export const name = "Property list";
export const note = "A document's property rows between two rules";

export default function Fields() {
  return <PropertyList label="Settings">
    <SettingsField label="Project" hint="Each run starts a new session in this folder.">forgerie</SettingsField>
    <SettingsField label="Time">3:00 AM</SettingsField>
  </PropertyList>;
}
