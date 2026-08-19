// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { activateSelectableRow, focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("selectable row activation", () => {
  it("activates rows from non-interactive click targets", () => {
    const action = vi.fn();
    activateSelectableRow(eventWithPath(matchTarget(() => false)), action);
    expect(action).toHaveBeenCalledOnce();
  });

  it("preserves contributed links inside rows", () => {
    const action = vi.fn();
    activateSelectableRow(eventWithPath(matchTarget((selector: string) => selector.includes("a[href]"))), action);
    expect(action).not.toHaveBeenCalled();
  });

  it("activates rows from Enter and Space", () => {
    const enterAction = vi.fn();
    const spaceAction = vi.fn();
    const enter = keyboardEventWithPath("Enter", matchTarget(() => false));
    const space = keyboardEventWithPath(" ", matchTarget(() => false));

    expect(handleSelectableRowKeyboard(enter, { activate: enterAction })).toBe(true);
    expect(handleSelectableRowKeyboard(space, { activate: spaceAction })).toBe(true);

    expect(enterAction).toHaveBeenCalledOnce();
    expect(spaceAction).toHaveBeenCalledOnce();
    expect(enter.preventDefault).toHaveBeenCalledOnce();
    expect(space.preventDefault).toHaveBeenCalledOnce();
  });

  it("does not activate rows from keyboard events inside interactive elements", () => {
    const action = vi.fn();
    const event = keyboardEventWithPath("Enter", matchTarget((selector: string) => selector.includes("button")));

    expect(handleSelectableRowKeyboard(event, { activate: action })).toBe(false);

    expect(action).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("routes row keyboard navigation to adjacent section callbacks", () => {
    const nextSection = vi.fn();
    const event = keyboardEventWithPath("ArrowRight", matchTarget(() => false));

    expect(handleSelectableRowKeyboard(event, { activate: vi.fn(), nextSection })).toBe(true);

    expect(nextSection).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("routes Escape row keyboard navigation to cancel", () => {
    const cancel = vi.fn();
    const event = keyboardEventWithPath("Escape", matchTarget(() => false));

    expect(handleSelectableRowKeyboard(event, { activate: vi.fn(), cancel })).toBe(true);

    expect(cancel).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("moves focus between rows and to the list endpoints", () => {
    vi.stubGlobal("Document", document.constructor);
    const root = document.createElement("div");
    const firstFocus = vi.fn();
    const secondFocus = vi.fn();
    const thirdFocus = vi.fn();
    const first = row("one", firstFocus);
    const second = row("two", secondFocus);
    const third = row("three", thirdFocus);
    root.append(first, second, third);
    document.body.append(root);

    expect(handleSelectableRowKeyboard(domKeyboardEvent("ArrowDown", first), { activate: vi.fn() })).toBe(true);
    expect(secondFocus).toHaveBeenCalledOnce();
    expect(handleSelectableRowKeyboard(domKeyboardEvent("End", second), { activate: vi.fn() })).toBe(true);
    expect(thirdFocus).toHaveBeenCalledOnce();
    expect(handleSelectableRowKeyboard(domKeyboardEvent("Home", third), { activate: vi.fn() })).toBe(true);
    expect(firstFocus).toHaveBeenCalledOnce();
    expect(handleSelectableRowKeyboard(domKeyboardEvent("ArrowUp", first), { activate: vi.fn() })).toBe(true);
    expect(firstFocus).toHaveBeenCalledTimes(2);
  });

  it("focuses the selected, first, or fallback row", () => {
    const root = document.createElement("div");
    const firstFocus = vi.fn();
    const selectedFocus = vi.fn();
    const fallbackFocus = vi.fn();
    const first = row("first", firstFocus);
    const selected = row("selected", selectedFocus);
    selected.classList.add("selected");
    const fallback = document.createElement("button");
    fallback.className = "fallback";
    fallback.focus = fallbackFocus;
    fallback.scrollIntoView = vi.fn();
    root.append(first, selected, fallback);
    document.body.append(root);

    expect(focusSelectedOrFirstSelectableRow(root, { fallbackSelector: ".fallback" })).toBe(true);
    expect(selectedFocus).toHaveBeenCalledOnce();

    selected.remove();
    expect(focusSelectedOrFirstSelectableRow(root)).toBe(true);
    expect(firstFocus).toHaveBeenCalledOnce();

    first.remove();
    expect(focusSelectedOrFirstSelectableRow(root, { fallbackSelector: ".fallback" })).toBe(true);
    expect(fallbackFocus).toHaveBeenCalledOnce();

    fallback.remove();
    expect(focusSelectedOrFirstSelectableRow(root)).toBe(false);
  });

  it("ignores unhandled keys and targets outside selectable rows", () => {
    const target = document.createElement("div");
    expect(handleSelectableRowKeyboard(domKeyboardEvent("PageDown", target), { activate: vi.fn() })).toBe(false);
    expect(handleSelectableRowKeyboard(domKeyboardEvent("ArrowDown", target), { activate: vi.fn() })).toBe(true);
  });
});

type EventWithPath = Pick<Event, "composedPath">;
type KeyboardEventWithPath = EventWithPath & Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation">;
type MatchTarget = EventTarget & { matches: (selector: string) => boolean };
type MatchPredicate = (selector: string) => boolean;

function matchTarget(matches: MatchPredicate): MatchTarget {
  return Object.assign(new EventTarget(), { matches });
}

function eventWithPath(target: MatchTarget): EventWithPath {
  return { composedPath: () => [target] };
}

function keyboardEventWithPath(key: string, target: MatchTarget): KeyboardEventWithPath {
  return { key, preventDefault: vi.fn<() => void>(), stopPropagation: vi.fn<() => void>(), composedPath: () => [target] };
}

function row(label: string, focus = vi.fn()): HTMLElement {
  const element = document.createElement("div");
  element.className = "action-row";
  element.tabIndex = 0;
  element.textContent = label;
  element.focus = focus;
  element.scrollIntoView = vi.fn();
  return element;
}

function domKeyboardEvent(key: string, currentTarget: HTMLElement) {
  return {
    key,
    currentTarget,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    composedPath: () => [currentTarget],
  };
}
