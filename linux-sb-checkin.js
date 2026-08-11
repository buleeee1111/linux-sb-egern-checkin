// linux.sb daily check-in for Egern.
// Cookie capture is local-only; credentials are never logged or uploaded.

const BASE = "https://linux.sb";
const CHECKIN_URL = `${BASE}/daily_checkin`;
const COOKIE_STORE = "linuxsb.cookie.v1";
const COOKIE_FP_STORE = "linuxsb.cookie.fp.v1";

function text(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

function readHeader(headers, name) {
  if (!headers) return "";
  try {
    if (typeof headers.get === "function") return headers.get(name) || headers.get(name.toLowerCase()) || "";
  } catch (_) {}
  return headers[name] || headers[name.toLowerCase()] || "";
}

function readCookie(ctx) {
  return readHeader(ctx.request?.headers, "cookie").trim();
}

function getStoredCookie(ctx) {
  try { return String(ctx.storage.get(COOKIE_STORE) || "").trim(); } catch (_) { return ""; }
}

function setStoredCookie(ctx, cookie) {
  try { ctx.storage.set(COOKIE_STORE, cookie); } catch (_) {}
}

function fingerprint(cookie) {
  let h = 2166136261;
  for (let i = 0; i < cookie.length; i += 1) {
    h ^= cookie.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

async function notify(ctx, title, body) {
  if (typeof ctx.notify === "function") await ctx.notify({ title, body });
}

function extract(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1] : "";
}

async function capture(ctx) {
  const cookie = readCookie(ctx);
  if (!cookie || !/(session|auth|token|sid|cf_clearance)/i.test(cookie)) return { ok: false, ignored: true };
  const fp = fingerprint(cookie);
  let old = "";
  try { old = String(ctx.storage.get(COOKIE_FP_STORE) || ""); } catch (_) {}
  setStoredCookie(ctx, cookie);
  try { ctx.storage.set(COOKIE_FP_STORE, fp); } catch (_) {}
  if (fp !== old) await notify(ctx, "linux.sb", "已自动捕获登录 Cookie");
  return { ok: true, changed: fp !== old };
}

async function checkin(ctx) {
  const cookie = getStoredCookie(ctx);
  if (!cookie) {
    await notify(ctx, "linux.sb 签到失败", "还没有捕获到登录 Cookie，请先打开 linux.sb 并登录");
    return { ok: false, error: "cookie_not_captured" };
  }
  const headers = {
    Cookie: cookie,
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    Accept: "text/html,application/xhtml+xml"
  };
  try {
    const page = await ctx.http.get(CHECKIN_URL, { headers });
    const html = text(page?.body ?? page?.data ?? page);
    if (/登录|登录后|请先登录|Sign in/i.test(html) && !/_csrf/.test(html)) {
      await notify(ctx, "linux.sb 签到失败", "Cookie 已失效，请重新登录 linux.sb");
      return { ok: false, error: "cookie_expired" };
    }
    if (/已签到|已连续签到|今日已签到/.test(html)) {
      await notify(ctx, "linux.sb 签到", "今天已经签到");
      return { ok: true, status: "already-signed-in" };
    }
    const csrf = extract(html, /name=["']_csrf["'][^>]*value=["']([^"']+)["']/i) || extract(html, /value=["']([^"']+)["'][^>]*name=["']_csrf["']/i);
    if (!csrf) {
      await notify(ctx, "linux.sb 签到失败", "没有找到 CSRF Token，页面结构可能已变化");
      return { ok: false, error: "csrf_not_found" };
    }
    const result = await ctx.http.post(CHECKIN_URL, {
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", Referer: CHECKIN_URL },
      body: `_csrf=${encodeURIComponent(csrf)}`
    });
    const after = await ctx.http.get(CHECKIN_URL, { headers });
    const afterHtml = text(after?.body ?? after?.data ?? after);
    const ok = /已签到|已连续签到|今日已签到/.test(afterHtml) || result?.status === 302;
    await notify(ctx, "linux.sb 签到", ok ? "签到成功" : `未确认签到结果（HTTP ${result?.status ?? "?"}）`);
    return { ok, status: ok ? "signed-in" : "unconfirmed" };
  } catch (error) {
    const detail = error?.message || String(error);
    await notify(ctx, "linux.sb 签到失败", detail.slice(0, 180));
    return { ok: false, error: detail };
  }
}

export default async function (ctx) {
  if (ctx.request?.url) return capture(ctx);
  return checkin(ctx);
}
