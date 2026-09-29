// Catalog read endpoints over the Neo4j item graph.
import { Router } from 'express';
import { z } from 'zod';
import { getFactorCodeKit, listCategories, listItemTypes, searchItems } from '@groundwork/graph';
import { HttpError, parse } from '../http.ts';

export const itemsRouter = Router();

const searchQuery = z.object({
  q: z.string().trim().max(100).default(''),
  type: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

itemsRouter.get('/items', async (req, res) => {
  const { q, type, limit } = parse(searchQuery, req.query);
  const items = await searchItems({ q, type: type || undefined, limit });
  res.json({ count: items.length, items });
});

itemsRouter.get('/item-types', async (_req, res) => {
  res.json({ types: await listItemTypes() });
});

itemsRouter.get('/categories', async (_req, res) => {
  res.json({ categories: await listCategories() });
});

itemsRouter.get('/factor-codes/:code', async (req, res) => {
  const code = parse(z.string().trim().min(1).max(50), req.params.code);
  const rows = await getFactorCodeKit(code);
  const first = rows[0];
  if (!first) throw new HttpError(404, `Factor code "${code}" not found (or it has no items)`);
  res.json({
    code: first.code,
    description: first.description,
    laborHours: first.laborHours,
    items: rows.map(({ partNumber, itemDescription, quantity, unit, cost, salePrice, bestVendorPrice }) => ({
      partNumber,
      description: itemDescription,
      quantity,
      unit,
      cost,
      salePrice,
      bestVendorPrice,
    })),
  });
});
