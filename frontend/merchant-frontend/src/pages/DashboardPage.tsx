import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export function DashboardPage() {
  return (
    <AppShell>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Moje karty</CardTitle>
            <CardDescription>Spravujte vernostní karty pro své zákazníky.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-300">
              Tady brzy uvidíš souhrn: pocet aktivních karet, pocet razítek, poslední scany…
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Scan mód</CardTitle>
            <CardDescription>
              Pripravíme nástroj pro rychlé pridání razítek pres kameru nebo ctecku.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </AppShell>
  );
}
