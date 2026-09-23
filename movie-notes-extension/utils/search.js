// Literal, case-insensitive search. Return the matching entries, not unrelated
// notes from the same video. Keep video-only matches available as well.
export function searchNotes(notes, input) {
  const query = String(input || '').trim().toLowerCase();
  if (!query) return [];
  const hit = value => String(value || '').toLowerCase().includes(query);
  const tagsHit = tags => Array.isArray(tags) && tags.some(hit);
  return notes.flatMap(note => {
    if (note.deletedAt) return [];
    const titleMatch = hit(note.movieTitle);
    const tagsMatch = tagsHit(note.tags) || hit(note.movieGenre);
    const entries = (note.entries || []).filter(entry => !entry.deletedAt &&
      (hit(entry.content) || tagsHit(entry.tags)));
    return titleMatch || tagsMatch || entries.length
      ? [{ note, entries, titleMatch, tagsMatch }] : [];
  });
}

// Center long results on the first hit, rather than truncating it out of view.
export function searchExcerpt(content, input, limit = 180) {
  const text = String(content || '');
  const query = String(input || '').trim();
  if (text.length <= limit) return text;
  const index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  let start = Math.max(0, index - 50);
  let end = Math.min(text.length, start + Math.max(limit, query.length + 50));
  // Do not cut a UTF-16 surrogate pair in half.
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start])) start--;
  if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end++;
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

// The caller renders these as text nodes / <mark>, never as HTML.
export function highlightParts(content, input) {
  const text = String(content || '');
  const query = String(input || '').trim();
  if (!query) return [{ text, match: false }];
  // Escaping treats punctuation such as [ and + as literal text.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), match: false });
    parts.push({ text: match[0], match: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}
