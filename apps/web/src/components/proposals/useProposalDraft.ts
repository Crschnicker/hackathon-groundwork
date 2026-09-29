"use client";

// The proposal being reviewed, held in the browser and saved by itself a moment after each edit.
// Every edit bumps a revision number; a save records the revision it carried. The server's answer
// never replaces what is being typed: text the architect is still writing stays as it is on screen,
// and only the record-keeping fields (status, dates, the walk's photos) are taken from it.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type Proposal, type ProposalEdit } from "@/lib/api";

const SAVE_AFTER_MS = 800;
/** Waits between attempts while the server cannot be reached; the last one repeats. */
const RETRY_MS = [2_000, 5_000, 15_000, 30_000];

export type SaveState =
  | { kind: "saved" }
  | { kind: "waiting" }
  | { kind: "saving" }
  | { kind: "retrying" }
  /** The proposal cannot be saved as it is; the message says what to fix. */
  | { kind: "invalid"; message: string }
  /** The server refused it; the next edit tries again. */
  | { kind: "rejected"; message: string }
  | { kind: "token" };

/** What the server keeps track of; the rest of Proposal is the architect's to edit. */
export type ProposalRecord = Omit<Proposal, keyof ProposalEdit>;

export function toEdit(p: ProposalEdit): ProposalEdit {
  return {
    title: p.title,
    client: { ...p.client },
    intro: p.intro,
    sections: p.sections,
    taxRate: p.taxRate,
    terms: p.terms,
    openQuestions: p.openQuestions,
  };
}

export function toRecord(p: Proposal): ProposalRecord {
  return {
    id: p.id,
    walkId: p.walkId,
    status: p.status,
    shareToken: p.shareToken,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    sentAt: p.sentAt,
    decidedAt: p.decidedAt,
    decidedBy: p.decidedBy,
    acceptedName: p.acceptedName,
    generatedBy: p.generatedBy,
    totals: p.totals,
    photos: p.photos,
  };
}

/** Why the proposal cannot be saved as it stands, in words for the architect; "" when it can. */
export function problemWith(edit: ProposalEdit): string {
  if (!edit.title.trim()) return "Give the proposal a title.";
  for (const section of edit.sections) {
    if (section.lines.some((line) => !line.description.trim())) return `A line in ${section.area} has no description.`;
  }
  return "";
}

export function useProposalDraft(initial: Proposal) {
  const id = initial.id;
  const [edit, setEdit] = useState<ProposalEdit>(() => toEdit(initial));
  const [record, setRecord] = useState<ProposalRecord>(() => toRecord(initial));
  const [save, setSave] = useState<SaveState>({ kind: "saved" });

  const latest = useRef(edit);
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const failures = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Saves run one after another, so an older one can never land after a newer one.
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const closed = useRef(false);

  /** One save of whatever is newest. "retry" when it is worth trying the same again later. */
  const saveOnce = useCallback(async (): Promise<"ok" | "retry" | "stop"> => {
    if (closed.current) return "ok";
    if (revision.current === savedRevision.current) return "ok";
    const at = revision.current;
    const body = latest.current;
    const problem = problemWith(body);
    if (problem) {
      setSave({ kind: "invalid", message: problem });
      return "stop";
    }
    setSave({ kind: "saving" });
    try {
      const saved = await api.saveProposal(id, body);
      failures.current = 0;
      savedRevision.current = Math.max(savedRevision.current, at);
      setRecord((r) => ({ ...r, updatedAt: saved.updatedAt, photos: saved.photos }));
      setSave(revision.current === savedRevision.current ? { kind: "saved" } : { kind: "waiting" });
      return "ok";
    } catch (err) {
      if (closed.current) return "stop";
      if (err instanceof ApiError && err.needsToken) {
        setSave({ kind: "token" });
        return "stop";
      }
      const retryable =
        !(err instanceof ApiError) || err.unreachable || err.status >= 500 || err.status === 408 || err.status === 429;
      if (!retryable) {
        setSave({ kind: "rejected", message: err.message });
        return "stop";
      }
      setSave({ kind: "retrying" });
      return "retry";
    }
  }, [id]);

  /** Save now, after any save already under way. Resolves true once the newest edit is saved. */
  const saveNow = useCallback((): Promise<boolean> => {
    function run(): Promise<boolean> {
      clearTimeout(debounce.current);
      clearTimeout(retry.current);
      const next = queue.current.then(saveOnce, saveOnce).then((result) => {
        if (result === "retry") {
          const wait = RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)];
          failures.current++;
          clearTimeout(retry.current);
          retry.current = setTimeout(() => void run(), wait);
        }
        return result === "ok";
      });
      queue.current = next;
      return next;
    }
    return run();
  }, [saveOnce]);

  /** Apply an edit; it is saved once the architect pauses. */
  const change = useCallback(
    (update: (edit: ProposalEdit) => ProposalEdit) => {
      const next = update(latest.current);
      latest.current = next;
      revision.current++;
      setEdit(next);
      setSave({ kind: "waiting" });
      clearTimeout(debounce.current);
      debounce.current = setTimeout(() => void saveNow(), SAVE_AFTER_MS);
    },
    [saveNow],
  );

  /** Save any edits now. Resolves true once everything on screen is on the server. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (revision.current === savedRevision.current) {
      await queue.current;
      return true;
    }
    return saveNow();
  }, [saveNow]);

  /** Stop saving: the proposal is being deleted. */
  const close = useCallback(() => {
    closed.current = true;
    clearTimeout(debounce.current);
    clearTimeout(retry.current);
  }, []);

  // Leaving with edits that have not reached the server asks first.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (closed.current || revision.current === savedRevision.current) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(
    () => () => {
      clearTimeout(debounce.current);
      clearTimeout(retry.current);
    },
    [],
  );

  return { edit, change, record, setRecord, save, saveNow, flush, close };
}

/** The words for the save status line. */
export function saveWords(save: SaveState): string {
  switch (save.kind) {
    case "saved":
      return "Saved.";
    case "waiting":
      return "Changes not saved yet.";
    case "saving":
      return "Saving…";
    case "retrying":
      return "Could not save. Retrying.";
    case "invalid":
      return `Not saved. ${save.message}`;
    case "rejected":
      return `Not saved. ${save.message}`;
    case "token":
      return "Not saved. The server wants the walk token again.";
  }
}
