const markedLib = globalThis.marked;

function safeParseMarkdown(text) {
  const t = String(text || "");
  if (!markedLib || typeof markedLib.parse !== "function") {
    return `<p>${escapeHtml(t)}</p>`;
  }
  try {
    return String(markedLib.parse(t, { gfm: true, breaks: true }) || "");
  } catch {
    return `<p>${escapeHtml(t)}</p>`;
  }
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function base64UrlDecode(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function formatLocalTime(iso) {
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function normalizeTags(tags) {
  return (Array.isArray(tags) ? tags : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
}

// ── Deep-link URL builder ────────────────────────────────────────────────────

/**
 * Append a ?t= timestamp to a YouTube or Bilibili URL.
 * Returns the original URL unchanged for unsupported platforms or missing data.
 */
function buildTimestampedUrl(videoUrl, timestampSec) {
  if (!videoUrl) return "";
  if (timestampSec == null || typeof timestampSec !== "number" || !Number.isFinite(timestampSec)) {
    return videoUrl;
  }
  try {
    const u   = new URL(videoUrl);
    const sec = Math.max(0, Math.floor(timestampSec));
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
      u.searchParams.set("t", `${sec}s`);
    } else if (u.hostname.includes("bilibili.com")) {
      u.searchParams.set("t", String(sec));
    } else {
      return videoUrl; // other platforms: return as-is
    }
    return u.toString();
  } catch {
    return videoUrl;
  }
}

// ── Canvas card renderer ─────────────────────────────────────────────────────

/** Strip common markdown syntax to plain text for canvas rendering */
function markdownToPlainText(md) {
  return String(md || "")
    .replace(/```[\s\S]*?```/gm, "[代码块]")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/#{1,6}\s+(.*)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*+]\s+/gm, "• ")
    .replace(/^>\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Wrap text into lines that fit within maxWidth, returns array of strings (empty string = paragraph break) */
function wrapTextToLines(ctx, text, maxWidth) {
  const paragraphs = text.split(/\n/);
  const lines = [];
  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    const chars = [...para]; // spread handles multibyte/emoji correctly
    let cur = "";
    for (const ch of chars) {
      const test = cur + ch;
      if (ctx.measureText(test).width > maxWidth && cur.length > 0) {
        lines.push(cur);
        cur = ch;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
  }
  // trim trailing blank lines
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

/** Draw a rounded-rect path (polyfills ctx.roundRect for older Chrome) */
function rrPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

/**
 * Render a beautiful share card to a canvas element and return it.
 * Uses 2× device pixel ratio for sharp output.
 */
async function renderCardToCanvas(payload) {
  const {
    movieTitle = "未命名",
    when = "—",
    createdAt = "",
    content = "",
    tags = [],
    thumbnail = null,
    videoUrl = "",
    timestampSeconds = null
  } = payload;

  // The download uses the same type scale, order and colors as the preview.
  try { await document.fonts.ready; } catch { /* System fonts remain available. */ }
  const deepUrl = buildTimestampedUrl(videoUrl, timestampSeconds);
  const DPR = 2;
  const W = 560;
  const PX = 32;
  const INNER_W = W - PX * 2;
  const FONT = '"MiSans","PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  const F_TITLE = `400 12px ${FONT}`;
  const F_BODY = `400 ${content.length > 240 ? 18 : 22}px ${FONT}`;
  const F_ACTION = `500 14px ${FONT}`;
  const F_META = `400 12px ${FONT}`;
  const theme = getComputedStyle(document.documentElement);
  const color = name => theme.getPropertyValue(name).trim();
  const C_BG = color('--card');
  const C_TEXT = color('--fg');
  const C_MUTED = color('--muted');
  const C_ACCENT = color('--accent');
  const C_BORDER = color('--border');
  const LH = content.length > 240 ? 34 : 41;

  const mc = document.createElement("canvas").getContext("2d");
  mc.font = F_BODY;
  let contentLines = wrapTextToLines(mc, markdownToPlainText(content), INNER_W);
  const truncated = contentLines.length > 20;
  if (truncated) contentLines = contentLines.slice(0, 20);
  const textH = contentLines.reduce((h, line) => h + (line ? LH : 16), 0);
  const contentH = Math.max(118, textH);
  mc.font = F_TITLE;
  const titleLines = wrapTextToLines(mc, String(movieTitle), INNER_W);
  const titleH = titleLines.length * 26;

  // Wrap tags instead of letting a long label run into the card edge.
  const tagLines = [];
  mc.font = F_META;
  for (const tag of normalizeTags(tags)) {
    const text = `#${tag}`;
    const current = tagLines[tagLines.length - 1];
    if (current && mc.measureText(`${current}   ${text}`).width <= INNER_W) {
      tagLines[tagLines.length - 1] = `${current}   ${text}`;
    } else {
      tagLines.push(...wrapTextToLines(mc, text, INNER_W));
    }
  }
  const tagsH = tagLines.length ? 12 + tagLines.length * 20 : 0;

  let thumbImg = null;
  let thumbH = 0;
  if (thumbnail) {
    const image = new Image();
    await new Promise((resolve) => {
      image.onload = resolve;
      image.onerror = resolve;
      image.src = thumbnail;
    });
    if (image.naturalWidth > 0) {
      thumbImg = image;
      thumbH = Math.min(420, Math.round(INNER_W * image.naturalHeight / image.naturalWidth));
    }
  }

  const QR_SIZE = 72;
  const QR_PAD = 6;
  const footerH = deepUrl ? 148 : 96;
  const topH = 32 + 30 + 28;
  const contentBlockH = contentH + (truncated ? 24 : 0) + 32;
  const mediaH = thumbImg ? thumbH + 24 : 0;
  const sourceH = 1 + 24 + titleH + 12 + 28 + tagsH + 24;
  const H = topH + contentBlockH + mediaH + sourceH + footerH;
  const canvas = document.createElement("canvas");
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext("2d");
  ctx.scale(DPR, DPR);
  ctx.textBaseline = "top";

  ctx.fillStyle = C_BG;
  ctx.fillRect(0, 0, W, H);
  const wash = ctx.createLinearGradient(0, 0, W, H);
  wash.addColorStop(0, color("--wash"));
  wash.addColorStop(0.6, C_BG);
  wash.addColorStop(1, color("--card-end"));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  // Original, slightly irregular cut-paper quotation mark.
  ctx.save();
  ctx.translate(PX, 32);
  ctx.scale(0.5, 0.5);
  ctx.fillStyle = C_ACCENT;
  ctx.fill(new Path2D("M8 31C7 17 17 7 34 6L35 14C24 16 19 21 19 28L34 27L32 51L10 53Z"));
  ctx.fill(new Path2D("M45 30C44 16 55 5 72 7L72 15C61 16 56 22 57 29L73 30L70 53L47 51Z"));
  ctx.restore();
  ctx.font = F_TITLE;
  ctx.fillStyle = C_TEXT;
  ctx.textAlign = "right";
  ctx.fillText("旁白 Aside", W - PX, 35);
  ctx.textAlign = "left";

  let y = topH;
  ctx.font = F_BODY;
  ctx.fillStyle = C_TEXT;
  for (const line of contentLines) {
    if (line) ctx.fillText(line, PX, y);
    y += line ? LH : 16;
  }
  if (truncated) {
    ctx.font = F_META;
    ctx.fillStyle = C_MUTED;
    ctx.fillText("…（更多内容已省略）", PX, y + 4);
    y += 24;
  }
  y += Math.max(0, contentH - textH) + 32;

  if (thumbImg) {
    ctx.save();
    rrPath(ctx, PX, y, INNER_W, thumbH, 8);
    ctx.clip();
    ctx.fillStyle = "#302a3b";
    ctx.fillRect(PX, y, INNER_W, thumbH);
    // Preserve the entire captured frame, including tall images.
    const scale = Math.min(INNER_W / thumbImg.naturalWidth, thumbH / thumbImg.naturalHeight);
    const drawnW = thumbImg.naturalWidth * scale;
    const drawnH = thumbImg.naturalHeight * scale;
    ctx.drawImage(thumbImg, PX + (INNER_W - drawnW) / 2, y + (thumbH - drawnH) / 2, drawnW, drawnH);
    ctx.restore();
    y += thumbH + 24;
  }

  ctx.fillStyle = C_BORDER;
  ctx.fillRect(PX, y, INNER_W, 1);
  y += 25;
  ctx.font = F_TITLE;
  ctx.fillStyle = C_MUTED;
  for (const line of titleLines) {
    ctx.fillText(line, PX, y);
    y += 26;
  }
  y += 12;

  ctx.font = F_META;
  const whenText = String(when || "—");
  const pillW = Math.min(INNER_W, ctx.measureText(whenText).width + 16);
  ctx.fillStyle = color("--soft");
  rrPath(ctx, PX, y, pillW, 28, 6);
  ctx.fill();
  ctx.fillStyle = C_ACCENT;
  ctx.fillText(whenText, PX + 8, y + 5);
  ctx.font = F_META;
  ctx.fillStyle = C_MUTED;
  const dateText = formatLocalTime(createdAt) || "—";
  const dateWidth = ctx.measureText(dateText).width;
  if (pillW + dateWidth + 24 <= INNER_W) ctx.fillText(`·  ${dateText}`, PX + pillW + 8, y + 6);
  y += 28;
  if (tagLines.length) {
    y += 12;
    for (const line of tagLines) {
      ctx.fillText(line, PX, y);
      y += 20;
    }
  }
  y += 24;

  ctx.fillStyle = color("--card-end");
  ctx.fillRect(0, y, W, footerH);
  ctx.fillStyle = C_BORDER;
  ctx.fillRect(0, y, W, 1);
  const footerTextY = y + (deepUrl ? 40 : 26);
  if (videoUrl) {
    ctx.font = F_ACTION;
    ctx.fillStyle = C_ACCENT;
    ctx.fillText("回到视频片段", PX, footerTextY);
  }
  ctx.font = F_META;
  ctx.fillStyle = C_MUTED;
  ctx.fillText("用旁白，留下观看时产生的想法。", PX, footerTextY + (videoUrl ? 28 : 10));

  if (deepUrl) {
    try {
      const qrLib = globalThis.qrcode;
      if (typeof qrLib === "function") {
        const qr = qrLib(0, "M");
        qr.addData(deepUrl);
        qr.make();
        const modules = qr.getModuleCount();
        const cell = (QR_SIZE - QR_PAD * 2) / modules;
        const qrLeft = W - PX - QR_SIZE;
        const qrTop = y + 24;
        ctx.fillStyle = "#ffffff";
        rrPath(ctx, qrLeft, qrTop, QR_SIZE, QR_SIZE, 6);
        ctx.fill();
        ctx.fillStyle = "#302a3b";
        for (let r = 0; r < modules; r++) {
          for (let c = 0; c < modules; c++) {
            if (qr.isDark(r, c)) ctx.fillRect(qrLeft + QR_PAD + c * cell, qrTop + QR_PAD + r * cell, cell, cell);
          }
        }
        ctx.font = F_META;
        ctx.fillStyle = C_MUTED;
        ctx.textAlign = "center";
        ctx.fillText("扫码直达", qrLeft + QR_SIZE / 2, qrTop + QR_SIZE + 8);
        ctx.textAlign = "left";
      }
    } catch (error) {
      console.warn("[MovieNotes] QR generation failed", error);
    }
  }
  return canvas;
}

/** Generate the card PNG and trigger a browser download */
async function downloadCardImage(payload) {
  const canvas = await renderCardToCanvas(payload);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("生成图片失败")); return; }
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      const name = `${payload.movieTitle || "旁白"}-${payload.when || ""}`
        .replace(/[\\/:*?"<>|⏱→\s]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 80) || "旁白";
      a.href     = url;
      a.download = `${name}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      resolve();
    }, "image/png");
  });
}

// ── Page init ────────────────────────────────────────────────────────────────

async function init() {
  const sp      = new URLSearchParams(location.search || "");
  const wantImg = sp.get("img") === "1";

  const hash = String(location.hash || "").replace(/^#/, "").trim();
  if (!hash) return;

  let payload = null;
  try {
    payload = JSON.parse(base64UrlDecode(hash));
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== "object") return;
  const applyTheme = value => document.documentElement.dataset.theme = value === 'light' ? 'light' : 'dark';
  applyTheme(payload.theme);
  try { const saved = await chrome.storage.local.get('uiTheme'); applyTheme(saved.uiTheme || payload.theme); } catch { /* Shared payload supplies the fallback. */ }
  globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.uiTheme) applyTheme(changes.uiTheme.newValue);
  });

  // DOM refs
  const elCard    = document.getElementById("card");
  const elEmpty   = document.getElementById("empty");
  const elMedia   = document.getElementById("media");
  const elThumb   = document.getElementById("thumb");
  const elTitle   = document.getElementById("movieTitle");
  const elWhen    = document.getElementById("when");
  const elDate    = document.getElementById("date");
  const elTags    = document.getElementById("tags");
  const elContent = document.getElementById("content");
  const elLink    = document.getElementById("videoLink");
  const elSaveBar = document.getElementById("saveBar");
  const elBtnSave = document.getElementById("btnSaveImg");
  const elStatus  = document.getElementById("saveStatus");

  const movieTitle      = String(payload.movieTitle || "（未命名）");
  const when            = String(payload.when || "—");
  const date            = formatLocalTime(payload.createdAt || payload.updatedAt || "");
  const content         = String(payload.content || "").trim();
  const tags            = normalizeTags(payload.tags);
  const videoUrl        = String(payload.videoUrl || "").trim();
  const timestampSec    = typeof payload.timestampSeconds === "number" ? payload.timestampSeconds : null;
  const thumb           = String(payload.thumbnail || "").trim();

  // Build timestamped deep-link for HTML card and QR code
  const deepUrl = buildTimestampedUrl(videoUrl, timestampSec);

  if (!content && !movieTitle) return;

  // Populate HTML card preview
  elTitle.textContent = movieTitle;
  elWhen.textContent  = when || "—";
  elDate.textContent  = date || "—";

  elTags.innerHTML = "";
  for (const t of tags) {
    const span       = document.createElement("span");
    span.className   = "tag";
    span.textContent = `#${t}`;
    elTags.appendChild(span);
  }

  elContent.innerHTML = safeParseMarkdown(content || "");
  elContent.classList.toggle("is-long", content.length > 240);

  if (thumb) {
    elThumb.src     = thumb;
    elThumb.alt     = "视频帧";
    elMedia.hidden  = false;
  } else {
    elMedia.hidden = true;
  }

  // "循迹而至" link → timestamped URL (falls back to base videoUrl)
  const linkTarget = deepUrl || videoUrl;
  if (linkTarget) {
    elLink.href   = linkTarget;
    elLink.hidden = false;
  } else {
    elLink.hidden = true;
  }

  // ── QR code in HTML card footer ───────────────────────────────
  const elFooterQr  = document.getElementById("footerQr");
  const elQrCanvas  = document.getElementById("qrCanvas");
  if (elFooterQr && elQrCanvas && deepUrl) {
    try {
      const qrLib = globalThis.qrcode;
      if (typeof qrLib === "function") {
        const qr = qrLib(0, "M");
        qr.addData(deepUrl);
        qr.make();
        const modules  = qr.getModuleCount();
        const dpr      = Math.min(window.devicePixelRatio || 1, 2);
        const logical  = 72;
        const physical = logical * dpr;
        elQrCanvas.width  = physical;
        elQrCanvas.height = physical;
        elQrCanvas.style.width  = `${logical}px`;
        elQrCanvas.style.height = `${logical}px`;
        const ctx  = elQrCanvas.getContext("2d");
        const cell = physical / modules;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, physical, physical);
        ctx.fillStyle = "#111111";
        for (let r = 0; r < modules; r++) {
          for (let c = 0; c < modules; c++) {
            if (qr.isDark(r, c)) {
              ctx.fillRect(
                Math.floor(c * cell), Math.floor(r * cell),
                Math.ceil(cell), Math.ceil(cell)
              );
            }
          }
        }
        elFooterQr.hidden = false;
      }
    } catch (e) {
      console.warn("[MovieNotes] HTML QR render failed", e);
    }
  }

  elEmpty.hidden = true;
  elCard.hidden  = false;

  // ── Save-image button ──────────────────────────────────────────
  if (elSaveBar) elSaveBar.hidden = false;

  const feedbackTimers = new WeakMap();
  function showFeedback(target, message, duration = 3000) {
    if (!target) return;
    clearTimeout(feedbackTimers.get(target));
    target.textContent = message;
    if (message && duration) feedbackTimers.set(target, setTimeout(() => { target.textContent = ''; }, duration));
  }

  async function triggerSave() {
    if (elBtnSave) {
      elBtnSave.disabled    = true;
      elBtnSave.textContent = "生成中…";
    }
    showFeedback(elStatus, "", 0);
    try {
      await downloadCardImage(payload);
      if (elBtnSave) elBtnSave.textContent = "已保存 ✓";
      showFeedback(elStatus, "图片已保存到下载文件夹");
      setTimeout(() => {
        if (elBtnSave) {
          elBtnSave.disabled    = false;
          elBtnSave.innerHTML   = `<svg class="btn-save-img__icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10 13.5L5.5 9H8V3.5h4V9h2.5L10 13.5z" fill="currentColor"/><rect x="3" y="15" width="14" height="1.5" rx="0.75" fill="currentColor"/></svg>保存图片`;
        }
      }, 2500);
    } catch (e) {
      console.error("[MovieNotes] card image generation failed", e);
      if (elBtnSave) {
        elBtnSave.disabled    = false;
        elBtnSave.textContent = "保存图片";
      }
      showFeedback(elStatus, "生成失败，请重试");
    }
  }

  elBtnSave?.addEventListener("click", triggerSave);

  // Explicit portable actions: local extension URLs are not public share links.
  const elShareHint = document.getElementById('shareHint');
  const copyImage = document.getElementById('btnCopyImage');
  copyImage.addEventListener('click', async () => {
    copyImage.disabled = true;
    showFeedback(elShareHint, '正在生成图片…', 0);
    try {
      const imageBlob = renderCardToCanvas(payload).then(canvas => new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('生成失败')), 'image/png');
      }));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageBlob })]);
      showFeedback(elShareHint, '图片已复制，可粘贴到支持图片的聊天或发布窗口。');
    } catch {
      showFeedback(elShareHint, '暂时无法复制图片，请使用「保存图片」后分享。');
    } finally { copyImage.disabled = false; }
  });
  // 预热 web fonts，避免用户首次点「保存图片」时字体未就绪
  if (wantImg) {
    try { await document.fonts.ready; } catch { /* ignore */ }
  }
}

init();
