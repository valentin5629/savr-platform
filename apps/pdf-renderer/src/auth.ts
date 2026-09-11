import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Compare le header X-Internal-Token au secret en temps constant.
 *
 * `timingSafeEqual` exige deux Buffers de même longueur : on compare donc les
 * condensés SHA-256 (32 octets chacun) plutôt que les jetons bruts — la durée ne
 * dépend ni du contenu ni de la longueur du jeton fourni.
 * Header absent, vide ou multi-valué (tableau) = refus.
 */
export function tokenMatches(
  provided: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Middleware d'auth interne. Fail-closed : secret absent/vide = tout refuser.
 * `/health` est la seule route exemptée (sonde Railway).
 */
export function requireInternalToken(
  secret: string | undefined,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health') return next();
    if (!secret || !tokenMatches(req.headers['x-internal-token'], secret)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}
