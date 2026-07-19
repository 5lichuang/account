import {
  createAdminUser,
  createSession,
  deleteSession,
  findSessionUser,
  findUserByUsernameKey,
  hasAdminUser,
  type AuthenticatedUser,
} from "@/db/auth-store";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "musu_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 3;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;
const DUMMY_PASSWORD_HASH = [
  "scrypt",
  SCRYPT_N,
  SCRYPT_R,
  SCRYPT_P,
  Buffer.alloc(16, 0x5a).toString("base64url"),
  Buffer.alloc(SCRYPT_KEY_LENGTH, 0xa5).toString("base64url"),
].join("$");

type LoginAttempt = { failures: number; firstFailureAt: number };

declare global {
  var __MUSU_LOGIN_ATTEMPTS__: Map<string, LoginAttempt> | undefined;
}

const loginAttempts =
  globalThis.__MUSU_LOGIN_ATTEMPTS__ ?? new Map<string, LoginAttempt>();
globalThis.__MUSU_LOGIN_ATTEMPTS__ = loginAttempts;

export class AuthInputError extends Error {}
export class AuthConflictError extends Error {}
export class InvalidCredentialsError extends Error {
  constructor() {
    super("用户名或密码不正确");
  }
}
export class AuthRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("登录尝试过于频繁，请稍后再试");
  }
}

function normalizeUsername(value: unknown) {
  if (typeof value !== "string") throw new AuthInputError("请输入用户名");
  const username = value.normalize("NFKC").trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    throw new AuthInputError("用户名需为 3–32 位字母、数字、点、下划线或连字符");
  }
  return { username, usernameKey: username.toLocaleLowerCase("en-US") };
}

function validatePassword(value: unknown) {
  if (typeof value !== "string") throw new AuthInputError("请输入密码");
  if (value.length < 12 || value.length > 128) {
    throw new AuthInputError("密码长度需为 12–128 个字符");
  }
  return value;
}

function scryptAsync(password: string, salt: Uint8Array) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = await scryptAsync(password, salt);
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

async function verifyPassword(password: string, encodedHash: string) {
  const parts = encodedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }
  if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
  const actual = await scryptAsync(password, salt);
  return timingSafeEqual(actual, expected);
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function parseCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator === -1) continue;
    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

function isSecureRequest(request: Request) {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  return forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
}

function serializeSessionCookie(token: string, request: Request) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (isSecureRequest(request)) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearSessionCookie(request: Request) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isSecureRequest(request)) attributes.push("Secure");
  return attributes.join("; ");
}

function attemptKey(request: Request, usernameKey: string) {
  const clientIp =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  return createHash("sha256")
    .update(`${clientIp}\0${usernameKey}`)
    .digest("base64url");
}

function assertLoginAllowed(key: string, now: number) {
  const attempt = loginAttempts.get(key);
  if (!attempt) return;
  const elapsed = now - attempt.firstFailureAt;
  if (elapsed >= LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return;
  }
  if (attempt.failures >= LOGIN_MAX_FAILURES) {
    throw new AuthRateLimitError(
      Math.max(1, Math.ceil((LOGIN_WINDOW_MS - elapsed) / 1000)),
    );
  }
}

function recordLoginFailure(key: string, now: number) {
  const attempt = loginAttempts.get(key);
  if (!attempt || now - attempt.firstFailureAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { failures: 1, firstFailureAt: now });
    return;
  }
  attempt.failures += 1;
}

async function issueSession(userId: number, request: Request) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await createSession({
    tokenHash: tokenHash(token),
    userId,
    createdAt: now,
    expiresAt: now + SESSION_MAX_AGE_SECONDS * 1000,
  });
  return serializeSessionCookie(token, request);
}

export async function setupAdmin(input: {
  username: unknown;
  password: unknown;
  request: Request;
}) {
  if (await hasAdminUser()) {
    throw new AuthConflictError("管理员已经创建，请直接登录");
  }
  const { username, usernameKey } = normalizeUsername(input.username);
  const password = validatePassword(input.password);
  const passwordHash = await hashPassword(password);
  const user = await createAdminUser({
    username,
    usernameKey,
    passwordHash,
    createdAt: Date.now(),
  });
  if (!user) throw new AuthConflictError("管理员已经创建，请直接登录");
  return {
    user: { id: user.id, username: user.username },
    cookie: await issueSession(user.id, input.request),
  };
}

export async function login(input: {
  username: unknown;
  password: unknown;
  request: Request;
}) {
  const { usernameKey } = normalizeUsername(input.username);
  const password = validatePassword(input.password);
  const now = Date.now();
  const key = attemptKey(input.request, usernameKey);
  assertLoginAllowed(key, now);

  const user = await findUserByUsernameKey(usernameKey);
  const valid = await verifyPassword(
    password,
    user?.password_hash ?? DUMMY_PASSWORD_HASH,
  );
  if (!user || !valid) {
    recordLoginFailure(key, now);
    throw new InvalidCredentialsError();
  }

  loginAttempts.delete(key);
  return {
    user: { id: user.id, username: user.username },
    cookie: await issueSession(user.id, input.request),
  };
}

export async function getAuthenticatedUser(
  cookieHeader: string | null,
): Promise<AuthenticatedUser | null> {
  const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return findSessionUser(tokenHash(token), Date.now());
}

export async function getRequestUser(request: Request) {
  return getAuthenticatedUser(request.headers.get("cookie"));
}

export async function requireRequestUser(request: Request) {
  const user = await getRequestUser(request);
  if (!user) throw new AuthenticationRequiredError();
  return user;
}

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("请先登录");
  }
}

export async function logout(request: Request) {
  const token = parseCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    await deleteSession(tokenHash(token));
  }
}

export async function authStatus(cookieHeader: string | null) {
  const setupRequired = !(await hasAdminUser());
  if (setupRequired) {
    return { setupRequired: true, authenticated: false, user: null } as const;
  }
  const user = await getAuthenticatedUser(cookieHeader);
  return {
    setupRequired: false,
    authenticated: Boolean(user),
    user: user ? { username: user.username } : null,
  } as const;
}
