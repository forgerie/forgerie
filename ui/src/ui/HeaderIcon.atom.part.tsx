import { XIcon } from "lucide-react";
import { HeaderIcon } from "./HeaderIcon";

export const name = "Header icon";
export const note = "An icon-only header control with a control-sized target";

export default function Close() {
  return <HeaderIcon label="Close triggers" icon={<XIcon aria-hidden />} onPress={() => undefined} />;
}
