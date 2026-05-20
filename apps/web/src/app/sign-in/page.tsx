import { signIn } from "@/auth";

export default function SignInPage() {
  return (
    <div className="sign-in-page">
      <div className="sign-in-card">
        <h1 className="sign-in-title">Amarnai</h1>
        <p className="sign-in-subtitle">AI email triage assistant</p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/dashboard" });
          }}
        >
          <button className="btn-google" type="submit">
            Sign in with Google
          </button>
        </form>
      </div>
    </div>
  );
}
