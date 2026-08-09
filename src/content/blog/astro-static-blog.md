---
title: '用 Astro 构建静态博客'
description: '从零开始搭建一个轻量、快速、SEO 友好的静态博客站点。'
pubDate: 2025-02-10
tags: ['Astro', '教程']
category: 'tech'
draft: false
---

## 为什么选择 Astro

Astro 的核心理念是"内容优先"。它默认输出零 JavaScript 的静态页面，只有需要交互的组件才会按需加载。

对于个人博客来说，这意味着：

- 极快的加载速度
- 完美的 SEO
- 简单的部署方式

## 内容集合

Astro 的内容集合（Content Collections）可以让你用 Markdown 写文章，同时通过 Zod schema 保证 frontmatter 的类型安全。

```ts
import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
  }),
});
```

## 结语

静态博客最大的好处是简单可靠。写 Markdown，构建，部署，完事。
