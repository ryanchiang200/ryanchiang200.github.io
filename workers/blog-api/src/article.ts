/** 文章相关工具：slug 校验、frontmatter 生成、markdown 文件解析 */

export interface ArticleInput {
  slug: string;
  title: string;
  description: string;
  /** YYYY-MM-DD */
  pubDate: string;
  tags: string[];
  category: 'tech' | 'hiking' | 'essay' | '';
  draft: boolean;
  content: string;
}

const CATEGORIES = ['tech', 'hiking', 'essay'] as const;
export type Category = (typeof CATEGORIES)[number];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 校验 slug：小写字母数字 + 连字符（保证 URL 与文件名安全） */
export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** 单引号转义，防止 frontmatter 被注入 */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** 由输入生成完整 markdown 文件内容（frontmatter + body） */
export function buildMarkdown(input: ArticleInput): string {
  const lines: string[] = [
    '---',
    `title: '${esc(input.title)}'`,
    `description: '${esc(input.description)}'`,
    `pubDate: ${input.pubDate}`,
    `tags: [${input.tags.map((t) => `'${esc(t)}'`).join(', ')}]`,
    input.category ? `category: '${input.category}'` : 'category:',
    `draft: ${input.draft}`,
    '---',
    '',
    input.content.trim(),
    '',
  ];
  return lines.join('\n');
}

/** 简单解析已存在的 markdown frontmatter（用于回显 / 更新时间校验） */
export function parseFrontmatter(md: string): { title?: string; pubDate?: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const title = m[1].match(/title:\s*['"]?(.*?)['"]?\s*$/m)?.[1];
  const pubDate = m[1].match(/pubDate:\s*(\S+)/)?.[1];
  return { title, pubDate };
}

/** 校验并规范化输入，返回错误信息（null 表示通过） */
export function validate(input: ArticleInput): string | null {
  if (!input.slug) return 'slug 不能为空';
  if (!isValidSlug(input.slug)) return 'slug 只能包含小写字母、数字和连字符';
  if (!input.title?.trim()) return '标题不能为空';
  if (!input.description?.trim()) return '简介不能为空';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.pubDate)) return '日期格式应为 YYYY-MM-DD';
  if (input.category && !(CATEGORIES as readonly string[]).includes(input.category)) {
    return '分类必须是 tech / hiking / essay 之一';
  }
  if (!Array.isArray(input.tags)) return 'tags 必须是数组';
  if (!input.content?.trim()) return '正文不能为空';
  return null;
}
