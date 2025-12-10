import { Link, NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/dashboard" className="text-lg font-semibold">
            Pluxeo Merchant
          </Link>
          <nav className="flex gap-3 text-sm">
            <NavLink
              to="/dashboard"
              className={({ isActive }) =>
                isActive ? "text-slate-50" : "text-slate-400 hover:text-slate-100"
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/cards"
              className={({ isActive }) =>
                isActive ? "text-slate-50" : "text-slate-400 hover:text-slate-100"
              }
            >
              Moje karty
            </NavLink>
          </nav>

          <Button asChild variant="outline" size="sm">
            <Link to="/account">Muj úcet</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
