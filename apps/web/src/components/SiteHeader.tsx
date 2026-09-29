"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Walks", match: (path: string) => path === "/" || path.startsWith("/walks") },
  { href: "/proposals", label: "Proposals", match: (path: string) => path.startsWith("/proposals") },
  { href: "/catalog", label: "Catalog", match: (path: string) => path.startsWith("/catalog") },
];

/** The stepping stones from the app icon, so the phone app and this site share a face. */
export function Mark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden className={className}>
      <rect width="1024" height="1024" rx="224" fill="#1a4d33" />
      <g fill="#ece5d3">
        <ellipse cx="250" cy="800" rx="96" ry="69" />
        <ellipse cx="400" cy="640" rx="106" ry="76" />
        <ellipse cx="560" cy="500" rx="116" ry="83" />
        <ellipse cx="690" cy="340" rx="106" ry="76" />
        <ellipse cx="800" cy="200" rx="91" ry="65" />
      </g>
    </svg>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex min-h-14 items-center gap-2.5 rounded-lg text-lg font-semibold tracking-tight text-ink">
          <Mark />
          Groundwork
        </Link>
        <nav aria-label="Main">
          <ul className="flex items-center gap-1">
            {links.map((link) => {
              const current = link.match(pathname);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={current ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors duration-150 ${
                      current ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-sunken hover:text-ink"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
