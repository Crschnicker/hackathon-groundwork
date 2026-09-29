// The homeowner's side of a proposal: /p/<shareToken>. No walk token; the unguessable share
// token in the link is the key, and a draft is not reachable at all. What goes out is the
// client-facing part only: no part numbers, price sources, notes to self or open questions.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parse } from '../http.ts';
import { getWalk, stateDir, type PhotoContentType } from '../walks/store.ts';
import { getProposalByToken, saveProposals } from './store.ts';
import { lineAmount, proposalTotals, type Proposal } from './types.ts';

export const clientProposalsRouter = Router();

const EXTENSION: Record<PhotoContentType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** The proposal behind a share link, as long as it has been sent. */
function requireSent(token: string | undefined): Proposal {
  const p = token ? getProposalByToken(token) : undefined;
  if (!p || p.status === 'draft') throw new HttpError(404, 'Proposal not found');
  return p;
}

function clientView(p: Proposal) {
  const totals = proposalTotals(p);
  const photos = new Map((getWalk(p.walkId)?.photos ?? []).map((photo) => [photo.id, photo]));
  return {
    title: p.title,
    client: { name: p.client.name, address: p.client.address },
    intro: p.intro,
    status: p.status,
    sentAt: p.sentAt,
    decidedAt: p.decidedAt,
    decidedBy: p.decidedBy,
    acceptedName: p.acceptedName,
    sections: p.sections.map((s) => ({
      id: s.id,
      area: s.area,
      summary: s.summary,
      photos: s.photoIds.flatMap((id) => {
        const photo = photos.get(id);
        return photo ? [{ id, caption: photo.caption }] : [];
      }),
      lines: s.lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        amount: lineAmount(l),
      })),
      subtotal: totals.sections[s.id] ?? 0,
    })),
    totals: { subtotal: totals.subtotal, tax: totals.tax, total: totals.total },
    taxRate: p.taxRate,
    terms: p.terms,
  };
}

clientProposalsRouter.get('/p/:token', (req, res) => {
  res.json(clientView(requireSent(req.params.token)));
});

/** A photo the proposal shows. Anything else of the walk's stays private. */
clientProposalsRouter.get('/p/:token/photos/:photoId', async (req, res) => {
  const p = requireSent(req.params.token);
  const photoId = req.params.photoId;
  const photo = p.sections.some((s) => s.photoIds.includes(photoId))
    ? getWalk(p.walkId)?.photos?.find((ph) => ph.id === photoId)
    : undefined;
  if (!photo) throw new HttpError(404, 'Photo not found');
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(stateDir, 'photos', p.walkId, `${photo.id}.${EXTENSION[photo.contentType]}`));
  } catch {
    throw new HttpError(404, 'Photo not found');
  }
  res.set('Content-Type', photo.contentType);
  // Short: the link stops showing photos once the proposal goes back to draft.
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(bytes);
});

/** The client accepts: only a proposal that is still open, and it becomes won. */
clientProposalsRouter.post('/p/:token/accept', (req, res) => {
  const p = requireSent(req.params.token);
  const { name } = parse(z.object({ name: z.string().trim().min(1).max(120) }), req.body);
  if (p.status === 'won') throw new HttpError(409, 'This proposal has already been accepted.');
  if (p.status !== 'pending') throw new HttpError(409, 'This proposal is no longer open.');
  const now = Date.now();
  p.status = 'won';
  p.decidedAt = now;
  p.decidedBy = 'client';
  p.acceptedName = name;
  p.updatedAt = now;
  saveProposals();
  res.json(clientView(p));
});
