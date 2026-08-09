/**
 * 计算 Markdown 文本的阅读时间（分钟）。
 * 规则：约 400 个中文字符/分钟，约 200 个英文单词/分钟。
 */
export function readingTime(text: string): number {
  const clean = text
    .replace(/```[\s\S]*?```/g, ' ') // 代码块
    .replace(/`[^`]*`/g, ' ') // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片
    .replace(/\[[^\]]*\]\([^)]*\)/g, '$1') // 链接 → 保留链接文字
    .replace(/[#>*_\-|~]/g, ' ') // markdown 语法符号
    .replace(/\s+/g, ' ')
    .trim();

  const cjk = (clean.match(/[一-鿿㐀-䶿]/g) || []).length;
  const words = (clean.match(/[a-zA-Z0-9]+/g) || []).length;

  return Math.max(1, Math.ceil(cjk / 400 + words / 200));
}
