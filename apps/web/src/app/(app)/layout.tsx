import { SidebarLoader } from "./SidebarLoader";
import { GetExtensionBannerLoader } from "./GetExtensionBannerLoader";
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
      {/* Floats over the shell rather than sitting in it: .shell is a
          full-height flex row, and every page inside it owns its own scroll. */}
      <GetExtensionBannerLoader />
    </div>
  );
}
