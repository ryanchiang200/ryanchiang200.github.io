import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE } from '@lib/consts';

export async function GET(context) {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  const sorted = posts.sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime()
  );

  return rss({
    title: `${SITE.title} — RSS`,
    description: SITE.description,
    site: context.site,
    items: sorted.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/blog/${post.slug}`,
      categories: post.data.tags,
    })),
    customData: `<language>zh-CN</language>`,
  });
}
