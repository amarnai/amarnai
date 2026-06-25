"use client";

import type { ReactNode } from "react";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { AuthShell } from "@/components/AuthShell";

interface Props {
  pendingCount: number;
  invitedCount: number;
  children: ReactNode;
}

export function WaitlistShell({ pendingCount, invitedCount, children }: Props) {
  const { _ } = useLingui();

  const subtitle = `${_(msg`${pendingCount} pending`)} · ${_(msg`${invitedCount} invited`)}`;

  return (
    <AuthShell title={_(msg`Waitlist`)} subtitle={subtitle}>
      {children}
    </AuthShell>
  );
}
