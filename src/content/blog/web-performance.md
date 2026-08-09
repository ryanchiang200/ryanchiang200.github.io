---
title: '网页性能优化实践'
description: '从指标到实践，聊聊提升网页加载速度的常见手段。'
pubDate: 2025-05-12
tags: ['性能', '前端']
category: 'tech'
draft: false
---

## 核心指标

性能优化的第一步是理解指标。LCP、FID、CLS 是最常被提及的三个。

## 减少 JavaScript

每 100KB 的 JavaScript 都会显著拖慢首屏。能静态化就静态化，能延迟加载就延迟加载。

## 图片优化

- 使用 WebP 格式
- 显式指定宽高，避免布局偏移
- 懒加载非首屏图片
