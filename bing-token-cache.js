import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BING_TOKEN_CACHE_FILE = "bing-token-cache.json";
const BING_TOKEN_CACHE_VERSION = 1;
const BING_TOKEN_REFRESH_SKEW_MS = 60_000;

function decodedJwtClaims(segment) {
  const normalized = String(segment || "").replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function tokenRefreshAt(token, now = Date.now()) {
  const parts = String(token || "").trim().split(".");
  if (parts.length !== 3 || !parts[1]) return 0;

  try {
    const claims = decodedJwtClaims(parts[1]);
    const expiresAt = Number(claims?.exp) * 1000;
    const lifetime = expiresAt - now;
    if (!Number.isFinite(expiresAt) || lifetime <= 0) return 0;
    const skew = Math.min(BING_TOKEN_REFRESH_SKEW_MS, lifetime / 10);
    return expiresAt - skew;
  } catch (_) {
    return 0;
  }
}

async function removeFile(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function readCachedToken(cachePath, now = Date.now()) {
  let raw;
  try {
    raw = await readFile(cachePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    return "";
  }

  try {
    const cached = JSON.parse(raw);
    const token = typeof cached?.token === "string" ? cached.token.trim() : "";
    const refreshAt = tokenRefreshAt(token, now);
    if (cached?.version === BING_TOKEN_CACHE_VERSION && refreshAt > now) return token;
  } catch (_) {
    // A partial or manually edited cache is treated as a miss and replaced.
  }

  try {
    await removeFile(cachePath);
  } catch (_) {
    // A stale cache that cannot be removed must not block a fresh token request.
  }
  return "";
}

async function writeCachedToken(cacheDir, cachePath, token) {
  const refreshAt = tokenRefreshAt(token);
  if (!refreshAt) return;

  await mkdir(cacheDir, { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  const contents = `${JSON.stringify({
    version: BING_TOKEN_CACHE_VERSION,
    token,
    refreshAt,
  })}\n`;

  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, cachePath);
    try {
      await chmod(cachePath, 0o600);
    } catch (_) {
      // File permission modes are not available on every supported platform.
    }
  } finally {
    try {
      await removeFile(temporaryPath);
    } catch (_) {
      // The rename already removed the temporary path in the successful case.
    }
  }
}

export class BingTokenCache {
  requests = new Map();

  async get(cacheDir, fetchToken) {
    const normalizedCacheDir = String(cacheDir || "").trim();
    if (!normalizedCacheDir) {
      throw new Error("Manggo 插件运行时未提供 Bing 令牌缓存目录。");
    }

    const cachePath = join(normalizedCacheDir, BING_TOKEN_CACHE_FILE);
    const pending = this.requests.get(cachePath);
    if (pending) return await pending;

    const request = (async () => {
      const cachedToken = await readCachedToken(cachePath);
      if (cachedToken) return cachedToken;

      const token = String(await fetchToken() || "").trim();
      if (tokenRefreshAt(token)) {
        await writeCachedToken(normalizedCacheDir, cachePath, token);
      }
      return token;
    })();
    this.requests.set(cachePath, request);

    try {
      return await request;
    } finally {
      if (this.requests.get(cachePath) === request) this.requests.delete(cachePath);
    }
  }
}

export const bingTokenCache = new BingTokenCache();
