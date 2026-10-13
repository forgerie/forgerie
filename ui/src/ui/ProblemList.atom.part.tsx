import { ProblemList } from "./ProblemList";

export const name = "Problem list";
export const note = "What stops a form from saving, in the danger tone";

export default function Two() {
  return <ProblemList label="Problems" problems={["Give the trigger a name.", "Choose at least one day."]} />;
}
