/** 文章输入校验与 slug 规则（拼 frontmatter 由同步脚本 scripts/sync-content.mjs 负责） */

export type Category = 'tech' | 'hiking' | 'essay';

export interface ArticleInput {
  slug: string;
  title: string;
  description: string;
  /** YYYY-MM-DD */
  pubDate: string;
  tags: string[];
  category: string;
  draft: boolean;
  content: string;
}

const CATEGORIES: readonly string[] = ['tech', 'hiking', 'essay'];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 校验 slug：小写字母数字 + 连字符（保证 URL 与文件名安全） */
export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** 校验并规范化输入，返回错误信息（null 表示通过） */
export function validate(input: ArticleInput): string | null {
  if (!input.slug) return 'slug 不能为空';
  if (!isValidSlug(input.slug)) return 'slug 只能包含小写字母、数字和连字符';
  if (!input.title?.trim()) return '标题不能为空';
  if (!input.description?.trim()) return '简介不能为空';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.pubDate)) return '日期格式应为 YYYY-MM-DD';
  if (input.category && !CATEGORIES.includes(input.category)) {
    return '分类必须是 tech / hiking / essay 之一';
  }
  if (!Array.isArray(input.tags)) return 'tags 必须是数组';
  if (!input.content?.trim()) return '正文不能为空';
  return null;
}
