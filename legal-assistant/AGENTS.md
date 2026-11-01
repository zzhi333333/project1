# AGENTS.md —— 法律咨询助手（给 AI 编码助手的项目说明）

> 本文件供 AI 编码助手（ZCode/Claude Code 等）在新会话中快速恢复项目上下文。
> 完整架构与坑点清单见 README.md；本文件只写"上手必需"的信息。

## 项目是什么

零依赖、可离线运行的法律咨询 Web 应用（纯前端 + 可选本地代理），覆盖：
- **领域**：劳动法 · 公司法 · 专利法 · 国际经贸合规（美国/欧盟贸易法规）——经 `js/registry.js` 领域注册表管理
- **页签**：💬智能咨询（多会话历史/归档/AI对话/语音）· 🧭深度分析（规则报告/AI可核验）· 📑合同审查 · 📚法条 · 🧮工具(5个) · 🗂️案例 · 📖讲堂
- **核心差异化**：AI 输出的可核验机制（法条引用/数字断言双核验，防杜撰）

## 路径与启动

- 仓库根：`D:\projects\project1`（GitHub: zzhi333333/project1，含用户其他项目，**勿整目录覆盖**）
- 本应用：`D:\projects\project1\legal-assistant\`
- 启动：双击 `启动.bat`（检测 Node → `node server.js` 全功能联网模式；否则 serve.ps1 离线静态）
- Node v26（`C:\Program Files\nodejs\node.exe`）；Git 在 `C:\Program Files\Git\cmd\git.exe`

## 加新法律领域（配置化架构）

新建 `js/domains/<id>.js` 调用：
```js
window.DomainRegistry.registerDomain({
  id, name, icon, color, keywords: [...分类词],
  laws: [{id, domain, law, lawShort, article, title, tags, text, note, url?}],
  scenarios: [{id, domain, icon, name, keywords, desc, questions, result}],
  faq: [{domain, q, a, tags}], cases: [...], guiding: [...]
});
```
+ index.html 加一行 script 标签。其余（筛选/讲堂分组/分类/推荐）自动识别。
- 国际内容（如 patent-intl.js）用**增量注册**：id 复用既有领域，条目可带官方 url
- 内容红线：只写稳定制度框架；清单/税率等易变信息标注"以官方最新为准"；每条附官方链接

## 必须知道的坑

1. **flk.npc.gov.cn 2026 新版 SPA 接口**：搜索 `POST /law-search/search/list`（需 X-Requested-With 头）；正文从官方 docx 提取（server.js 内置零依赖 ZIP 解析器 `/api/flk/text`）；上游间歇不稳定（405/系统异常/超时），前端均有降级
2. **用户的移动版副本同步**：用户会从另一副本推"移动版同步"提交，曾两次回退网页版功能——push 被拒时先 fetch 检查，用 merge 恢复，**勿 force push**
3. **PowerShell 5.1**：.ps1 含中文必须 ASCII 化（无 BOM UTF-8 按 GBK 读会吞换行）；git fetch/push 进程退出阶段可能挂起（refs 实际已写入），重试即可
4. **重构前 grep 调用点**：曾有 lawChips 被删导致结果卡静默消失

## 状态与惯例

- 对话历史/AI设置/日历存浏览器 localStorage；设置弹窗有 JSON 导出/导入
- 每次改动：`git add -A && commit && push origin main`（网络波动多试几次）
- 免责声明必须保留（页脚+各结果卡一行版）
