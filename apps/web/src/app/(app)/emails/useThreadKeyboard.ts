"use client";

import { useEffect, useRef } from "react";

type Options = {
  threadIds: string[];
  selectedId: string | null;
  popoverOpen: boolean;
  onNavigate: (id: string) => void;
  onToggleCheck: (id: string) => void;
  onApprove: (id: string) => void;
  onReroute: () => void;
  onFocusSearch: () => void;
};

export function useThreadKeyboard({
  threadIds,
  selectedId,
  popoverOpen,
  onNavigate,
  onToggleCheck,
  onApprove,
  onReroute,
  onFocusSearch,
}: Options) {
  // Track G key for chord (G→F = new folder)
  const gPending = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // / focuses search regardless of input state
      if (e.key === "/" && !inInput) {
        e.preventDefault();
        onFocusSearch();
        return;
      }

      if (inInput || popoverOpen) return;

      const idx = selectedId ? threadIds.indexOf(selectedId) : -1;

      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        const next = threadIds[idx + 1];
        if (next) onNavigate(next);
        else if (threadIds[0]) onNavigate(threadIds[0]);
        return;
      }

      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        const prev = threadIds[idx - 1];
        if (prev) onNavigate(prev);
        else {
          const last = threadIds[threadIds.length - 1];
          if (last) onNavigate(last);
        }
        return;
      }

      if ((e.key === "x" || e.key === "X") && selectedId) {
        e.preventDefault();
        onToggleCheck(selectedId);
        return;
      }

      if ((e.key === "e" || e.key === "E") && selectedId) {
        e.preventDefault();
        onApprove(selectedId);
        return;
      }

      if ((e.key === "v" || e.key === "V") && selectedId) {
        e.preventDefault();
        onReroute();
        return;
      }

      // G chord for G→F (new folder)
      if (e.key === "g" || e.key === "G") {
        if (gPending.current) {
          // GG pressed — not used; reset
          gPending.current = false;
          if (gTimer.current) clearTimeout(gTimer.current);
          return;
        }
        gPending.current = true;
        if (gTimer.current) clearTimeout(gTimer.current);
        gTimer.current = setTimeout(() => {
          gPending.current = false;
        }, 600);
        return;
      }

      if ((e.key === "f" || e.key === "F") && gPending.current) {
        e.preventDefault();
        gPending.current = false;
        if (gTimer.current) clearTimeout(gTimer.current);
        // Dispatch custom event for EmailsClient to handle new folder
        document.dispatchEvent(new CustomEvent("emails:new-folder"));
        return;
      }
    }

    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [threadIds, selectedId, popoverOpen, onNavigate, onToggleCheck, onApprove, onReroute, onFocusSearch]);
}
