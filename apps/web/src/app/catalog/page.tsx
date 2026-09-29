import type { Metadata } from "next";
import { Catalog } from "@/components/Catalog";

export const metadata: Metadata = { title: "Catalog" };

export default function CatalogPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Catalog</h1>
        <p className="max-w-[62ch] text-lg text-ink-2">
          Plants, irrigation, drainage and materials, with what each costs. An item with a kit brings its
          installation materials and labor with it; open the kit to see what it adds to a quote.
        </p>
      </header>
      <Catalog />
    </div>
  );
}
