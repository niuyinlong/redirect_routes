# redirect_routes
通过Cloudflare Worker实现动态路由重定向系统，包括短链接生成、多域名跳转等功能，并整合Cloudflare的多项服务。

## 版本管理
wrangler：4.14.3

## 项目结构
```bash
redirect-worker/
├── src/
│   └── index1.js      # 逻辑代码文件
├── admin/             # 管理页面目录（不在公开目录中）
│   └── index.html     # 前端页面文件
└── wrangler.toml      # Cloudflare Workers配置
```