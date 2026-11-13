/** Small helpers shared by the API routes. */
import type { ZodType } from "zod";

export function apiError(status: number, error: string, details?: unknown) {
  return Response.json({ error, ...(details === undefined ? {} : { details }) }, { status });
}

/** Parses the JSON body with a zod schema. Returns [data, null] or [null, errorResponse]. */
export async function readBody<T>(req: Request, schema: ZodType<T>): Promise<[T, null] | [null, Response]> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return [null, apiError(400, "body must be JSON")];
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return [null, apiError(400, "request does not match the contract", parsed.error.issues)];
  return [parsed.data, null];
}
