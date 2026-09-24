// Small accessibility helpers shared by client components.

import type { KeyboardEvent } from "react";

const RADIO_KEYS = new Set(["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]);

/**
 * Keyboard handling for a custom radiogroup (a role="radiogroup" container of
 * role="radio" buttons), per the WAI-ARIA radio group pattern: Arrow keys move
 * focus to the next / previous enabled radio (wrapping) and SELECT it; Home /
 * End jump to the first / last. Pair it with a roving tabindex — tabIndex 0 on
 * the checked radio (or the first, when none is), -1 on the rest — so the group
 * is a single Tab stop. Attach as the container's onKeyDown.
 */
export function onRadioGroupKeyDown(e: KeyboardEvent<HTMLElement>): void {
  if (!RADIO_KEYS.has(e.key)) return;
  const radios = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled):not([aria-disabled="true"])')
  );
  if (radios.length === 0) return;
  const cur = radios.indexOf(document.activeElement as HTMLElement);
  const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? radios.length - 1
        : (Math.max(cur, 0) + (forward ? 1 : -1) + radios.length) % radios.length;
  e.preventDefault();
  radios[next].focus();
  // Selection follows focus, as the pattern specifies.
  radios[next].click();
}

/**
 * The roving tabIndex for one radio: 0 for the checked one, or for the first
 * when nothing is checked (so the group can still be reached with Tab); -1 else.
 */
export function radioTabIndex(checked: boolean, index: number, anyChecked: boolean): 0 | -1 {
  return checked || (!anyChecked && index === 0) ? 0 : -1;
}
