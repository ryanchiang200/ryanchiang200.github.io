export const SITE = {
  title: 'Ryan 的博客',
  heroTitle: 'Hello，欢迎来到我的博客',
  description: '一个记录技术、登山与生活的地方',
  url: 'https://ryanchiang200.github.io',
  author: 'Ryan',
  since: 2024,
};

/** 博客列表每页文章数 */
export const BLOG_POSTS_PER_PAGE = 6;

/** 分类英文 key → 中文标签 */
export const CATEGORY_LABELS: Record<string, string> = {
  tech: '技术',
  hiking: '登山',
  essay: '随笔',
};

export const NAV_LINKS = [
  { label: '首页', href: '/' },
  { label: '博客', href: '/blog' },
  { label: '项目', href: '/projects' },
  { label: '软件', href: '/software' },
  { label: '搜索', href: '/search' },
  { label: '关于', href: '/about' },
];

export const CONTENT_SECTIONS = [
  {
    emoji: '📝',
    title: '博客',
    href: '/blog',
    available: true,
  },
  {
    emoji: '🚀',
    title: '项目',
    href: '/projects',
    available: false,
  },
  {
    emoji: '💻',
    title: '软件',
    href: '/software',
    available: false,
  },
  {
    emoji: '📷',
    title: '画廊',
    href: '/gallery',
    available: false,
  },
];

export const SOCIAL_LINKS = [
  { label: 'GitHub', href: 'https://github.com/ryanchiang200', icon: 'github' },
  { label: 'RSS', href: '/rss.xml', icon: 'rss' },
  { label: 'Email', href: 'mailto:contact@example.com', icon: 'mail' },
];
