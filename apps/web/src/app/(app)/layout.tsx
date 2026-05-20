import { auth } from "@/auth";
import { Sidebar } from "@/components/Sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user
    ? { email: session.user.email ?? "", name: session.user.name ?? null }
    : null;

  return (
    <div className="shell">
      <Sidebar user={user} />
      <main className="main">{children}</main>
    </div>
  );
}
