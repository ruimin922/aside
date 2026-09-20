// ═══════════════════════════════════════════════════════════════════════
// 共享工具函数
// content.js 仍保留内联版本（classic script，不能直接 import）
// ═══════════════════════════════════════════════════════════════════════

export function formatSeconds(sec) {
  if (typeof sec !== "number" || Number.isNaN(sec)) return null;
  const total = Math.max(0, Math.floor(sec));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad2 = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

export function normalizeTagArray(raw) {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

// 同一个输入框里用「/」输入迷思标签：
// - 任意一行（trim 后）以 / 开头，视为「标签行」
// - 标签行支持：/ 台词 配乐 或 /台词 /配乐 或 /#台词,#配乐
// - 保存时移除所有标签行，只保存正文；tags 写入 entry.tags
export function extractTagsFromContent(text) {
  const lines = String(text ?? "").split("\n");
  const tags = [];
  const kept = [];
  for (const line of lines) {
    const t = String(line ?? "").trim();
    if (t.startsWith("/") || t.startsWith("／")) {
      const parsed = t.slice(1).split(/[\s,，/／]+/g)
        .map((x) => x.replace(/^#+/, "").trim())
        .filter(Boolean);
      for (const p of parsed) tags.push(p);
    } else {
      kept.push(line);
    }
  }
  return { content: kept.join("\n").trim(), tags: [...new Set(tags)] };
}
