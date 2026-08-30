"use client";

import React from "react";

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name when the switch is not wrapped in a <label>. */
  ariaLabel?: string;
};

/**
 * The standard on/off control. Product policy: every setting with a single
 * yes/no choice renders as a switch, never a bare checkbox — checkboxes are
 * reserved for multi-select lists and explicit consent confirmations.
 *
 * Semantically an <input type="checkbox" role="switch"> so it keeps native
 * label/click/keyboard/form behavior; switch.css restyles it as a track+thumb
 * (import "@aziru/ui/switch/styles" once per app). Works inside a wrapping
 * <label> (the .settings-toggle pattern) or standalone with `ariaLabel`.
 */
export function Switch({ checked, onChange, disabled, ariaLabel }: SwitchProps) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="ui-switch"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
    />
  );
}
