export function chunkNotionText(s, max = 2000) {
  const out = [];
  let t = String(s || "");
  while (t.length) {
    let end = Math.min(max, t.length);
    if (end < t.length && /[\uD800-\uDBFF]/.test(t[end - 1])) end--;
    out.push(t.slice(0, end));
    t = t.slice(end);
  }
  return out.length ? out : [""];
}

/**
 * 将 Markdown 内联样式转换成 Notion rich_text 数组。
 * 支持 **bold** 和 *italic*，其余作为普通文本处理。
 */
function parseInlineRichText(text) {
  const result = [];
  const s = String(text || "");
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|([^*]+)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[1] !== undefined) {
      for (const c of chunkNotionText(m[1])) {
        result.push({ type: "text", text: { content: c }, annotations: { bold: true } });
      }
    } else if (m[2] !== undefined) {
      for (const c of chunkNotionText(m[2])) {
        result.push({ type: "text", text: { content: c }, annotations: { italic: true } });
      }
    } else if (m[3] !== undefined) {
      for (const c of chunkNotionText(m[3])) {
        result.push({ type: "text", text: { content: c } });
      }
    }
  }
  if (!result.length) result.push({ type: "text", text: { content: " " } });
  return result;
}

/**
 * 将 Markdown 字符串解析为 Notion Block 数组。
 * 支持：标题(#/##/###)、分隔线(---)、引用块(>)、无序列表(- *)、粗斜体段落。
 */
export function markdownToNotionBlocks(md) {
  const lines = String(md || "").split("\n");
  const blocks = [];
  let pendingLines = [];

  function flushPending() {
    if (!pendingLines.length) return;
    const text = pendingLines.join("\n").trim();
    pendingLines = [];
    if (!text) return;
    for (const chunk of chunkNotionText(text)) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: parseInlineRichText(chunk) }
      });
    }
  }

  for (const line of lines) {
    // heading_1: `# text` (not `## text`)
    let m;
    if ((m = line.match(/^# (.+)/)) && !line.startsWith("## ")) {
      flushPending();
      blocks.push({ object: "block", type: "heading_1", heading_1: { rich_text: parseInlineRichText(m[1]) } });
      continue;
    }
    // heading_2: `## text` (not `### text`)
    if ((m = line.match(/^## (.+)/)) && !line.startsWith("### ")) {
      flushPending();
      blocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: parseInlineRichText(m[1]) } });
      continue;
    }
    // heading_3: `### text`
    if ((m = line.match(/^### (.+)/))) {
      flushPending();
      blocks.push({ object: "block", type: "heading_3", heading_3: { rich_text: parseInlineRichText(m[1]) } });
      continue;
    }
    // divider: `---`
    if (/^-{3,}$/.test(line.trim())) {
      flushPending();
      blocks.push({ object: "block", type: "divider", divider: {} });
      continue;
    }
    // blockquote: `> text`
    if ((m = line.match(/^> (.+)/))) {
      flushPending();
      blocks.push({ object: "block", type: "quote", quote: { rich_text: parseInlineRichText(m[1]) } });
      continue;
    }
    // bulleted list: `- text` or `* text`
    if ((m = line.match(/^[-*] (.+)/))) {
      flushPending();
      blocks.push({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: parseInlineRichText(m[1]) } });
      continue;
    }
    // blank line → flush accumulated paragraph
    if (line.trim() === "") {
      flushPending();
      continue;
    }
    // regular text → accumulate into paragraph
    pendingLines.push(line);
  }
  flushPending();

  return blocks.length
    ? blocks
    : [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: " " } }] } }];
}

export class NotionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'NotionError';
    this.code = code;
    Object.assign(this, details);
  }
}

export function extractNotionPageId(raw) {
  let value = String(raw || '').trim();
  if (/^https?:\/\//i.test(value)) {
    try { value = new URL(value).pathname; } catch { return ''; }
  }
  // Never accidentally use a database view ID or a block anchor from a copied URL.
  const match = value.match(/(?:^|[-/])([a-f\d]{32}|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})\/?$/i);
  if (!match) return '';
  const id = match[1].replaceAll('-', '').toLowerCase();
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
}

function validateConfig(token, parent) {
  if (!String(token || '').trim() || /\s/.test(token) || /^https?:/i.test(token)) {
    throw new NotionError('invalid_token', '请粘贴连接密钥，不是 Notion 登录密码或网页链接。');
  }
  const id = extractNotionPageId(parent);
  if (!id) throw new NotionError('invalid_parent', '没有识别到页面，请复制一个普通 Notion 页面的完整链接。');
  return id;
}

export async function notionApiRequest(token, path, method = 'POST', body, options = {}) {
  if (typeof location !== 'undefined' && location.protocol !== 'chrome-extension:') {
    throw new NotionError('preview', '请在已安装的旁白插件中连接 Notion。本地预览不连接真实账号。');
  }
  const fetcher = options.fetcher || fetch;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetcher(`https://api.notion.com/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs || 25000)
      });
    } catch {
      throw new NotionError('network', '请求没有收到确认', { uncertainWrite: method !== 'GET' });
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    // Retrying a timed-out/5xx write can create duplicate pages. Only retry explicit throttling,
    // or server errors on reads. Bound Retry-After so the editor cannot stay busy indefinitely.
    if (attempt < 2 && (response.status === 429 || (method === 'GET' && response.status >= 500))) {
      const after = Number(response.headers.get('Retry-After'));
      const wait = after > 0 ? after * 1000 : 1000 * 2 ** attempt;
      if (wait <= 10000) { await sleep(wait); continue; }
    }
    const message = String(data.message || 'Notion 请求失败').split(token).join('[已隐藏]');
    throw new NotionError(data.code || 'request_failed', message, {
      status: response.status,
      uncertainWrite: method !== 'GET' && response.status >= 500
    });
  }
}

export function describeNotionError(error) {
  let text;
  if (['invalid_token', 'invalid_parent', 'preview', 'archived_parent'].includes(error.code)) text = error.message;
  else if (error.code === 'unauthorized' || error.status === 401) text = '密钥无效或已失效。到 Notion 连接管理页重新复制密钥，然后重新验证。';
  else if (error.status === 403 || error.code === 'restricted_resource') {
    text = /limit|quota/i.test(error.message)
      ? 'Notion 工作区已达到内容额度，请先处理工作区限制。'
      : 'Notion 拒绝写入。打开连接的 Capabilities，启用 Read content（读取内容）和 Insert content（插入内容），并确认目标页面已添加此连接。';
  } else if (error.status === 404 || error.code === 'object_not_found') text = '找不到已授权的页面。打开目标页面右上角「··· → 连接 / Connections → 添加连接」，选择同一个连接，再复制此页面链接。请使用普通页面，不要使用数据库链接。';
  else if (error.code === 'validation_error' || error.status === 400) text = 'Notion 未接受这次内容。确认目标是普通页面；若仍失败，请反馈下方错误详情。';
  else if (error.status === 429) text = 'Notion 请求过于频繁，请稍后重试。';
  else if (error.uncertainWrite) text = 'Notion 没有返回写入结果。请先打开目标页面检查是否已生成记录，避免重复导出。';
  else if (error.code === 'network') text = '无法连接 Notion。请检查网络，并在插件中重新验证。';
  else text = 'Notion 暂时未能完成操作，请稍后重试。';
  if (error.partialPageId) text = '页面已创建，但后续内容未写完。请先查看已生成的页面，避免重复导出。' + text;
  return text;
}

// Split by both Notion's array limits and UTF-8 payload size. Very long quotes/headings
// must not produce >100 rich-text fragments or a >500 KB request.
function boundedBlocks(blocks) {
  return blocks.flatMap(block => {
    const rich = block[block.type]?.rich_text;
    if (!rich) return [block];
    const groups = [];
    let items = [], bytes = 0;
    for (const item of rich) {
      const size = new TextEncoder().encode(JSON.stringify(item)).length;
      if (items.length && (items.length >= 90 || bytes + size > 80000)) {
        groups.push(items); items = []; bytes = 0;
      }
      items.push(item); bytes += size;
    }
    if (items.length) groups.push(items);
    return groups.map(rich_text => ({ ...block, [block.type]: { ...block[block.type], rich_text } }));
  });
}

function blockBatches(blocks) {
  const batches = [];
  let batch = [], bytes = 0;
  for (const block of boundedBlocks(blocks)) {
    const size = new TextEncoder().encode(JSON.stringify(block)).length;
    if (batch.length && (batch.length >= 100 || bytes + size > 350000)) {
      batches.push(batch); batch = []; bytes = 0;
    }
    batch.push(block); bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export async function createNotionPageWithMarkdown(token, parent, title, markdown, options = {}) {
  const pageId = validateConfig(token, parent);
  const [first = [], ...rest] = blockBatches(markdownToNotionBlocks(markdown));
  const page = await notionApiRequest(token, '/pages', 'POST', {
    parent: { page_id: pageId },
    properties: { title: { title: [{ text: { content: String(title || '未命名').slice(0, 2000) } }] } },
    children: first
  }, options);
  if (!page.id) throw new NotionError('invalid_response', 'Notion 未返回页面信息', { uncertainWrite: true });
  try {
    for (const children of rest) await notionApiRequest(token, `/blocks/${page.id}/children`, 'PATCH', { children }, options);
  } catch (error) {
    error.partialPageId = page.id;
    throw error;
  }
  return page;
}

export async function verifyNotionConnection(token, parent, options = {}) {
  const id = validateConfig(token, parent);
  const page = await notionApiRequest(token, `/pages/${id}`, 'GET', undefined, options);
  if (page.archived || page.in_trash) throw new NotionError('archived_parent', '目标页面已在回收站，请先恢复或更换页面。');
  const probe = await createNotionPageWithMarkdown(token, id, '旁白连接测试',
    '旁白已成功验证此页面的读取和写入权限。你可以删除这条测试页面。此测试不包含你的笔记。', options);
  const title = Object.values(page.properties || {}).find(prop => prop.type === 'title')?.title || [];
  return { token, parentPageId: id, parentTitle: title.map(item => item.plain_text || item.text?.content || '').join('') || '未命名页面', verifiedAt: new Date().toISOString(), testPageId: probe.id };
}
