import { Afterword } from "./Afterword";

export const name = "Afterword";
export const note = "Supporting content in the reply text column, its source, and one quiet work-in-progress line";
export default function Content() { return <Afterword kind="content" source="Written from the last 8 messages."><p>Implemented and tested. Deployment remains.</p></Afterword>; }
export function Working() { return <Afterword kind="working" message="Writing a summary…" />; }
export function Failed() { return <Afterword kind="failed" message="Could not write a summary. Try again." />; }
