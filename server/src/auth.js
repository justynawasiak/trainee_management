import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import cookie from "cookie";

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 24) {
    // fallback for dev; production must set env
    return crypto.createHash("sha256").update("dev-secret").digest();
  }
  return new TextEncoder().encode(s);
}

export function cookieName() {
  return process.env.COOKIE_NAME || "klub_auth";
}

export function cookieOptions({ production }) {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: production,
    path: "/",
    maxAge: 60 * 60 * 24 * 7 // 7 days
  };
}

export async function issueToken({ username }) {
  const secret = getSecret();
  return await new SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function readAuth(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parsed = cookie.parse(header);
  const token = parsed[cookieName()];
  if (!token) return null;
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    const username = payload?.username;
    if (!username || typeof username !== "string") return null;
    return { username };
  } catch {
    return null;
  }
}

export function setAuthCookie(res, token, { production }) {
  const serialized = cookie.serialize(cookieName(), token, cookieOptions({ production }));
  res.setHeader("Set-Cookie", serialized);
}

export function clearAuthCookie(res, { production }) {
  const serialized = cookie.serialize(cookieName(), "", {
    ...cookieOptions({ production }),
    maxAge: 0
  });
  res.setHeader("Set-Cookie", serialized);
}

