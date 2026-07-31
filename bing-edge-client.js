const EDGE_RELEASES_URL = "https://edgeupdates.microsoft.com/api/products?view=enterprise";
const FALLBACK_EDGE_VERSION = "150.0.4078.105";

let edgeVersion = FALLBACK_EDGE_VERSION;
let refreshRequest = null;

function versionParts(version) {
  return String(version || "").split(".").map((part) => Number(part) || 0);
}

function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function latestStableWindowsVersion(payload) {
  const products = Array.isArray(payload) ? payload : [];
  const stable = products.find((product) => product?.Product === "Stable");
  const releases = Array.isArray(stable?.Releases) ? stable.Releases : [];
  let latest = null;

  for (const release of releases) {
    const version = String(release?.ProductVersion || "").trim();
    if (!/^\d+(?:\.\d+){3}$/u.test(version)) continue;
    if (String(release?.Platform || "").toLowerCase() !== "windows") continue;
    if (String(release?.Architecture || "").toLowerCase() !== "x64") continue;

    const publishedAt = Date.parse(release?.PublishedTime || "") || 0;
    if (
      !latest
      || publishedAt > latest.publishedAt
      || (publishedAt === latest.publishedAt && compareVersions(version, latest.version) > 0)
    ) {
      latest = { version, publishedAt };
    }
  }
  return latest?.version || "";
}

export function currentBingEdgeVersion() {
  return edgeVersion;
}

export async function refreshBingEdgeVersion(fetch) {
  if (refreshRequest) return await refreshRequest;

  const request = (async () => {
    const response = await fetch(EDGE_RELEASES_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    let raw = "";
    try {
      raw = await response.text();
    } catch (error) {
      throw new Error(`微软 Edge 版本响应读取失败：${error?.message || error}`);
    }
    if (!response.ok) {
      const detail = raw.trim().replace(/\s+/gu, " ").slice(0, 200);
      throw new Error(
        `微软 Edge 版本请求失败：HTTP ${response.status}${detail ? `，${detail}` : ""}`,
      );
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      throw new Error("微软 Edge 版本接口返回了无法解析的响应。");
    }

    const latestVersion = latestStableWindowsVersion(payload);
    if (!latestVersion) {
      throw new Error("微软 Edge 版本接口未返回 Windows x64 Stable 版本。");
    }
    edgeVersion = latestVersion;
    return latestVersion;
  })();
  refreshRequest = request;

  try {
    return await request;
  } finally {
    if (refreshRequest === request) refreshRequest = null;
  }
}
