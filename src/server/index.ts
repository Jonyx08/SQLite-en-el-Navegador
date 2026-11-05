import express, { type ErrorRequestHandler, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { createHash, randomBytes, scrypt as callbackScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { database } from './database.ts';

declare global {
  namespace Express {
    interface Request {
      accountId?: number;
    }
  }
}

const scrypt = promisify(callbackScrypt);
const app = express();
const PORT = Number(process.env.PORT || 3001);
const SESSION_COOKIE = 'sqlite_browser_session';
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;
const isProduction = process.env.NODE_ENV === 'production';

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface AccountRow {
  id: number;
  name: string;
  email: string;
  password_salt?: string;
  password_hash?: string;
}

interface UserRow {
  id: number;
  name: string;
  email: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function getSessionToken(request: Request): string | null {
  const cookie = request.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1));
  } catch {
    return null;
  }
}

function setSessionCookie(response: express.Response, token: string): void {
  const secure = isProduction ? '; Secure' : '';
  response.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION / 1000}${secure}`);
}

function clearSessionCookie(response: express.Response): void {
  const secure = isProduction ? '; Secure' : '';
  response.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function requireSameOriginMutation(request: Request, response: express.Response, next: express.NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    next();
    return;
  }
  const origin = request.get('Origin');
  const expectedOrigin = `${request.protocol}://${request.get('host')}`;
  if ((origin && origin !== expectedOrigin) || request.get('X-Requested-With') !== 'XMLHttpRequest') {
    response.status(403).json({ error: 'Solicitud no permitida' });
    return;
  }
  next();
}

const requireAccount: RequestHandler = (request, response, next) => {
  const token = getSessionToken(request);
  if (!token || !/^[A-Za-z0-9_-]{40,}$/.test(token)) {
    response.status(401).json({ error: 'Inicia sesión para continuar' });
    return;
  }

  const session = database.prepare(`
    SELECT account_id AS accountId, expires_at AS expiresAt
    FROM sessions WHERE token_hash = ?
  `).get(hashToken(token)) as { accountId: number; expiresAt: number } | undefined;

  if (!session || session.expiresAt <= Date.now()) {
    if (session) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    clearSessionCookie(response);
    response.status(401).json({ error: 'Tu sesión expiró; inicia sesión nuevamente' });
    return;
  }

  request.accountId = session.accountId;
  next();
};

function accountId(request: Request): number {
  if (!request.accountId) throw new HttpError(401, 'Inicia sesión para continuar');
  return request.accountId;
}

function validateCredentials(name: unknown, email: unknown, password: unknown, registration: boolean): {
  name: string;
  email: string;
  password: string;
} {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const cleanPassword = typeof password === 'string' ? password : '';

  if (registration && (cleanName.length < 1 || cleanName.length > 100)) {
    throw new HttpError(400, 'El nombre debe tener entre 1 y 100 caracteres');
  }
  if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new HttpError(400, 'El email no es válido');
  }
  if (cleanPassword.length < 10 || cleanPassword.length > 128) {
    throw new HttpError(400, 'La contraseña debe tener entre 10 y 128 caracteres');
  }
  return { name: cleanName, email: cleanEmail, password: cleanPassword };
}

async function createSession(response: express.Response, id: number): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_DURATION;
  database.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), id, expiresAt);
  setSessionCookie(response, token);
}

function safeAccount(account: AccountRow): { id: number; name: string; email: string } {
  return { id: account.id, name: account.name, email: account.email };
}

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(requireSameOriginMutation);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }
});

app.get('/api/auth/session', (request, response) => {
  const token = getSessionToken(request);
  if (!token || !/^[A-Za-z0-9_-]{40,}$/.test(token)) {
    response.json({ authenticated: false });
    return;
  }

  const session = database.prepare(`
    SELECT a.id, a.name, a.email, s.expires_at AS expiresAt
    FROM sessions s JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ?
  `).get(hashToken(token)) as (AccountRow & { expiresAt: number }) | undefined;
  if (!session || session.expiresAt <= Date.now()) {
    if (session) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    clearSessionCookie(response);
    response.json({ authenticated: false });
    return;
  }
  response.json({ authenticated: true, account: safeAccount(session) });
});

app.post('/api/auth/register', authLimiter, async (request, response, next) => {
  try {
    const { name, email, password } = validateCredentials(
      request.body?.name, request.body?.email, request.body?.password, true
    );
    const salt = randomBytes(16);
    const passwordHash = await scrypt(password, salt, 64) as Buffer;
    let account: AccountRow;
    try {
      const result = database.prepare(`
        INSERT INTO accounts (name, email, password_salt, password_hash) VALUES (?, ?, ?, ?)
      `).run(name, email, salt.toString('hex'), passwordHash.toString('hex'));
      account = { id: Number(result.lastInsertRowid), name, email };
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed: accounts.email')) {
        throw new HttpError(409, 'Ya existe una cuenta con ese email');
      }
      throw error;
    }
    const oldToken = getSessionToken(request);
    if (oldToken) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(oldToken));
    await createSession(response, account.id);
    response.status(201).json(safeAccount(account));
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', authLimiter, async (request, response, next) => {
  try {
    const { email, password } = validateCredentials('', request.body?.email, request.body?.password, false);
    const account = database.prepare(`
      SELECT id, name, email, password_salt, password_hash FROM accounts WHERE email = ?
    `).get(email) as AccountRow | undefined;
    if (!account?.password_salt || !account.password_hash) {
      throw new HttpError(401, 'Email o contraseña incorrectos');
    }

    const actualHash = await scrypt(password, Buffer.from(account.password_salt, 'hex'), 64) as Buffer;
    const expectedHash = Buffer.from(account.password_hash, 'hex');
    if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
      throw new HttpError(401, 'Email o contraseña incorrectos');
    }

    const oldToken = getSessionToken(request);
    if (oldToken) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(oldToken));
    await createSession(response, account.id);
    response.json(safeAccount(account));
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', (request, response) => {
  const token = getSessionToken(request);
  if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  clearSessionCookie(response);
  response.status(204).end();
});

app.get('/api/users', requireAccount, (request, response) => {
  const ownerId = accountId(request);
  const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 100) : '';
  const pageSizeValue = Number(request.query.pageSize);
  const pageSize = Number.isInteger(pageSizeValue) ? Math.min(100, Math.max(1, pageSizeValue)) : 10;
  const pageValue = Number(request.query.page);
  const requestedPage = Number.isInteger(pageValue) ? Math.max(1, pageValue) : 1;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const filter = `owner_id = ? AND (? = '' OR name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')`;
  const count = database.prepare(`SELECT COUNT(*) AS total FROM users WHERE ${filter}`)
    .get(ownerId, query, pattern, pattern) as { total: number };
  const totalPages = Math.ceil(count.total / pageSize);
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const users = database.prepare(`
    SELECT id, name, email FROM users
    WHERE ${filter}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(ownerId, query, pattern, pattern, pageSize, (page - 1) * pageSize) as UserRow[];
  response.json({ users, page, pageSize, total: count.total, totalPages });
});

app.get('/api/users/export', requireAccount, (request, response) => {
  const ownerId = accountId(request);
  const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 100) : '';
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const users = database.prepare(`
    SELECT id, name, email FROM users
    WHERE owner_id = ? AND (? = '' OR name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')
    ORDER BY id DESC
  `).all(ownerId, query, pattern, pattern) as UserRow[];

  const csvCell = (value: string | number): string => {
    const text = String(value);
    const safeText = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  };
  const lines = [
    ['ID', 'Nombre', 'Email'].map(csvCell).join(','),
    ...users.map(user => [user.id, user.name, user.email].map(csvCell).join(','))
  ];
  response
    .type('text/csv')
    .set('Content-Disposition', 'attachment; filename="usuarios.csv"')
    .send(`\uFEFF${lines.join('\r\n')}`);
});

app.get('/api/users/:id', requireAccount, (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'ID no válido');
  const user = database.prepare('SELECT id, name, email FROM users WHERE id = ? AND owner_id = ?')
    .get(id, accountId(request)) as UserRow | undefined;
  if (!user) throw new HttpError(404, 'Usuario no encontrado');
  response.json(user);
});

app.post('/api/users', requireAccount, (request, response) => {
  const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  if (name.length < 1 || name.length > 100) throw new HttpError(400, 'El nombre debe tener entre 1 y 100 caracteres');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'El email no es válido');

  try {
    const result = database.prepare('INSERT INTO users (owner_id, name, email) VALUES (?, ?, ?)')
      .run(accountId(request), name, email);
    response.status(201).json({ id: Number(result.lastInsertRowid), name, email });
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed: users.owner_id, users.email')) {
      throw new HttpError(409, 'Ya tienes un usuario registrado con ese email');
    }
    throw error;
  }
});

app.put('/api/users/:id', requireAccount, (request, response) => {
  const id = Number(request.params.id);
  const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'ID no válido');
  if (name.length < 1 || name.length > 100) throw new HttpError(400, 'El nombre debe tener entre 1 y 100 caracteres');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'El email no es válido');

  try {
    const result = database.prepare('UPDATE users SET name = ?, email = ? WHERE id = ? AND owner_id = ?')
      .run(name, email, id, accountId(request));
    if (result.changes === 0) throw new HttpError(404, 'Usuario no encontrado');
    response.json({ id, name, email });
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed: users.owner_id, users.email')) {
      throw new HttpError(409, 'Ya tienes un usuario registrado con ese email');
    }
    throw error;
  }
});

app.delete('/api/users/:id', requireAccount, (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'ID no válido');
  const result = database.prepare('DELETE FROM users WHERE id = ? AND owner_id = ?')
    .run(id, accountId(request));
  if (result.changes === 0) throw new HttpError(404, 'Usuario no encontrado');
  response.status(204).end();
});

app.use(express.static(resolve('dist')));

app.use((_request, response) => {
  response.status(404).json({ error: 'Recurso no encontrado' });
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'Ocurrió un error interno. Inténtalo nuevamente.' });
};
app.use(errorHandler);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SQLite Browser API listening at http://0.0.0.0:${PORT}`);
});
