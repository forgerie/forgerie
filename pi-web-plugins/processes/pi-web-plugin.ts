import type { PiWebPlugin } from "forgerie/plugin-api";
import { defineProcessesPanelElement, processesPanelBadge } from "./processesPanelElement.js";

const plugin: PiWebPlugin = {
  apiVersion: 1,
  name: "Managed Processes",
  activate: ({ pluginId, html, svg }) => {
    defineProcessesPanelElement();

    return {
      contributions: {
        actions: [
          {
            id: "workspace.open-processes",
            title: "Open Managed Processes",
            description: "Open the managed processes panel to view and control session processes.",
            group: "Workspace",
            enabled: (context) => context.state.selectedWorkspace !== undefined,
            run: (context) => {
              if (context.state.selectedWorkspace === undefined) return;
              context.selectWorkspaceTool(`${pluginId}:workspace.processes`);
            },
          },
        ],
        workspacePanels: [
          {
            id: "workspace.processes",
            title: "Processes",
            icon: svg`
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2"></rect>
                <path d="M8 21h8"></path>
                <path d="M12 17v4"></path>
                <path d="m7 8 3 3-3 3"></path>
                <path d="M11 12h4"></path>
              </svg>
            `,
            order: 50,
            badge: (context) => processesPanelBadge(context),
            render: (context) => html`<pi-web-processes-panel .context=${context}></pi-web-processes-panel>`,
          },
        ],
      },
    };
  },
};

export default plugin;
