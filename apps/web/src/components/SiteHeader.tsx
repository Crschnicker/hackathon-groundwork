"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Walks", match: (path: string) => path === "/" || path.startsWith("/walks") },
  { href: "/proposals", label: "Proposals", match: (path: string) => path.startsWith("/proposals") },
  { href: "/catalog", label: "Catalog", match: (path: string) => path.startsWith("/catalog") },
];

/**
 * The app icon: a "G" drawn as contour lines around a cream stone, so the phone app and this
 * site share a face.
 */
export function Mark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden className={className}>
      <rect width="1024" height="1024" rx="224" fill="#1a4d33" />
      <path
        d="M742 319 A300 300 0 1 0 812 512 H706 M661 387 A194 194 0 1 0 706 512"
        fill="none"
        stroke="#ece5d3"
        strokeWidth="56"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <ellipse cx="512" cy="512" rx="94" ry="80" transform="rotate(-12 512 512)" fill="#ece5d3" />
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
