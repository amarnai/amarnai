import { SidebarLoader } from "./SidebarLoader";
import { JoinedWorkspaceToast } from "@/components/JoinedWorkspaceToast";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <SidebarLoader />
      <main className="main" suppressHydrationWarning>{children}</main>
      <JoinedWorkspaceToast />
    </div>
  );
}
