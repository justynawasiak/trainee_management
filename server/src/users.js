import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";

const DEFAULT_USERS = [
  { username: "Arek", password: "EarlGrey011" },
  { username: "Justyna", password: "EarlGrey011" }
];

function usersPath() {
  return path.join(process.cwd(), "data", "users.json");
}

async function ensureDir() {
  await fs.mkdir(path.join(process.cwd(), "data"), { recursive: true });
}

export async function ensureUsersFile() {
  await ensureDir();
  const file = usersPath();
  try {
    await fs.access(file);
    return;
  } catch {
    // create
  }

  const users = [];
  for (const u of DEFAULT_USERS) {
    const hash = await bcrypt.hash(u.password, 12);
    users.push({ username: u.username, passwordHash: hash, createdAt: Date.now() });
  }
  await fs.writeFile(file, JSON.stringify({ version: 1, users }, null, 2), "utf8");
}

export async function verifyUser(username, password) {
  const file = usersPath();
  const raw = await fs.readFile(file, "utf8");
  const json = JSON.parse(raw);
  const user = (json?.users ?? []).find((u) => u.username === username);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return { username: user.username };
}

