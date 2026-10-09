import { useState } from "react";
import { ChoiceSelect } from "./ChoiceSelect";
export const name = "Choice select";
export default function Ready() { const [value, setValue] = useState(""); const [message, setMessage] = useState("Manage"); return <ChoiceSelect label="Collection" value={value} onChoose={setValue} options={[{ value: "", label: "All items" }, { value: "one", label: "KORI" }]} action={{ label: message, onPress: () => setMessage("Opened") }} />; }
export function LongName() { return <ChoiceSelect label="Collection" value="one" onChoose={() => undefined} options={[{ value: "one", label: "A collection with a long descriptive name that still leaves its actions available" }]} action={{ label: "Manage", onPress: () => undefined }} />; }
