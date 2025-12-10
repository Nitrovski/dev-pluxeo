import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";

export function CardsPage() {
  // tady pozdeji napojíme GET /api/cards
  const mockCards = [
    {
      id: "demo1",
      headline: "Káva zdarma po 10 razítkách",
      subheadline: "Pluxeo test kavárna",
      themeColor: "#FF9900",
    },
  ];

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Moje karty</h1>
          <p className="text-sm text-slate-400">
            Vytvárej a spravuj vernostní karty pro své zákazníky.
          </p>
        </div>
        <Button size="sm">Vytvorit kartu</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {mockCards.map((card) => (
          <Card key={card.id}>
            <CardHeader>
              <CardTitle>{card.headline}</CardTitle>
              <CardDescription>{card.subheadline}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-400">
                ID karty: <span className="font-mono">{card.id}</span>
              </p>
            </CardContent>
            <CardFooter>
              <Button variant="outline" size="sm">
                QR kód
              </Button>
              <Button variant="ghost" size="sm">
                Detail
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
