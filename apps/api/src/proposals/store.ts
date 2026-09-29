// Proposals: kept in memory and mirrored to <stateDir>/proposals.json, the same way walks are,
// so a dev-server restart does not lose one that is being reviewed or waiting on the client.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.ts';
import { stateDir } from '../walks/store.ts';
import type { Proposal } from './types.ts';

const file = path.join(stateDir, 'proposals.json');
const proposals = new Map<string, Proposal>();
/** shareToken → proposal id, so the client's link is a Map lookup rather than a scan. */
const byToken = new Map<string, string>();

function load(): void {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return; // first run
  }
  try {
    for (const p of JSON.parse(raw) as Proposal[]) {
      proposals.set(p.id, p);
      byToken.set(p.shareToken, p.id);
    }
  } catch (err) {
    logger.warn({ err, file }, 'Could not read saved proposals; starting empty');
  }
}
load();

let saveTimer: NodeJS.Timeout | undefined;

/** Persist soon; bursts of updates collapse into one write. */
export function saveProposals(): void {
  saveTimer ??= setTimeout(() => {
    saveTimer = undefined;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify([...proposals.values()]));
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      logger.error({ err, file }, 'Could not save proposals');
    }
  }, 250);
}

/** Unguessable: 24 random bytes, URL-safe. */
export function newShareToken(): string {
  return randomBytes(24).toString('base64url');
}

export function addProposal(p: Proposal): Proposal {
  proposals.set(p.id, p);
  byToken.set(p.shareToken, p.id);
  saveProposals();
  return p;
}

export function getProposal(id: string): Proposal | undefined {
  return proposals.get(id);
}

export function getProposalByToken(token: string): Proposal | undefined {
  const id = byToken.get(token);
  return id === undefined ? undefined : proposals.get(id);
}

/** Newest edit first. */
export function listProposals(): Proposal[] {
  return [...proposals.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteProposal(id: string): boolean {
  const p = proposals.get(id);
  if (!p) return false;
  proposals.delete(id);
  byToken.delete(p.shareToken);
  saveProposals();
  return true;
}

/** A walk photo was deleted: take it out of every section that showed it. */
export function removePhotoFromProposals(walkId: string, photoId: string): void {
  let changed = false;
  for (const p of proposals.values()) {
    if (p.walkId !== walkId) continue;
    for (const section of p.sections) {
      const kept = section.photoIds.filter((id) => id !== photoId);
      if (kept.length !== section.photoIds.length) {
        section.photoIds = kept;
        changed = true;
      }
    }
  }
  if (changed) saveProposals();
}
