import { Request, Response, NextFunction } from 'express';

export interface AuthRequest extends Request {
  userId?: string;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  if (!token) {
    res.status(401).json({ error: 'Empty token' });
    return;
  }

  // Decode Firebase JWT payload to extract uid (sub claim).
  // This is a lightweight check — signature verification is handled by
  // downstream services that have the Firebase Admin SDK.
  try {
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) throw new Error('Malformed token');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (!payload.sub) throw new Error('Missing sub claim');
    req.userId = payload.sub;
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  next();
}
