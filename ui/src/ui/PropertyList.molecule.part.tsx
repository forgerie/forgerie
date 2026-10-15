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
/** In a side panel: short labels beside their values. */
export function Narrow() {
  return <PropertyList label="Schedule" narrow>
    <SettingsField label="Repeat">Every day</SettingsField>
    <SettingsField label="Run late" hint="If Forgerie is off at 1:00 AM, the run starts when it is back, up to 6 hours late.">Up to 6 hours</SettingsField>
  </PropertyList>;
}
