export const VIDEO_DOMAINS = ['youtube.com', 'bilibili.com', 'iqiyi.com', 'youku.com', 'mgtv.com', 'v.qq.com'];
export function isSupportedUrl(value) {
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) && VIDEO_DOMAINS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}

export function videoIdentity(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const is = h => host === h || host.endsWith('.' + h);
    if (is('youtube.com') || host === 'youtu.be') {
      const id = host === 'youtu.be' ? u.pathname.split('/')[1] : u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
      if (id) return `youtube:${id}`;
    }
    if (is('bilibili.com')) {
      const id = u.pathname.match(/\/video\/([^/]+)/)?.[1];
      if (id) return `bilibili:${id}:p${Number(u.searchParams.get('p')) || 1}`;
    }
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|spm)/i.test(key) || ['t','time','start','autoplay','feature','ref','pp','si','ab_channel','trackId','trkid','fbclid','gclid'].includes(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    return u.toString().replace(/\/$/, '');
  } catch { return String(raw).trim(); }
}
