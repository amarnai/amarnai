import { SidebarLoader } from "./SidebarLoader";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <SidebarLoader />
      <main className="main" suppressHydrationWarning>{children}</main>
    </div>
  );
}
