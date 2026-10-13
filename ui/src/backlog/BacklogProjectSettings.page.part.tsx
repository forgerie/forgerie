import { BacklogProjectSettings } from "./BacklogProjectSettings";
export const name = "BacklogProjectSettings";
export const note = "One project's backlog sources";
export default function Ready() { return <BacklogProjectSettings entry={{ projectId: "p", source: "default", backlog: { providers: ["markdown"] } }} name="Project" back={null} close={null} busy={false} error={undefined} valid providers={["markdown"]} onSources={() => {}} org="" onOrg={() => {}} project="" onProject={() => {}} area="" onArea={() => {}} repo="" onRepo={() => {}} trusted onTrusted={() => {}} onSave={() => {}} onRemove={() => {}} onReload={() => {}} />; }
