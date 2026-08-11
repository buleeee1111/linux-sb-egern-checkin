// linux.sb daily check-in for Egern
// Configure Cookie in the module schema; never hard-code credentials here.

const BASE = "https://linux.sb";
const CHECKIN_URL = `${BASE}/daily_checkin`;

function getCookie(ctx) {
  return (ctx.env?.LinuxSbCookie || ctx.args?.LinuxSbCookie || "").trim();
}

function messageText(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

async function notify(ctx, title, body) {
  if (typeof ctx.notify === "function") {
    await ctx.notify({ title, body });
  }
}

function extract(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1] : "";
}

export default async function (ctx) {
  const cookie = getCookie(ctx);
  if (!cookie) {
    await notify(ctx, "linux.sb 签到失败", "未配置 Cookie");
    return { ok: false, error: "LinuxSbCookie is empty" };
  }

  const headers = {
    "Cookie": cookie,
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    "Accept": "text/html,application/xhtml+xml"
  };

  try {
    const page = await ctx.http.get(CHECKIN_URL, { headers });
    const html = messageText(page?.body ?? page?.data ?? page);

    if (/登录|登录后|请先登录|Sign in/i.test(html) && !/_csrf/.test(html)) {
      await notify(ctx, "linux.sb 签到失败", "Cookie 已失效，请重新抓取");
      return { ok: false, error: "cookie_expired" };
    }

    if (/已签到|已连续签到|今日已签到/.test(html)) {
      await notify(ctx, "linux.sb 签到", "今天已经签到");
      return { ok: true, status: "already-signed-in" };
    }

    const csrf = extract(html, /name=["']_csrf["'][^>]*value=["']([^"']+)["']/i) ||
      extract(html, /value=["']([^"']+)["'][^>]*name=["']_csrf["']/i);
    if (!csrf) {
      await notify(ctx, "linux.sb 签到失败", "没有找到 CSRF Token，可能页面结构已变化");
      return { ok: false, error: "csrf_not_found" };
    }

    const result = await ctx.http.post(CHECKIN_URL, {
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": CHECKIN_URL
      },
      body: `_csrf=${encodeURIComponent(csrf)}`
    });

    const after = await ctx.http.get(CHECKIN_URL, { headers });
    const afterHtml = messageText(after?.body ?? after?.data ?? after);
    const ok = /已签到|已连续签到|今日已签到/.test(afterHtml) || result?.status === 302 || result?.status === 200;
    const text = ok ? "签到成功" : `签到请求已返回，但未确认状态（HTTP ${result?.status ?? "?"}）`;
    await notify(ctx, "linux.sb 签到", text);
    return { ok, status: ok ? "signed-in" : "unconfirmed", httpStatus: result?.status };
  } catch (error) {
    const detail = error?.message || String(error);
    await notify(ctx, "linux.sb 签到失败", detail.slice(0, 180));
    return { ok: false, error: detail };
  }
}
