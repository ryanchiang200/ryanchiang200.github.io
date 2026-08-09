/** 纯函数冒烟测试：slug 校验、输入校验 */
import { validate, isValidSlug } from '../src/article';

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
  category: 'tech',
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
assert('空 slug 报错', validate({ ...base, slug: '' }) !== null);
assert('非法 slug 报错', validate({ ...base, slug: 'Bad_Slug' }) !== null);
assert('空标题报错', validate({ ...base, title: '' }) !== null);
assert('日期格式错误', validate({ ...base, pubDate: '2026/08/10' }) !== null);
assert('非法分类报错', validate({ ...base, category: 'foo' }) !== null);
assert('空正文报错', validate({ ...base, content: '  ' }) !== null);
assert('空分类合法', validate({ ...base, category: '' }) === null);
assert('草稿合法', validate({ ...base, draft: true }) === null);

console.log(`\n${pass} 通过, ${fail} 失败`);
if (fail > 0) throw new Error('冒烟测试未全部通过');
