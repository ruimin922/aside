# 旁白的 Agentation 本地标注

在项目目录运行 `npm run dev:agentation`，然后打开：

- 记录库：http://127.0.0.1:4173/movie-notes-extension/panel.html
- 悬浮球 / 快速记录 / 可缩放记录库：http://127.0.0.1:4173/__agentation/scene.html
- PWA：http://127.0.0.1:4173/movie-notes-pwa/index.html

点击页面右下角的 Agentation 按钮，点选元素、写下修改意见并添加批注。回到本项目的 Codex 任务，发送「读取旁白的 Agentation 批注并修改」。Codex 首次添加 MCP 后需要重启；无需每个项目重复安装 MCP。

打开「使用帮助」后同样可以点击 Agentation 标注弹窗内容。开发工具栏会随原生弹窗进入浏览器顶层；按 Esc 先退出标注，再按 Esc 关闭帮助。此适配仅用于本地预览。

工具栏连接 `http://localhost:4747`。启动脚本优先复用已有服务；没有服务时启动官方本地 HTTP 服务。批注保存在官方 `~/.agentation/store.db` 中，供 Codex 的全局 Agentation MCP 读取。关闭预览会同时停止由它启动的服务；重新运行命令即可恢复。

记录库直接加载 `movie-notes-extension/` 的当前 HTML、CSS 和 JavaScript；修改这些文件后刷新即可。Chrome API 使用本地适配层，示例笔记保存在预览地址的 localStorage，和已安装扩展的真实记录隔离。登录、真实视频捕获等扩展能力不在预览中执行；这不是 Chrome 扩展完整功能测试。

PWA 使用原有页面和登录逻辑，登录后会访问原有账号数据；开发预览不启用离线缓存。需要查看已登录页面时由用户在预览中自行登录。

Agentation 和 React 仅由此开发服务器注入；正式扩展和 PWA 的源码入口、发布包均不包含工具栏。不需要将旁白改写为 React。服务只提供前端目录的静态资源，不提供项目根目录、密钥、SQL 或压缩包。默认预览端口为 4173，可通过 `ASIDE_PREVIEW_PORT` 改变；MCP 保持使用全局配置的 4747。

官方说明：https://www.agentation.com/install

观看现场预览使用实时 Canvas 视频，并直接加载当前 content.js；开发路由替换站点识别，并在标注工具工作时暂停窗口的拖动、点击外部关闭和快捷键处理，正式 content.js 不增加本地站点权限。点悬浮球或按 Option+N 快速记录，Option+L 打开记录库；窗口顶部拖动位置，边缘与下方两个角缩放，聚焦下角后也可用方向键调整。时间、字幕、截图、草稿与保存都可在示例页面操作，保存调用原有本地存储模块。此预览不执行真实账号登录或外部导出。

标注悬浮球：先开启右下角 Agentation，再点击悬浮球。标注快速记录：先打开快速记录，再开启 Agentation。工具栏与批注框始终显示在浮层上方；输入和提交批注不会关闭笔记或丢失草稿。退出标注后恢复正常操作。
