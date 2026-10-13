import { SettingsInput } from "./SettingsInput";
export const name = "SettingsInput";
export const note = "A typed settings value";
export default function Ready() { return <SettingsInput label="Value" value="example" onChange={() => {}} />; }
