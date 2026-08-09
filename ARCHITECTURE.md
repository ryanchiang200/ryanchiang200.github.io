# Personal Blog CMS Architecture

#不允许修改.git文件里的任何文件！

# 1. 项目概述


## 项目名称

Personal Blog CMS


## 项目定位

这是一个长期维护的个人内容管理系统。


目标：

构建一个集：

- 技术博客
- 个人见闻
- 登山记录
- 项目展示
- 软件分享
- 视频分享
- 图片展示

于一体的个人知识展示平台。


系统定位：

个人主页 + 技术博客 + 内容管理系统。


---

# 2. 系统总体架构


系统采用前后端分离架构。


```

```
                     用户

                      |

                      |

               GitHub Pages

                      |

                      |

             Frontend Website

              Astro + React

                      |

                      |

                 API 请求

                      |

                      |

          Cloudflare Workers

           TypeScript + Hono

                      |

                      |

              Cloudflare D1

                数据库
```

```


文件资源架构：


```

```
                   文件资源

                      |

          -----------------------

          |                     |

      GitHub              Object Storage

          |                     |

 Markdown / 图片          视频 / 大文件
```

```


---

# 3. 系统组成


# 3.1 用户端 Frontend


技术：

- Astro
- React
- Tailwind CSS


部署：

GitHub Pages


负责：

- 首页展示
- 文章阅读
- 项目展示
- 软件展示
- 视频展示
- 图片展示
- 搜索
- 评论交互


设计目标：

- SEO友好
- 页面加载快速
- 内容展示优先


---

# 3.2 后端 Backend


技术：

- TypeScript
- Cloudflare Workers
- Hono


部署：

Cloudflare Workers


负责：

- API接口
- 用户认证
- 权限验证
- 数据处理
- 内容管理接口
- 评论接口
- 数据统计接口


---

# 3.3 管理后台 Admin CMS


管理后台属于独立系统。


技术：

- React
- Vite
- Ant Design


部署：

独立部署。


负责：


## 内容管理

管理：

- 文章
- 项目
- 软件
- 视频
- 图片


## 用户管理

管理：

- 用户账号
- 用户角色
- 权限


## 评论管理

管理：

- 评论审核
- 评论删除
- 回复管理


## 数据统计

查看：

- 浏览量
- 访问量
- 下载量
- 播放量


安全要求：

- 独立登录
- 权限验证
- 不出现在用户端导航
- 不暴露管理员功能


---

# 4. 项目目录结构


推荐：


```

PersonalBlog

├── frontend

│   ├── src

│   ├── pages

│   ├── components

│   └── styles

├── backend

│   ├── src

│   ├── api

│   ├── auth

│   ├── services

│   └── database

├── admin

│   ├── src

│   ├── pages

│   ├── components

│   └── services

├── content

│   ├── articles

│   ├── projects

│   └── documents

├── assets

│   ├── images

│   └── covers

├── database

│   ├── migrations

│   └── schema.sql

└── docs

```


---

# 5. 内容系统架构


系统支持以下内容类型：


---

# 5.1 Blog文章系统


用途：

- 技术文章
- 学习记录
- 登山记录
- 个人随笔


存储：

Markdown。


文章结构：


```

Article

id

title

slug

cover

category

tags

content

author

created_at

updated_at

```


支持：

- Markdown解析
- 分类系统
- 标签系统
- 全文搜索
- SEO优化


---

# 5.2 Project项目系统


用途：

展示个人项目。


内容：


```

Project

项目名称

项目介绍

技术栈

开发过程

项目截图

GitHub地址

项目文档

```


数据库：


```

projects

id

title

description

technology

github_url

images

created_at

```


---

# 5.3 Software软件系统


用途：

软件分享。


内容：


```

Software

软件名称

版本

介绍

技术细节

使用说明

下载地址

源码地址

更新日志

```


数据库：


```

software

id

name

version

description

download_url

github_url

documentation

created_at

```


支持：

- GitHub Release
- GitHub仓库
- 对象存储


---

# 5.4 Video视频系统


用途：

视频分享。


内容：

```

Video

id

title

description

cover

video_url

download_url

tags

views

created_at

```


功能：

- 视频展示
- 在线播放
- 下载
- 播放统计


视频来源：

- 视频平台
- 对象存储


---

# 5.5 Gallery图片系统


用途：

图片展示。


功能：

- 图片分类
- 相册管理
- 图片浏览


数据结构：


```

Album

id

title

description

```


```

Image

id

album_id

url

description

created_at

```


---

# 6. 用户系统架构


支持登录方式：

- 用户名密码
- 邮箱注册
- GitHub OAuth


用户模型：


```

User

id

username

email

password_hash

github_id

avatar

role

created_at

last_login

```


---

# 用户角色


## Admin


权限：

- 系统管理
- 用户管理
- 内容管理
- 数据管理


---

## Editor


权限：

- 创建内容
- 编辑内容
- 发布内容


---

## User


权限：

- 评论
- 回复
- 用户资料管理


---

# 7. 评论系统架构


支持：

- 游客评论
- 用户评论
- 楼中楼回复


数据结构：


```

Comment

id

article_id

user_id

parent_id

content

status

created_at

```


回复关系：


```

评论

|

└── 回复

```
  |

  └── 回复
```

```


parent_id：

用于实现评论层级关系。


游客评论：

首次评论需要审核。


---

# 8. 搜索系统


支持：

站内全文搜索。


搜索范围：

- 文章
- 项目
- 软件
- 视频


初期：

数据库全文搜索。


未来：

支持：

- Meilisearch
- Elasticsearch


---

# 9. 数据统计系统


统计内容：


## 网站访问


包括：

- PV
- UV
- 来源
- 访问时间


## 内容统计


包括：

- 阅读量
- 评论量
- 下载量
- 播放量


---

# 10. 数据库设计


数据库：

Cloudflare D1


主要数据表：


```

users

articles

projects

software

videos

albums

images

comments

statistics

```


数据库管理：

使用 Migration。


所有结构变化需要记录。


---

# 11. 文件存储架构


## GitHub


用于：

- 源代码
- Markdown
- 图片
- 小型资源


---

## Object Storage


用于：

- 视频
- 大文件
- 软件安装包


---

# 12. 部署架构


## Frontend


平台：

GitHub Pages


流程：


```

Git Push

↓

GitHub Actions

↓

Build Astro

↓

Deploy

```


---

## Backend


平台：

Cloudflare Workers


流程：


```

Code Push

↓

Deploy Worker

↓

API上线

```


---

## Database


平台：

Cloudflare D1


管理：

Migration。


---

# 13. 安全设计


## 用户密码


要求：

- Hash存储
- 不保存明文密码


---

## 权限控制


要求：

- 后端验证权限
- API接口验证身份


禁止：

- 只依赖前端隐藏按钮


---

## 敏感信息


使用：

- Environment Variables
- Secret管理


禁止提交：

- API Key
- Token
- 密码


---

# 14. 开发原则


项目开发遵循：


1. 免费优先

2. 简单可靠

3. 模块化设计

4. 长期维护

5. 可扩展


---

# 15. 未来扩展


系统未来可以支持：

- AI智能搜索
- RSS订阅
- 多语言
- 移动端接口
- 数据分析增强
- 更多内容类型

```
