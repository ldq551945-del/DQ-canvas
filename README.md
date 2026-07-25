<p align="center">
  <img src="web/public/logo.svg?v=0.0.1" width="108" alt="VOZEB PRO logo">
</p>

<h1 align="center">VOZEB PRO</h1>

<p align="center">面向 Agent、图片、视频、Canvas 与短剧生产的开源 AI 创作工作台</p>

<p align="center">
  <a href="https://github.com/csyqlz/VOZEB-PRO"><img src="https://img.shields.io/github/stars/csyqlz/VOZEB-PRO?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="VERSION"><img src="https://img.shields.io/badge/version-v0.0.1-2563eb?style=flat-square" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-f97316?style=flat-square" alt="License"></a>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-16.2-000000?style=flat-square&logo=nextdotjs" alt="Next.js"></a>
  <a href="https://www.postgresql.org/"><img src="https://img.shields.io/badge/PostgreSQL-16-4169e1?style=flat-square&logo=postgresql" alt="PostgreSQL"></a>
</p>

<p align="center">
  <a href="https://www.vozeb.com">演示站</a> ·
  <a href="docs/index.md">文档索引</a> ·
  <a href="docs/content/docs/overview/project-structure.mdx">项目结构</a> ·
  <a href="docs/content/docs/overview/page-gallery.mdx">页面图册</a> ·
  <a href="#社区交流">QQ 交流群</a> ·
  <a href="#赞助支持">赞助支持</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a> ·
  <a href="CHANGELOG.md">更新记录</a>
</p>

![VOZEB PRO 首页](docs/public/screenshots/pages/01-home.webp)

VOZEB PRO 把统一创作 Agent、图片与视频工作台、画布、短剧生产、素材库和商业运营后台放在同一套 Next.js 全栈应用中。PostgreSQL 保存账号与业务数据；媒体可写入服务器本地目录或 S3 兼容对象存储；模型、支付和存储密钥只在服务端使用。

## 核心功能

- **统一 Agent**：文字、图片、视频和音频素材在同一会话中创作，支持 Skill、智能规划、手动逻辑模型、服务端历史和稳定资产。
- **图片工作台**：文生图、图生图、参考图编辑、多结果、历史恢复、失败重试、WebP 预览和原件下载。
- **视频工作台**：文生视频、图生视频、多类型参考素材、时长/比例/清晰度参数、异步续取和结果管理。
- **画布**：文本、图片、视频、音频与生成节点，支持拖拽、连线、缩放、撤销重做、导入导出和 Agent Run。
- **短剧生产线**：剧本、内容审核、角色/场景/道具、分镜、镜头视频、配音、字幕、版本和 FFmpeg 合成。
- **模型路由**：管理员维护渠道、协议、真实模型、逻辑模型、能力、优先级和默认值，普通用户不接触上游密钥。
- **商业后台**：用户、套餐、积分、CDK、订单、支付、退款、财务流水、公告、提示词、生成运营和审计日志。
- **存储与备份**：本地媒体、S3 兼容对象存储、引用保护、对象迁移和脱敏业务数据导入导出。

## 核心流程

```mermaid
flowchart LR
    USER["用户输入与参考素材"] --> UI["Agent / 工作台 / Canvas / 短剧"]
    UI --> API["Next.js Route Handler"]
    API --> SKILL["Skill 与能力校验"]
    SKILL --> ROUTER["逻辑模型路由"]
    ROUTER --> TASK["幂等生成任务"]
    TASK --> PROVIDER["文本 / 图片 / 视频 / 音频上游"]
    PROVIDER --> MEDIA["媒体规范化与登记"]
    MEDIA --> STORAGE{"存储开关"}
    STORAGE -->|关闭| LOCAL["服务器本地目录"]
    STORAGE -->|开启| S3["S3 兼容对象存储"]
    MEDIA --> PG[("PostgreSQL")]
    PG --> RESULT["会话、历史、积分与结果"]
    RESULT --> UI
```

一条生成任务只调用一次上游创建接口，轮询只查询同一个任务。只有上游明确失败并且用户点击重试，才会创建新的 attempt，避免重复消耗额度。平台规划提示词、模型理由和复盘详情只用于内部执行，不显示或持久化到生成型对话。

完整目录职责、Agent、媒体、计费和部署流程图见[项目结构与流程](docs/content/docs/overview/project-structure.mdx)。

## 最低服务器配置

VOZEB PRO 调用外部 AI 模型，不要求 GPU。服务器主要承担 Web、PostgreSQL、媒体下载/存储和可选 FFmpeg 转码。

| 使用方式                   | CPU      | 内存           | 磁盘      | 说明                                                                |
| -------------------------- | -------- | -------------- | --------- | ------------------------------------------------------------------- |
| 最低可启动                 | 1 核     | 1GB + 1GB swap | 10GB SSD  | 使用发布镜像、外部 PostgreSQL 和外部 S3/OSS；只适合安装体验和低并发 |
| 标准小型部署               | 2 核     | 2GB + 1GB swap | 20GB SSD  | 应用与 PostgreSQL 同机，适合少量用户；不要在服务器现场构建镜像      |
| 推荐日常使用               | 2–4 核   | 4GB            | 40GB+ SSD | 适合图片/视频工作台、Canvas、后台和少量并发                         |
| 短剧合成或频繁本地视频处理 | 4 核以上 | 8GB 以上       | 80GB+ SSD | FFmpeg、长视频下载、转码和字幕合成会明显占用 CPU、内存和临时磁盘    |

最低环境还需要：64 位 Linux、Docker 与 Compose v2、PostgreSQL 16、可用域名和 HTTPS、能够访问模型上游的出站网络。源码开发或现场构建建议至少 2GB 内存，4GB 更稳妥；本地保存视频时请按实际媒体量扩大磁盘。完整说明见[低内存服务器部署](docs/content/docs/overview/low-memory.mdx)。

## 快速开始

### Docker Compose

环境要求：可运行 Docker Compose 的 Linux 服务器、HTTPS 域名，以及按业务需要准备的模型渠道。

```bash
git clone https://github.com/csyqlz/VOZEB-PRO.git
cd VOZEB-PRO
cp .env.example .env
```

至少修改：

```dotenv
NEXT_PUBLIC_SITE_URL=https://vozeb-pro.example.com
POSTGRES_PASSWORD=replace-with-a-strong-password
VOZEB_PRO_ENCRYPTION_KEY=replace-with-openssl-rand-hex-32
```

生成加密密钥并启动：

```bash
openssl rand -hex 32
docker compose pull
docker compose up -d
docker compose ps
```

打开 `https://你的域名/install`，依次检查数据库、初始化表结构并创建首个管理员。

### 宝塔 PostgreSQL

宝塔已安装 PostgreSQL 时使用：

```bash
docker compose -f docker-compose.baota.yml up -d
```

`.env` 中的数据库连接使用宿主机回环地址：

```dotenv
VOZEB_PRO_DATABASE_PROVIDER=postgres
DATABASE_URL=postgres://user:password@127.0.0.1:5432/vozeb_pro
VOZEB_PRO_DATABASE_SSL=0
VOZEB_PRO_TRUSTED_PROXY_HOPS=1
```

宝塔 Nginx 反向代理到应用后，应转发 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto` 和 `X-Forwarded-For`。详细步骤见[生产上线基线](docs/content/docs/overview/production-readiness.mdx)和[Docker 部署](docs/content/docs/overview/docker.mdx)。

### 源码开发

环境要求：Node.js 22、pnpm 10+、PostgreSQL 16；短剧合成和本地转码还需要 FFmpeg。

```bash
cp .env.example web/.env.local
cd web
pnpm install --frozen-lockfile
pnpm run dev
```

访问 `http://localhost:3000/install`。文档站在 `docs/` 中独立运行：

```bash
cd docs
pnpm install --frozen-lockfile
pnpm run dev
```

## 首次配置顺序

1. 在 `/install` 完成数据库初始化和首个管理员创建。
2. 在后台“模型渠道”配置 Base URL、API Key、协议和模型目录。
3. 检测文本、图片、视频和音频能力，创建逻辑模型并设置默认值。
4. 配置套餐、积分规则和可选支付渠道。
5. 配置 SMTP、注册策略、本地媒体或 S3 兼容对象存储。
6. 在“初始化配置”检查上线项，再验证真实生成、退款和备份恢复。

## 项目文件

| 路径                                        | 文件里是什么                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `web/src/app/`                              | Next.js 页面、布局、安装页、用户工作区、管理后台和本站 API Route Handler   |
| `web/src/lib/server/`                       | Agent 编排、模型路由、生成任务、计费、媒体、对象存储、支付和服务端安全逻辑 |
| `web/src/lib/server/database/`              | PostgreSQL 表结构、参数化 Repository、查询映射和文件 Provider 回退         |
| `web/src/components/` / `web/src/hooks/`    | 跨页面 UI、工作台控制器、素材选择、复制下载和会话交互                      |
| `web/src/services/api/` / `web/src/stores/` | 浏览器访问本站 API 的类型化客户端，以及用户、主题、配置和素材瞬时状态      |
| `web/scripts/`                              | standalone 启动、管理员密码重置和发布前检查脚本                            |
| `web/public/`                               | 站点 Logo、浏览器图标和模型品牌图标                                        |
| `docs/content/docs/`                        | 功能、安装、部署、数据库、商业准备、进度和排障文档                         |
| `docs/public/screenshots/`                  | 用户端、公开页和管理后台的脱敏 WebP 功能截图                               |
| `.github/workflows/quality.yml`             | Web 与文档的安装、类型检查、测试、格式检查和生产构建                       |
| `.github/workflows/docker-image.yml`        | 主应用 amd64/arm64 镜像构建与 GHCR 多架构合并                              |
| `.github/workflows/docs-docker-image.yml`   | 文档站 amd64/arm64 镜像构建与 GHCR 多架构合并                              |
| `.env.example`                              | 数据库、站点、加密、代理、媒体、模型、支付和部署变量模板                   |
| `Dockerfile` / `docker-compose*.yml`        | standalone 生产镜像，以及标准、源码、宝塔、外部数据库和低内存部署拓扑      |
| `VERSION` / `CHANGELOG.md`                  | 当前版本号和版本级变更记录                                                 |
| `LICENSE` / `CLA.md` / `SECURITY.md`        | AGPL-3.0 协议、贡献者授权和漏洞提交规则                                    |
| `AGENTS.md` / `CONTRIBUTING.md`             | 项目工程约束，以及开发者提交 Issue、代码和文档的流程                       |

更完整的目录树、关键源码入口、Service、Route Handler、Repository 和任务 Store 职责见[项目结构与流程](docs/content/docs/overview/project-structure.mdx)。

## 页面展示

<table>
  <tr>
    <td width="50%"><img src="docs/public/screenshots/pages/03a-canvas-editor.webp" alt="Canvas 编辑器"></td>
    <td width="50%"><img src="docs/public/screenshots/pages/04a-drama-editor.webp" alt="短剧生产编辑器"></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/public/screenshots/pages/05-image-workbench.webp" alt="图片工作台"></td>
    <td width="50%"><img src="docs/public/screenshots/pages/06-video-workbench.webp" alt="视频工作台"></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/public/screenshots/pages/20-admin-overview.webp" alt="经营看板"></td>
    <td width="50%"><img src="docs/public/screenshots/pages/34-admin-channels.webp" alt="模型渠道"></td>
  </tr>
</table>

用户端、公开页和管理后台共 42 张功能截图见[页面功能图册](docs/content/docs/overview/page-gallery.mdx)。

## 数据与安全

- PostgreSQL 保存用户、会话、设置、创作会话、Canvas、素材、短剧、生成任务、积分和订单。
- 外部存储关闭时新媒体只写 `VOZEB_PRO_DATA_DIR`；开启时新媒体只写 S3 兼容对象存储。历史媒体按登记 Provider 读取。
- 业务记录保存稳定站内 `storageKey`，不保存 base64、对象 Key 或临时签名 URL。
- `.env`、API Key、支付密钥、数据库、媒体文件、备份、日志和构建产物不得提交 Git。
- 生产备份必须同时覆盖 PostgreSQL 和本地媒体或对象存储，不能只备份其中一部分。

## 验证

```bash
cd web
pnpm test
pnpm run typecheck
pnpm run format:check
pnpm run build

cd ../docs
pnpm run types:check
pnpm run build
```

## 文档与协议

- [功能总览](docs/content/docs/overview/features.mdx)
- [项目结构与流程](docs/content/docs/overview/project-structure.mdx)
- [配置说明](docs/content/docs/overview/configuration.mdx)
- [数据库结构](docs/content/docs/backend/backend-database.mdx)
- [待测试](docs/content/docs/progress/pending-test.mdx)
- [参与贡献](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [AGPL-3.0](LICENSE)
- [贡献者协议](CLA.md)

## 社区交流

<table>
  <tr>
    <td width="260"><img src="docs/public/community/qq-vozeb-group-1049777515.webp" width="240" alt="VOZEB 开源交流 QQ 群二维码"></td>
    <td>
      <strong>VOZEB 开源交流</strong><br>
      QQ 群：<code>1049777515</code> · <a href="https://qm.qq.com/q/9MVLTxuRd6">点击加入群聊</a><br><br>
      欢迎交流部署、模型渠道适配、工作台使用、Bug 复现和代码贡献。请勿在群内发送 API Key、数据库密码、支付密钥、服务器私钥或未经脱敏的生产日志。
    </td>
  </tr>
</table>

## 赞助支持

如果 VOZEB PRO 对你有帮助，欢迎扫码支持项目维护、模型测试和文档迭代。

<p align="center">
  <img src="docs/public/community/sponsor-vozeb.webp" width="360" alt="Together 的赞赏码">
</p>

<p align="center"><strong>Together 的赞赏码</strong></p>

## 致谢

- 感谢原创开源作者 **basketikun** 对画布创作工作流、Canvas Agent 和 Codex 插件能力的开源贡献。
- 感谢 QQ 群朋友 **Kitty的猫** 对 VOZEB 的持续赞助与支持，帮助项目继续维护、测试和迭代。
- 感谢 Linux DO 社区、相关提示词开源仓库、Codex / Claude Code 生态，以及项目使用的所有开源工具与基础设施。
