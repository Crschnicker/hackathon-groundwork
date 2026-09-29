"use client";

// Asks for the walk token when the server wants one. Shown in place of the walk list and in
// place of a walk, so the question reads the same wherever it is asked.
import { useId, useRef, useState, type FormEvent } from "react";
import { ApiError, getWalkToken, setWalkToken } from "@/lib/api";
import { Button } from "@/components/ui";

const WRONG = "That is not the token this server expects. Check it against the phone app and try again.";

export function WalkTokenForm({
  verify,
  onAccepted,
}: {
  /** Asks the server for what this screen shows, with the token just saved. Rejects as the API does. */
  verify: () => Promise<unknown>;
  /** The server took the token, or could not be asked; the screen loads again by itself. */
  onAccepted: () => void;
}) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  // A token that was already saved and still got refused is a wrong token, so say so from the start.
  const [problem, setProblem] = useState(() =>
    getWalkToken() ? "The token saved in this browser is not the one this server expects. Type the current one." : "",
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!token.trim()) {
      setProblem("Type the token first.");
      field.current?.focus();
      return;
    }
    setBusy(true);
    setProblem("");
    setWalkToken(token);
    try {
      await verify();
      onAccepted();
    } catch (err) {
      if (err instanceof ApiError && err.needsToken) {
        setProblem(WRONG);
        field.current?.focus();
        field.current?.select();
      } else {
        // Anything else is not about the token: the screen it belongs to deals with it.
        onAccepted();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="settle max-w-xl space-y-4 rounded-lg border border-line bg-surface px-4 py-5 sm:px-6"
    >
      <p className="text-sm text-ink-2">
        This server asks for the walk token before it shows recordings. It is the same token that is typed into the
        phone app.
      </p>
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          Walk token
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            ref={field}
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-problem`}
            className="control flex-1"
          />
          <Button type="submit" busy={busy} className="shrink-0">
            {busy ? "Checking" : "Save"}
          </Button>
        </div>
        <p id={`${id}-problem`} role="alert" className="min-h-5 text-sm text-danger">
          {problem}
        </p>
      </div>
    </form>
  );
}
