import { useState } from "react";
import type { StateChecks } from "@simonwjackson/caliper/checks";
import { BacklogSettingsList } from "./BacklogSettingsList";
import { catalogWith, notRoutedSource, overlapping, routedSource } from "./fixtures/backlogSources";
import type { BacklogSettingsCatalog } from "./backlogSettingsApi";

export const name = "BacklogSettingsList";
export const note = "Azure DevOps sources above the projects, each source with its destination, and a GitHub username";
export const checks = {
  default: {
    "a source names its board and where its sessions start": async ({ canvas, expect }) => {
      expect(canvas.getByText("Fabrikam Web")).toBeVisible();
      expect(canvas.getByText("→ storefront")).toBeVisible();
      expect(canvas.getByRole("button", { name: "Add Azure DevOps source" })).toBeVisible();
    },
  },
} satisfies StateChecks;

function Stateful({ catalog }: { catalog: BacklogSettingsCatalog }) {
  const [login, setLogin] = useState(catalog.settings.githubLogin ?? "");
  const [opened, setOpened] = useState<string>();
  return <BacklogSettingsList back={null} close={null} load={{ type: "ready", value: catalog }} error={opened ? `Opens ${opened}` : undefined} busy={false}
    login={login} onLogin={setLogin} onSaveLogin={() => undefined} onOpen={setOpened} onReload={() => setOpened(undefined)} />;
}
export default function RoutedSource() { return <Stateful catalog={catalogWith([routedSource])} />; }
export function NoSources() { return <Stateful catalog={catalogWith([])} />; }
export function NotRoutedSource() { return <Stateful catalog={catalogWith([routedSource, notRoutedSource])} />; }
export function OverlapWarning() { return <Stateful catalog={catalogWith(overlapping)} />; }
