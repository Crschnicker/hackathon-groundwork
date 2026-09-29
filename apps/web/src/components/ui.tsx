// The few shared pieces every screen is built from. Keep this file small: one button, one
// notice, one status line, so the same thing looks the same wherever it appears.
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "quiet";

const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium " +
  "transition-colors duration-150 disabled:cursor-not-allowed";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-strong active:bg-brand-strong " +
    "disabled:bg-sunken disabled:text-ink-3 disabled:ring-1 disabled:ring-inset disabled:ring-line",
  secondary:
    "bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-sunken active:bg-sunken " +
    "disabled:text-ink-3 disabled:ring-line",
  quiet: "text-brand underline underline-offset-4 hover:text-brand-strong disabled:text-ink-3 disabled:no-underline",
};

export function buttonClass(variant: ButtonVariant = "primary", extra = ""): string {
  return `${buttonBase} ${buttonVariants[variant]} ${extra}`.trim();
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Work is in progress: the button keeps its colour and its place, and ignores clicks. */
  busy?: boolean;
}

export function Button({ variant = "primary", busy = false, className = "", children, onClick, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      // aria-disabled, not disabled, while busy: the button keeps keyboard focus and its colour.
      aria-disabled={busy || undefined}
      onClick={busy ? undefined : onClick}
      className={buttonClass(variant, `${busy ? "cursor-progress" : ""} ${className}`)}
    >
      {busy && <span aria-hidden className="live-dot h-2 w-2 rounded-full bg-current" />}
      {children}
    </button>
  );
}

type Tone = "danger" | "confirm" | "neutral";

const noticeTones: Record<Tone, string> = {
  danger: "border-danger-line bg-danger-soft text-danger",
  confirm: "border-confirm-line bg-confirm-soft text-confirm",
  neutral: "border-line bg-sunken text-ink-2",
};

/** A message that needs reading: a failure and what to do about it, or something to confirm. */
export function Notice({
  tone = "danger",
  title,
  children,
  action,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-sm ${noticeTones[tone]}`}
    >
      <p className="min-w-0">
        {title && <span className="font-semibold">{title} </span>}
        {children}
      </p>
      {action}
    </div>
  );
}

/**
 * Says what is happening, and is read out by screen readers when it changes. Keep it mounted
 * and change its text; a status line that appears together with its text is not announced.
 */
export function StatusLine({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <p role="status" aria-live="polite" className={`min-h-5 text-sm text-ink-2 ${className}`}>
      {children}
    </p>
  );
}

/** Heading and one line of explanation for a section of a page. */
export function SectionHeading({ id, title, children }: { id?: string; title: string; children?: ReactNode }) {
  return (
    <div className="space-y-1">
      <h2 id={id} className="text-xl font-semibold tracking-tight text-ink">
        {title}
      </h2>
      {children && <p className="max-w-[68ch] text-sm text-ink-2">{children}</p>}
    </div>
  );
}

/** "12 Sep, 3:41 PM" for today's timestamps and older ones alike. */
export function formatWhen(epochMs: number): string {
  const date = new Date(epochMs);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  return `${date.toLocaleDateString("en-US", { day: "numeric", month: "short" })}, ${time}`;
}

/** "4 min 12 s", "38 s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
