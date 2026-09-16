/**
 * Headless dropdown controller for mention autocomplete (058 Phase 4).
 *
 * Manages keyboard navigation state (FR-005), selection, and dismissal
 * without depending on any UI framework. A React/Preact/Solid component
 * can wrap this controller.
 */

import type { FuzzyMatch, MentionCandidate } from "../types.js";

export interface DropdownState {
  /** Whether the dropdown is visible. */
  visible: boolean;
  /** Currently highlighted index (-1 = none). */
  highlightIndex: number;
  /** Current candidates to display. */
  candidates: FuzzyMatch[];
}

export type DropdownAction =
  | { type: "open"; candidates: FuzzyMatch[] }
  | { type: "update"; candidates: FuzzyMatch[] }
  | { type: "close" }
  | { type: "arrow_up" }
  | { type: "arrow_down" }
  | { type: "select" }
  | { type: "select_index"; index: number };

export interface DropdownSelection {
  candidate: MentionCandidate;
  match: FuzzyMatch;
}

/**
 * Pure reducer for dropdown state (FR-005).
 *
 * Arrow Up/Down navigates candidates.
 * Wraps around at boundaries.
 */
export function dropdownReducer(
  state: DropdownState,
  action: DropdownAction,
): DropdownState {
  switch (action.type) {
    case "open":
      return {
        visible: true,
        highlightIndex: 0,
        candidates: action.candidates,
      };

    case "update":
      return {
        ...state,
        candidates: action.candidates,
        // Reset highlight if it exceeds new candidate count
        highlightIndex:
          state.highlightIndex >= action.candidates.length
            ? Math.max(0, action.candidates.length - 1)
            : state.highlightIndex,
      };

    case "close":
      return { visible: false, highlightIndex: -1, candidates: [] };

    case "arrow_up": {
      if (!state.visible || state.candidates.length === 0) return state;
      const newIndex =
        state.highlightIndex <= 0
          ? state.candidates.length - 1
          : state.highlightIndex - 1;
      return { ...state, highlightIndex: newIndex };
    }

    case "arrow_down": {
      if (!state.visible || state.candidates.length === 0) return state;
      const newIndex =
        state.highlightIndex >= state.candidates.length - 1
          ? 0
          : state.highlightIndex + 1;
      return { ...state, highlightIndex: newIndex };
    }

    case "select":
      // No-op in state — the caller reads the current highlight
      return state;

    case "select_index":
      if (action.index >= 0 && action.index < state.candidates.length) {
        return { ...state, highlightIndex: action.index };
      }
      return state;

    default:
      return state;
  }
}

/**
 * Get the currently highlighted selection, or null if nothing is selected.
 */
export function getSelection(state: DropdownState): DropdownSelection | null {
  if (
    !state.visible ||
    state.highlightIndex < 0 ||
    state.highlightIndex >= state.candidates.length
  ) {
    return null;
  }

  const match = state.candidates[state.highlightIndex]!;
  return { candidate: match.candidate, match };
}

/**
 * Initial dropdown state.
 */
export function initialDropdownState(): DropdownState {
  return { visible: false, highlightIndex: -1, candidates: [] };
}

/**
 * Map a keyboard event key to a dropdown action, or null if unrelated.
 * FR-005: Arrow Up/Down navigates; Enter/Tab confirms; Escape closes.
 */
export function keyToAction(
  key: string,
  dropdownVisible: boolean,
): DropdownAction | null {
  if (!dropdownVisible) return null;

  switch (key) {
    case "ArrowUp":
      return { type: "arrow_up" };
    case "ArrowDown":
      return { type: "arrow_down" };
    case "Enter":
    case "Tab":
      return { type: "select" };
    case "Escape":
      return { type: "close" };
    default:
      return null;
  }
}
