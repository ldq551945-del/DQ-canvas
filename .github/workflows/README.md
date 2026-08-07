# 自动化流程

该目录保存 DQ-绘图 的 GitHub Actions 工作流，用于提交质量检查和多架构容器镜像发布。

- `quality.yml`：检查主应用与文档站的依赖审计、ESLint、格式、类型、单元测试、真实 PostgreSQL 集成、Playwright 浏览器回归、构建，以及 CodeQL 和 Gitleaks 安全门禁。
- `docker-image.yml`：构建并发布主应用多架构镜像。
- `docs-docker-image.yml`：构建并发布文档站多架构镜像。
- `rembg-docker-image.yml`：构建并发布 rembg 多架构镜像。

三套镜像工作流都会在合并 manifest 前逐架构执行 Trivy 漏洞门禁，并生成 BuildKit SBOM/provenance。合并后由 `.github/actions/publish-container-evidence` 解析不可变 digest、生成 SPDX SBOM、执行 Cosign keyless 签名与验证、发布 GitHub provenance，并保存 90 天 release evidence。第三方 Actions 固定到 commit SHA，由 Dependabot 提交更新。

`main` 分支用于持续集成，`v*` 标签用于正式版本镜像发布。
