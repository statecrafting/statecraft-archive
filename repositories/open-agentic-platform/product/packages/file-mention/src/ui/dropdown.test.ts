import { describe, it, expect } from "vitest";
import {
  dropdownReducer,
  getSelection,
  initialDropdownState,
  keyToAction,
} from "./dropdown.js";
import type { FuzzyMatch } from "../types.js";

function makeMatch(name: string, score: number): FuzzyMatch {
  return {
    candidate: { type: "file", relativePath: `src/${name}`, basename: name, icon: "📄" },
    score,
    matchedRanges: [],
  };
}

const candidates: FuzzyMatch[] = [
  makeMatch("Button.tsx", 50),
  makeMatch("Banner.tsx", 40),
  makeMatch("Badge.tsx", 30),
];

describe("dropdownReducer", () => {
  it("starts with initial state", () => {
    const state = initialDropdownState();
    expect(state.visible).toBe(false);
    expect(state.highlightIndex).toBe(-1);
  });

  it("opens with candidates", () => {
    const state = dropdownReducer(initialDropdownState(), {
      type: "open",
      candidates,
    });
    expect(state.visible).toBe(true);
    expect(state.highlightIndex).toBe(0);
    expect(state.candidates).toBe(candidates);
  });

  it("closes", () => {
    const open = dropdownReducer(initialDropdownState(), {
      type: "open",
      candidates,
    });
    const closed = dropdownReducer(open, { type: "close" });
    expect(closed.visible).toBe(false);
    expect(closed.candidates).toEqual([]);
  });

  it("arrow_down moves highlight forward (FR-005)", () => {
    let state = dropdownReducer(initialDropdownState(), {
      type: "open",
      candidates,
    });
    state = dropdownReducer(state, { type: "arrow_down" });
    expect(state.highlightIndex).toBe(1);
  });

  it("arrow_down wraps to 0", () => {
    let state = dropdownReducer(initialDropdownState(), {
      type: "open",
      candidates,
    });
    state = dropdownReducer(state, { type: "arrow_down" }); // 1
    state = dropdownReducer(state, { type: "arrow_down" }); // 2
    state = dropdownReducer(state, { type: "arrow_down" }); // wraps to 0
    expect(state.highlightIndex).toBe(0);
  });

  it("arrow_up wraps to last", () => {
    const state = dropdownReducer(initialDropdownState(), {
      type: "open",
      candidates,
    });
    // highlight starts at 0, arrow_up wraps to last
    const up = dropdownReducer(state, { type: "arrow_up" });
    expect(up.highlightIndex).toBe(2);
  });

  it("arrow_up moves highlight backward", () => {
    let state = dropdownReducer(initialDropdownState(), {
      type: "open",
      candidates,
    });
    state = dropdownReducer(state, { type: "arrow_down" }); // 1
    state = dropdownReducer(state, { type: "arrow_up" }); // 0
    expect(state.highlightIndex).toBe(0);
  });

  it("update replaces candidates and clamps highlight", () => {
    let state = dropdownReducer(initialDropdownState(), {
      type: "open",
      candidates,
    });
    state = dropdownReducer(state, { type: "arrow_down" }); // 1
    state = dropdownReducer(state, { type: "arrow_down" }); // 2
    // Shrink to 2 candidates — highlight should clamp
    const fewer = candidates.slice(0, 2);
    state = dropdownReducer(state, { type: "update", candidates: fewer });
    expect(state.highlightIndex).toBe(1);
  });

  it("select_index sets highlight", () => {
    const state = dropdownReducer(initialDropdownState(), {
      type: "open",
      candidates,
    });
    const selected = dropdownReducer(state, { type: "select_index", index: 2 });
    expect(selected.highlightIndex).toBe(2);
  });

  it("select_index ignores out-of-range", () => {
    const state = dropdownReducer(initialDropdownState(), {
      type: "open",
      candidates,
    });
    const selected = dropdownReducer(state, { type: "select_index", index: 99 });
    expect(selected.highlightIndex).toBe(0);
  });

  it("arrow actions are no-op when not visible", () => {
    const state = initialDropdownState();
    expect(dropdownReducer(state, { type: "arrow_down" })).toBe(state);
    expect(dropdownReducer(state, { type: "arrow_up" })).toBe(state);
  });
});

describe("getSelection", () => {
  it("returns null when not visible", () => {
    expect(getSelection(initialDropdownState())).toBeNull();
  });

  it("returns highlighted candidate", () => {
    const state = dropdownReducer(initialDropdownState(), {
      type: "open",
      candidates,
    });
    const sel = getSelection(state);
    expect(sel).not.toBeNull();
    expect(sel!.candidate).toBe(candidates[0]!.candidate);
  });

  it("returns null when highlight is -1", () => {
    const state = { visible: true, highlightIndex: -1, candidates };
    expect(getSelection(state)).toBeNull();
  });
});

describe("keyToAction", () => {
  it("maps ArrowDown to arrow_down", () => {
    expect(keyToAction("ArrowDown", true)).toEqual({ type: "arrow_down" });
  });

  it("maps ArrowUp to arrow_up", () => {
    expect(keyToAction("ArrowUp", true)).toEqual({ type: "arrow_up" });
  });

  it("maps Enter to select", () => {
    expect(keyToAction("Enter", true)).toEqual({ type: "select" });
  });

  it("maps Tab to select", () => {
    expect(keyToAction("Tab", true)).toEqual({ type: "select" });
  });

  it("maps Escape to close", () => {
    expect(keyToAction("Escape", true)).toEqual({ type: "close" });
  });

  it("returns null for unrelated keys", () => {
    expect(keyToAction("a", true)).toBeNull();
  });

  it("returns null when dropdown not visible", () => {
    expect(keyToAction("ArrowDown", false)).toBeNull();
  });
});
