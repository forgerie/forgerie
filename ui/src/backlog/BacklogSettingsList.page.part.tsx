import { BacklogSettingsList } from "./BacklogSettingsList";
export const name = "BacklogSettingsList";
export const note = "Project sources and a GitHub username";
export default function Ready() { return <BacklogSettingsList back={null} close={null} load={{ type: "ready", value: { settings: { sources: [], projects: [{ projectId: "p", source: "default", backlog: { providers: ["markdown"] } }] }, projects: [{ id: "p", name: "Project", path: "/repo" }] } }} error={undefined} busy={false} login="octocat" onLogin={() => {}} onSaveLogin={() => {}} onOpen={() => {}} onReload={() => {}} />; }
