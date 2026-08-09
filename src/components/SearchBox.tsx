import { useEffect, useState } from 'react';
import { CATEGORY_LABELS } from '@lib/consts';

interface SearchItem {
  title: string;
  description: string;
  tags: string[];
  category: string | null;
  url: string;
  date: string;
}

export default function SearchBox() {
  const [index, setIndex] = useState<SearchItem[]>([]);
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/search.json')
      .then((res) => res.json())
      .then((data: SearchItem[]) => {
        setIndex(data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const q = query.trim().toLowerCase();
  const results = q
    ? index.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.tags.some((tag) => tag.toLowerCase().includes(q))
      )
    : [];

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="输入关键词搜索文章…"
        aria-label="搜索文章"
        className="w-full rounded-2xl border border-warm-200 bg-warm-100
                   px-5 py-3.5 text-base text-warm-800 placeholder:text-warm-800/30
                   focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20
                   transition-colors"
        autoFocus
      />

      {!loaded ? (
        <p className="mt-8 text-sm text-warm-800/40">加载索引中…</p>
      ) : q === '' ? (
        <p className="mt-8 text-sm text-warm-800/40">
          输入关键词搜索文章标题、描述与标签
        </p>
      ) : results.length === 0 ? (
        <p className="mt-8 text-sm text-warm-800/40">没有找到相关文章</p>
      ) : (
        <ul className="mt-8 space-y-2">
          {results.map((item) => (
            <li key={item.url}>
              <a
                href={item.url}
                className="group block rounded-xl border border-transparent px-4 py-3
                           transition-colors hover:border-warm-200 hover:bg-warm-100"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium text-warm-800 group-hover:text-accent transition-colors">
                    {item.title}
                  </span>
                  <time className="shrink-0 text-xs text-warm-800/40 tabular-nums">
                    {item.date}
                  </time>
                </div>
                <p className="mt-1 text-sm text-warm-800/50 line-clamp-2">
                  {item.description}
                </p>
                {(item.category || item.tags.length > 0) && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    {item.category && (
                      <span className="text-xs text-accent bg-accent-light/40 px-2 py-0.5 rounded-full">
                        {CATEGORY_LABELS[item.category] ?? item.category}
                      </span>
                    )}
                    {item.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="text-xs text-warm-800/30 bg-warm-200/50 px-2 py-0.5 rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
