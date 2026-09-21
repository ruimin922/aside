# 维护与发布

## 日常迭代

1. 在 `movie-notes-extension/` 修改正式插件；`dev/agentation/` 是独立的本地标注预览。
2. 运行 `npm ci`（首次）、`npm test`、`npm run package`。
3. Chrome 加载 `movie-notes-extension/`，修改后重新加载扩展并刷新视频页。验收快捷记录、草稿、记录库、截图及实际账号相关功能。
4. 将代码与变更说明提交到 GitHub。提交会触发自动回归与打包检查。

## 发版

1. 同步更新 `manifest.json` 的版本和 `content.js` 顶部的版本标记，新增 `docs/RELEASE-版本.md`。
2. 通过本地检查和真实 Chrome 验收后，提交并推送代码。
3. 创建与版本一致的 `v版本` 标签并推送；GitHub Actions 检查通过后发布 Release，包含 ZIP 与 SHA-256。
4. Release 中的源码归档包含整个项目；给体验者下载的是 `aside-v版本.zip`。
5. Chrome 应用商店上传必须使用 `aside-v版本-chrome-web-store.zip`，在已有「旁白」条目的「软件包」中上传更新，不要新建条目。此包自动移除 manifest 的 `key`；普通 ZIP 与源码仍保留该字段以固定本地开发 ID。两种包其余运行文件一致，由打包脚本校验。

GitHub 发布不会自动更新 Chrome 中的开发者模式插件。正式用户的自动更新通过 Chrome Web Store；可以在以后接入商店上传 API，但仍需遵守审核与发布流程。

## 仓库内容

正式源码、数据库迁移、测试、设计说明、产品截图和开发预览可以提交。签名私钥、账号凭证、用户笔记、个人配置、旧包和本地备份不提交。`manifest.json` 中的 `key` 是公开扩展身份键，应保持不变；根目录 `.pem` 是私钥，已忽略。

项目目前保留已有 Supabase 客户端公开配置；它不是服务端管理员密钥。独立部署需使用自己的 Supabase 项目，执行数据库迁移并正确配置 RLS、OAuth 回调。不要把 `service_role` 或服务端 Secret 放进前端。

## 面试展示

从 README 展示问题、使用场景和完整记录流程，再展示设计取舍与真实的迭代记录。区分已实现、已本地验证和已上线的能力；不以回归测试代替真实登录、同步和线上使用证据。仓库首次提交是当前版本的源码快照，不补造此前的提交历史。
