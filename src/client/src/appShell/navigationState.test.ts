import type { ReactiveControllerHost } from "lit";
import { describe, expect, it, vi } from "vitest";
import { defaultNavigationSection, expandNavigationSection, expandedNavigationSection, isNavigationSectionCollapsed, NavigationSectionsController, nextNavigationSection, toggleCollapsedNavigationSection, toggleNavigationSection } from "./navigationState";

describe("navigationState", () => {
  it("defaults to the first incomplete selection section", () => {
    expect(defaultNavigationSection({ selectedProject: undefined, selectedWorkspace: undefined })).toBe("projects");
    expect(defaultNavigationSection({ selectedProject: {}, selectedWorkspace: undefined })).toBe("workspaces");
    expect(defaultNavigationSection({ selectedProject: {}, selectedWorkspace: {} })).toBe("sessions");
  });

  it("expands the default section until the user explicitly toggles a section", () => {
    const state = { selectedProject: {}, selectedWorkspace: undefined };

    expect(expandedNavigationSection(undefined, state)).toBe("workspaces");
    expect(expandedNavigationSection("sessions", state)).toBe("sessions");
    expect(expandedNavigationSection("none", state)).toBeUndefined();
  });

  it("uses the mobile accordion state on mobile layouts", () => {
    const state = { selectedProject: {}, selectedWorkspace: {} };

    expect(isNavigationSectionCollapsed("projects", { isMobileLayout: true, expanded: "sessions", state })).toBe(true);
    expect(isNavigationSectionCollapsed("sessions", { isMobileLayout: true, expanded: "sessions", state })).toBe(false);
  });

  it("uses independent collapsed sections on desktop layouts", () => {
    const state = { selectedProject: {}, selectedWorkspace: {} };

    expect(isNavigationSectionCollapsed("projects", { isMobileLayout: false, expanded: "sessions", state })).toBe(false);
    expect(isNavigationSectionCollapsed("projects", { isMobileLayout: false, expanded: "sessions", state, collapsedSections: ["projects"] })).toBe(true);
    expect(isNavigationSectionCollapsed("sessions", { isMobileLayout: false, expanded: "sessions", state, collapsedSections: ["projects"] })).toBe(false);
  });

  it("toggles the effective mobile section, including the implicit default section", () => {
    const state = { selectedProject: undefined, selectedWorkspace: undefined };

    expect(toggleNavigationSection(undefined, "projects", { isMobileLayout: true, state })).toBe("none");
    expect(toggleNavigationSection("none", "projects", { isMobileLayout: true, state })).toBe("projects");
    expect(toggleNavigationSection("projects", "workspaces", { isMobileLayout: true, state })).toBe("workspaces");
  });

  it("does not mutate expanded section on desktop layouts", () => {
    const state = { selectedProject: undefined, selectedWorkspace: undefined };

    expect(toggleNavigationSection("projects", "projects", { isMobileLayout: false, state })).toBe("projects");
  });

  it("toggles desktop sections independently", () => {
    expect(toggleCollapsedNavigationSection([], "projects")).toEqual(["projects"]);
    expect(toggleCollapsedNavigationSection(["machines", "projects"], "projects")).toEqual(["machines"]);
    expect(toggleCollapsedNavigationSection(["sessions"], "machines")).toEqual(["machines", "sessions"]);
  });

  it("expands and advances through the fixed section order", () => {
    expect(expandNavigationSection("projects", "sessions", true)).toBe("sessions");
    expect(expandNavigationSection("projects", "sessions", false)).toBe("projects");
    expect(nextNavigationSection("machines")).toBe("projects");
    expect(nextNavigationSection("sessions")).toBeUndefined();
  });

  it("coordinates mobile expansion and navigation opening", () => {
    const { host, requestUpdate } = reactiveHost();
    const openNavigationView = vi.fn();
    const controller = new NavigationSectionsController(
      host,
      () => ({ selectedProject: {}, selectedWorkspace: undefined }),
      () => true,
    );

    expect(controller.expandedSection()).toBe("workspaces");
    expect(controller.isCollapsed("projects")).toBe(true);

    controller.toggle("workspaces");
    expect(controller.expandedSection()).toBeUndefined();
    controller.advanceAfterSelection("projects");
    expect(controller.expandedSection()).toBe("workspaces");
    controller.open("sessions", openNavigationView);
    controller.open("sessions", openNavigationView);

    expect(controller.expandedSection()).toBe("sessions");
    expect(openNavigationView).toHaveBeenCalledTimes(2);
    expect(requestUpdate).toHaveBeenCalledTimes(3);
  });

  it("coordinates independent desktop sections without duplicate updates", () => {
    const { host, requestUpdate } = reactiveHost();
    const controller = new NavigationSectionsController(
      host,
      () => ({ selectedProject: {}, selectedWorkspace: {} }),
      () => false,
    );

    controller.toggle("projects");
    expect(controller.isCollapsed("projects")).toBe(true);
    controller.expand("sessions");
    controller.toggle("projects");
    expect(controller.isCollapsed("projects")).toBe(false);
    controller.expand("projects");
    controller.advanceAfterSelection("projects");
    controller.open("sessions", vi.fn());

    expect(requestUpdate).toHaveBeenCalledTimes(2);
  });
});

function reactiveHost(): { host: ReactiveControllerHost; requestUpdate: ReturnType<typeof vi.fn<() => void>> } {
  const requestUpdate = vi.fn<() => void>();
  return {
    host: {
      addController: vi.fn(),
      removeController: vi.fn(),
      requestUpdate,
      updateComplete: Promise.resolve(true),
    },
    requestUpdate,
  };
}
