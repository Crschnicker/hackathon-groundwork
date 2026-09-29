// Proposal endpoints for the architect: draft one from a walk, review and edit it, mark it sent
// (pending), won or lost. Behind the same shared walk token as the walks they are made from.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError, parse } from '../http.ts';
import { requireWalkToken } from '../routes/walks.ts';
import { getWalk } from '../walks/store.ts';
import { generateProposal } from './generate.ts';
import { addProposal, deleteProposal, getProposal, listProposals, saveProposals } from './store.ts';
import { proposalEditSchema, proposalStatus, proposalTotals, type Proposal } from './types.ts';

export const proposalsRouter = Router();
proposalsRouter.use('/proposals', requireWalkToken);

function requireProposal(id: string | undefined): Proposal {
  const p = id ? getProposal(id) : undefined;
  if (!p) throw new HttpError(404, 'Proposal not found');
  return p;
}

/** The stored proposal plus its totals and the walk's photos, oldest first. */
function proposalView(p: Proposal) {
  const photos = [...(getWalk(p.walkId)?.photos ?? [])].sort((a, b) => a.takenAt - b.takenAt);
  return { ...p, totals: proposalTotals(p), photos };
}

/** Drafting runs call A, the catalog and call B in turn, so this can take a minute or two. */
proposalsRouter.post('/walks/:id/proposals', requireWalkToken, async (req, res) => {
  const walk = getWalk(String(req.params.id));
  if (!walk) throw new HttpError(404, 'Walk not found');
  if (!walk.siteModel) throw new HttpError(409, 'The walk has no site model yet');
  const proposal = addProposal(await generateProposal(walk));
  res.status(201).json(proposalView(proposal));
});

proposalsRouter.get('/proposals', (_req, res) => {
  res.json(
    listProposals().map((p) => ({
      id: p.id,
      walkId: p.walkId,
      title: p.title,
      clientName: p.client.name,
      status: p.status,
      total: proposalTotals(p).total,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      sentAt: p.sentAt,
      decidedAt: p.decidedAt,
    })),
  );
});

proposalsRouter.get('/proposals/:id', (req, res) => {
  res.json(proposalView(requireProposal(req.params.id)));
});

/** The review screen saves the whole editable part at once. Photos must be the walk's own. */
proposalsRouter.put('/proposals/:id', (req, res) => {
  const p = requireProposal(req.params.id);
  const edit = parse(proposalEditSchema, req.body);
  const walkPhotoIds = new Set((getWalk(p.walkId)?.photos ?? []).map((photo) => photo.id));
  for (const section of edit.sections) {
    section.photoIds = [...new Set(section.photoIds)].filter((id) => walkPhotoIds.has(id));
  }
  // Ids must be unique for the totals and the client page; a clash gets a fresh one.
  const seen = new Set<string>();
  for (const item of edit.sections.flatMap((s) => [s, ...s.lines])) {
    if (seen.has(item.id)) item.id = randomUUID();
    seen.add(item.id);
  }
  Object.assign(p, edit, { updatedAt: Date.now() });
  saveProposals();
  res.json(proposalView(p));
});

/**
 * Any status can follow any other. Pending records when it was first sent; won and lost record
 * when and by whom; going back to draft or pending clears the decision but keeps sentAt.
 */
proposalsRouter.post('/proposals/:id/status', (req, res) => {
  const p = requireProposal(req.params.id);
  const { status } = parse(z.object({ status: proposalStatus }), req.body);
  const now = Date.now();
  if (status === 'pending' || status === 'draft') {
    if (status === 'pending') p.sentAt ??= now;
    p.decidedAt = null;
    p.decidedBy = null;
    p.acceptedName = null;
  } else if (!(status === 'won' && p.status === 'won' && p.decidedBy === 'client')) {
    // Re-marking a client-accepted proposal as won keeps the client's acceptance on record.
    p.decidedAt = now;
    p.decidedBy = 'architect';
    p.acceptedName = null;
  }
  p.status = status;
  p.updatedAt = now;
  saveProposals();
  res.json(proposalView(p));
});

proposalsRouter.delete('/proposals/:id', (req, res) => {
  requireProposal(req.params.id);
  deleteProposal(req.params.id);
  res.json({ deleted: true });
});
