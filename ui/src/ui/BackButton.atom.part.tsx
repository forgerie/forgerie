import { BackButton } from "./BackButton";

export const name = "Back button";
export const note = "A header's way back, named for where it goes; only the chevron in a narrow header";

export default function Triggers() {
  return <BackButton label="Triggers" onPress={() => undefined} />;
}
