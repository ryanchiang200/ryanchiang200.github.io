/** 纯函数冒烟测试：slug 校验、frontmatter 生成与解析 */
import { validate, buildMarkdown, isValidSlug, parseFrontmatter } from '../src/article';

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log('✓ ' + name);
  } else {
    fail++;
    console.error('✗ ' + name);
  }
}

const base = {
  slug: 'my-post',
  title: '标题',
  description: '简介',
  pubDate: '2026-08-10',
  tags: ['a'],
  category: 'tech' as const,
  draft: false,
  content: '## 正文',
};

// slug
assert('slug 合法', isValidSlug('my-post') === true);
assert('slug 拒绝大写', isValidSlug('MyPost') === false);
assert('slug 拒绝下划线', isValidSlug('my_post') === false);
assert('slug 拒绝中文', isValidSlug('你好') === false);

// validate
assert('校验通过', validate(base) === null);
assert('空标题报错', validate({ ...base, title: '' }) !== null);
assert('日期格式错误', validate({ ...base, pubDate: '2026/08/10' }) !== null);
assert('非法分类报错', validate({ ...base, category: 'foo' }) !== null);
assert('空正文报错', validate({ ...base, content: '  ' }) !== null);

// buildMarkdown
const md = buildMarkdown(base);
assert('含 frontmatter', md.startsWith('---'));
assert('含标题行', md.includes("title: '标题'"));
assert('含日期', md.includes('pubDate: 2026-08-10'));
assert('含正文', md.includes('## 正文'));
assert('含分类', md.includes("category: 'tech'"));
assert('draft false', md.includes('draft: false'));

// 引号转义
const evil = buildMarkdown({ ...base, title: "它's 引号" });
assert('单引号被转义', evil.includes("title: '它\\'s 引号'"));

// 无分类
const noCat = buildMarkdown({ ...base, category: '' });
assert('空分类输出 category:', noCat.includes('category:'));

// roundtrip
const parsed = parseFrontmatter(md);
assert('roundtrip title', parsed.title === '标题');
assert('roundtrip date', parsed.pubDate === '2026-08-10');

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
