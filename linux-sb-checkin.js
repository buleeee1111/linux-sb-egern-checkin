// linux.sb daily check-in for Egern.
// v2: capture 正则放宽（任何非空 Cookie 都保存，签到失败再报过期）；ctx.http 强 JSON 解析报错翻译为可读提示；env 检查宽容
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

// env 检查宽容：只有明确 false 才禁用；{{{...}}} 字面量/空值按开启处理
function enabled(ctx) {
  const value = String(ctx.env?.CaptureCookie ?? ctx.args?.CaptureCookie ?? "");
  if (value === "" || value.includes("{{{")) return true;
  return value.toLowerCase() !== "false";
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

function translateHttpError(error) {
  const raw = String(error?.message || error || "");
  if (/JSON Parse|Unable to parse JSON|Unexpected identifier|Unexpected token|SyntaxError/i.test(raw)) {
    return new Error("接口返回了非 JSON 内容（可能是 HTML 页面），已按网页内容处理");
  }
  return error instanceof Error ? error : new Error(raw);
}

// 请求封装：Egern 的 ctx.http 内部会强解析 JSON，非 JSON 内容抛解析错误，必须整段包住并拿 body
async function httpGet(ctx, url, headers) {
  let response;
  try {
    response = await ctx.http.get(url, { timeout: 20000, headers });
  } catch (error) {
    throw translateHttpError(error);
  }
  if (response && typeof response.text === "function") {
    try { const raw = await response.text(); if (typeof raw === "string") return raw; } catch (_) {}
  }
  return text(response?.body ?? response?.data ?? response);
}

async function httpPost(ctx, url, headers, body) {
  let response;
  try {
    response = await ctx.http.post(url, { timeout: 20000, headers, body });
  } catch (error) {
    throw translateHttpError(error);
  }
  if (response && typeof response.text === "function") {
    try { const raw = await response.text(); if (typeof raw === "string") return raw; } catch (_) {}
  }
  return text(response?.body ?? response?.data ?? response);
}

function extract(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1] : "";
}

async function capture(ctx) {
  if (!enabled(ctx)) return { ok: true, disabled: true };
  const cookie = readCookie(ctx);
  if (!cookie) return { ok: false, ignored: true };
  // v2: 不再按关键词过滤，任何非空 Cookie 都保存；签到失败再通知过期
  const fp = fingerprint(cookie);
  let old = "";
  try { old = String(ctx.storage.get(COOKIE_FP_STORE) || ""); } catch (_) {}
  setStoredCookie(ctx, cookie);
  try { ctx.storage.set(COOKIE_FP_STORE, fp); } catch (_) {}
  if (fp !== old) await notify(ctx, "linux.sb", "已获取 Cookie，自动签到已就绪");
  return { ok: true, changed: fp !== old };
}

async function checkin(ctx) {
  const cookie = getStoredCookie(ctx);
  if (!cookie) {
    await notify(ctx, "linux.sb 签到失败", "还没有获取到 Cookie，请打开 linux.sb 并登录");
    return { ok: false, error: "cookie_not_captured" };
  }
  const headers = {
    Cookie: cookie,
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    Accept: "text/html,application/xhtml+xml"
  };
  try {
    const html = await httpGet(ctx, CHECKIN_URL, headers);
    if (/登录|登录后|请先登录|Sign in/i.test(html) && !/_csrf/.test(html)) {
      await notify(ctx, "linux.sb Cookie 过期", "Cookie 已失效，请重新打开 linux.sb 登录");
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
    await httpPost(ctx, CHECKIN_URL, {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: CHECKIN_URL
    }, `_csrf=${encodeURIComponent(csrf)}`);
    const afterHtml = await httpGet(ctx, CHECKIN_URL, headers);
    const ok = /已签到|已连续签到|今日已签到/.test(afterHtml);
    await notify(ctx, "linux.sb 签到", ok ? "签到成功" : "未确认签到结果");
    return { ok, status: ok ? "signed-in" : "unconfirmed" };
  } catch (error) {
    const detail = translateHttpError(error).message;
    await notify(ctx, "linux.sb 签到失败", detail.slice(0, 180));
    return { ok: false, error: detail };
  }
}

export default async function (ctx) {
  if (ctx.request) return capture(ctx);
  return checkin(ctx);
}
