import type { Response } from "express";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function pathParam(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  return Array.isArray(raw) ? raw[0] : raw;
}

export function campYearIdFromParams(
  raw: string | string[] | undefined,
  res: Response,
): string | undefined {
  const id = pathParam(raw);
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid camp year id" });
    return undefined;
  }
  return id;
}
