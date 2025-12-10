import { SignIn } from "@clerk/clerk-react";

export function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl">
        <h1 className="mb-4 text-center text-xl font-semibold text-slate-50">
          Prihlášení obchodníka
        </h1>
        <SignIn
          appearance={{
            elements: {
              card: "bg-transparent shadow-none border-0",
            },
          }}
        />
      </div>
    </div>
  );
}
