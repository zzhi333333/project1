# AGENTS.md —— 法律咨询助手（给 AI 编码助手的项目说明）

> 本文件供 AI 编码助手（ZCode/Claude Code 等）在新会话中快速恢复项目上下文。
> 完整架构与坑点清单见 README.md；本文件只写"上手必需"的信息。

## 项目是什么

零依赖、可离线运行的法律咨询 Web 应用（纯前端 + 可选本地代理），覆盖：
- **领域（大部门法）**：民法典 · 民事诉讼法 · 婚姻家事 · 劳动法 · 公司法 · 专利法 · 商标与著作权 · 国际经贸合规（美国/欧盟贸易法规）——经 `js/registry.js` 领域注册表管理
- **页签**：💬智能咨询（多会话历史/归档/AI对话/语音）· 🧭深度分析（规则报告/AI可核验）· 📑合同审查 · 📚法条 · 🧮工具(10个计算器+合规日历) · 🗂️案例 · 📖讲堂
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
5. **build.bat 管道构建崩坏**：脚本含中文 + 中途 `chcp 65001`，双击运行正常；从无控制台环境跑（Git Bash `cmd //c`、CI/计划任务）会在 chcp 处按错误字节偏移重解析，中文行被拆坏——**脚本化出包一律用 `node release.js <版本号>`（见下），勿再手做 ASCII 化临时副本**。另 javac `@argfile` 会吞引号内路径的反斜杠（已修：sources.txt 写正斜杠）
6. **移动版 js 不是网页版逐字节副本**：main.js 等含 `window.BRIDGE` 原生桥分支等移动特有代码——同步移动版 js 一律先 diff 再增量 patch（Edit 精准插入），**禁止整文件 cp 覆盖**；复制后 `git diff | grep "^-"` 确认删除行均为预期
7. **双端一致性必须机器校验**：`node sync-www.js`（check.js 第 8 节已集成）——同源清单 = 网页版 js 全集减去 5 个分支文件（ai/analysis/consult/main/online），**新增 js 默认视为同源**，漂移即失败（曾出现 esc 单端漏改报错、minsusong.js 移动端空文件、intake.js 移动版整体缺失）；`node sync-www.js --fix` 用网页版覆盖同源文件；同步后移动版需重新出包。5 个分支文件另受 check.js 第 11 节**函数集嗅探**（两端同名函数次数必须一致；online.js 移动端 BRIDGE 函数在白名单内，新增桥函数须同步更新白名单）
8. **版本对齐共 6 处，靠机器不靠人**：manifest versionCode/versionName、build.bat VERSION_NAME、移动 index.html app-ver、移动 README 版本行+产物名、FEATURES/MANUAL 版本头——check.js 第 10 节全链比对，不一致即 fail；`node release.js` 自动改齐（v3.2.5 曾漏改 app-ver 致 APK 自报旧版本）

## 移动版（Android APK，`legal-assistant mobile/` 目录名含空格）

- **架构**：Android WebView 壳（`com.zz333.legalassistant`，MainActivity.java，minSdk 26/targetSdk 34，竖屏 2780×1264 适配）内嵌一份**移动适配版网页副本**：`app/src/main/assets/www/`（网页版 js 的适配副本 + 两个移动专属文件 **mobile.js / bridge.js**；⚠️ 部分 js 含 `window.BRIDGE` 等移动特有分支，非逐字节相同——见坑点 6；index.html/css 为移动独立布局）
- **原生桥**（bridge.js ↔ MainActivity.java）：App 内**没有本地代理**——AI 请求/法条检索/搜索经原生网络直连（httpB64 二进制通道），语音走**原生 SpeechRecognizer**（v1.3.1，网页版 Web Speech API 的桥接替代），window.print 接管为系统 PrintManager
- **构建**：双击 `build.bat`（手动）；**脚本化出包一律 `node release.js <版本号> [提交说明]`**（在 `legal-assistant mobile/` 下运行）——版本 6 处自动对齐 → check/test 门禁 → 管道安全构建 → aapt + 包内资产双验证（零依赖 zip 读取 grep app-ver/修复特征）→ 提交推送（重试+rev-parse 机器验证，被拒即中止**绝不 force push**；`--dry` 只构建验证不改版不提交）→ `dist/legal-assistant-mobile-v<版本>.apk`（旧包自动清理）；签名密钥 `tools\debug.keystore`（密码 legal123，**已 gitignore——丢失后无法覆盖升级**）
- **同步工作流（网页版 → 移动版，高频操作）**：桌面版改动后，`node sync-www.js --fix` 同步同源 js；5 个分支文件（ai/analysis/consult/main/online）**先 diff 再增量 patch，禁止整文件 cp 覆盖**（⚠️ 曾两次整目录覆盖导致功能回退；index.html/css 为移动独立布局，只做对应手工编辑）→ `node release.js <新版本号>` 出 APK 并推送（版本对齐/构建/验证/推送由流水线完成）
- 移动版有自己的 README.md（功能对照表与安装说明）

## 状态与惯例

- 对话历史/AI设置/日历存浏览器 localStorage；设置弹窗有 JSON 导出/导入
- 每次改动：`git add -A && commit && push origin main`（网络波动多试几次）
- 提交前两跑：`node check.js`（结构+内容+双端一致性）、`node test.js`（10 计算器 22 项法律数值断言：2N 封顶/LPR 四倍/诉讼费累进/定金 20% 等——计算器是法律软件最不容出错的纯规则部分）
- 免责声明必须保留（页脚+各结果卡一行版）
