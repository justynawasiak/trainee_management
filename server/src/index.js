import "dotenv/config";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { ensureUsersFile, verifyUser } from "./users.js";
import { clearAuthCookie, issueToken, readAuth, setAuthCookie } from "./auth.js";

const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);

if (production) {
  const secret = process.env.JWT_SECRET ?? "";
  if (!secret || secret.length < 24 || secret === "change_me_to_a_long_random_string") {
    throw new Error("Missing/weak JWT_SECRET. Set a long random JWT_SECRET in production.");
  }
}

await ensureUsersFile();

const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false // keep simple; can be tightened later
  })
);
app.use(express.json({ limit: "50kb" }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

app.post("/api/login", loginLimiter, async (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!username || !password) return res.status(400).json({ ok: false, error: "missing_credentials" });

  const user = await verifyUser(username, password);
  if (!user) return res.status(401).json({ ok: false, error: "invalid_credentials" });

  const token = await issueToken(user);
  setAuthCookie(res, token, { production });
  res.json({ ok: true, username: user.username });
});

app.post("/api/logout", async (req, res) => {
  clearAuthCookie(res, { production });
  res.json({ ok: true });
});

app.get("/api/me", async (req, res) => {
  const auth = await readAuth(req);
  if (!auth) return res.status(401).json({ ok: false });
  res.json({ ok: true, username: auth.username });
});

const pwaDir = path.resolve(process.cwd(), "..", "pwa");

function sendNoStore(res, filePath) {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(filePath);
}

const PUBLIC_FILES = new Set(["/login.js", "/styles.css", "/assets/icon.svg"]);
function isPublicAsset(reqPath) {
  if (PUBLIC_FILES.has(reqPath)) return true;
  return false;
}

app.get("/", async (req, res) => {
  const auth = await readAuth(req);
  if (!auth) return sendNoStore(res, path.join(pwaDir, "login.html"));
  return sendNoStore(res, path.join(pwaDir, "index.html"));
});

app.get("/login.html", async (req, res) => {
  const auth = await readAuth(req);
  if (auth) return res.redirect("/");
  return sendNoStore(res, path.join(pwaDir, "login.html"));
});

app.get("/index.html", async (req, res) => {
  const auth = await readAuth(req);
  if (!auth) return res.redirect("/");
  return sendNoStore(res, path.join(pwaDir, "index.html"));
});

// Protect all other app routes/assets (except public login assets)
app.use(async (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  if (req.path === "/" || req.path === "/login.html") return next();
  if (isPublicAsset(req.path)) return next();

  const auth = await readAuth(req);
  if (!auth) return res.redirect("/");
  return next();
});

// Serve static PWA files (now protected by middleware above)
app.use(express.static(pwaDir, { index: false, etag: true, maxAge: production ? "1h" : 0 }));

// Fallback for SPA routes
app.get("*", async (req, res) => {
  const auth = await readAuth(req);
  if (!auth) return res.redirect("/");
  return sendNoStore(res, path.join(pwaDir, "index.html"));
});

app.listen(port, () => {
  console.log(`Klub server listening on http://localhost:${port}`);
});
