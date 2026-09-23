export function syncStatusLabel(state) {
  return ({ hidden: '本地使用', syncing: '同步中', ok: '已同步', pending: '待同步', error: '同步失败' })[state] ?? '同步状态待确认';
}

// Keep a useful, persistent explanation beside the account, not only in a toast.
export function describeSyncFailure(error, { online = true } = {}) {
  const message = String(error?.message || error || '');
  if (/升级同步结构|PGRST20[24]|42703|column .*does not exist/i.test(message)) {
    return { label: '云端需要升级', message: '云端同步服务尚未完成升级。笔记已保存在本机，升级完成后点击「立即同步」。' };
  }
  if (/未登录|登录凭证|jwt|token.*expired|401/i.test(message)) {
    return { label: '登录已过期', message: '请重新登录后同步。当前账号的本地笔记会保留。' };
  }
  if (/账号已切换/.test(message)) {
    return { label: '同步已暂停', message: '账号发生变化，请刷新页面后重试同步。' };
  }
  if (!online && /fetch|network|offline|网络/i.test(message)) {
    return { label: '离线待同步', message: '当前无法联网，笔记保存在本机。恢复连接后会自动重试，也可点击「立即同步」。' };
  }
  if (/timeout|timed out|超时/i.test(message)) {
    return { label: '同步超时', message: '云端响应超时，笔记已保存在本机。请稍后点击「立即同步」。' };
  }
  if (/fetch|network|offline|网络/i.test(message)) {
    return { label: '无法连接云端', message: '请检查网络或代理后重试，笔记已保存在本机。' };
  }
  if (/permission|row.level.security|42501|403/i.test(message)) {
    return { label: '云端权限异常', message: '云端未允许本次同步，请联系维护者检查权限。本地笔记会保留。' };
  }
  return { label: '同步未完成', message: '笔记已保存在本机，请点击「立即同步」重试；若仍失败，请联系维护者排查。' };
}
