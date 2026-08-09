/**
 * 格式化发布日期。
 *
 * 用 UTC getter 手动拼接，而不是 toLocaleDateString——
 * toLocaleDateString 依赖构建机时区与 ICU，在 CI 或非 zh 环境下
 * 可能把 `2025-07-15`（UTC 午夜）渲染成 `7月14日` 或英文月份。
 * UTC 方式保证显示与 frontmatter 中的日期完全一致。
 */
export function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return `${y}年${m}月${d}日`;
}
