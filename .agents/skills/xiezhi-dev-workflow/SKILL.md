---
name: xiezhi-dev-workflow
description: 獬小豸法律助手双端项目的开发工作流程——门禁纪律、双端同步、出包协作、仿真测试与踩坑规避。在这个仓库（legal-assistant / legal-assistant mobile）做任何 js/css/html/java 改动、双端同步、门禁验证、出包协作、IAB 仿真测试、安全加固时必须使用——即使用户只说「改一下」「验证一下」「出个包」「pull 验证」。
---

# 獬小豸双端项目工作流程

零依赖红线（不得引入任何第三方库/CDN/npm 包）贯穿一切改动。所有流程围绕**四件门禁**与**双端一致**展开。

## 项目结构速览

- `legal-assistant/`：web 端（纯 Web，零依赖，CSP 无内联脚本）
- `legal-assistant mobile/`：Android WebView 壳（`app/src/main/`，www 资产为 web 的移动适配副本）
- 双机协作：**本机=验证/实施/推送**，**对侧=出包（release.js，密钥在对侧）**。对侧出包后本机 `git pull` → `verify-apk` 收口。
- 数据层：localStorage（store.js 键注册表），flk 缓存在 server.js 内存缓存。

## 改动纪律（写代码前）

1. **同源文件**（sync-www.js 清单，43 个）：web 是唯一事实源，改完 web → `cp` 到 mobile 同路径，`node sync-www.js` 必须报「完全一致」。
2. **分支文件**（BRANCH_FILES 4 个：ai/analysis/main/online）：两端各自合法差异（AI 走桥/布局/桥函数），**禁止整文件 cp**——先 diff 再增量 patch（Edit 工具精准插入）。差异受 check.js 函数集嗅探约束：main.js 减重缺失走 `MAIN_MOBILE_MISSING` 白名单、ai.js 走桥独有走 `AI_MOBILE_ONLY`、online.js 桥函数走 `ONLINE_MOBILE_EXTRA`——白名单外差异一律 bad。
3. **新增 js 文件**默认视为同源（自动入校验）；新增领域用 `node tools/new-domain.js <域名> <显示名> <短名> <emoji>` 脚手架（生成骨架+自动接线），不要手写 500 行。
4. **修改 js/css 后**，跑 `node check.js && node test.js` 必须全绿再提交。命令**不接管道**（`| tail` 会吞 exit code，曾致失败版误推）。

## 四件门禁（判读方法）

| 命令 | 作用 | 失败时看什么 |
|---|---|---|
| `node check.js` | 37 项静态门禁（版本链九处对齐/分支嗅探/CSS 完整性/节假日 bad/统计自适应） | 「版本链」失败=漏改某处版本号；「双端漂移」=同源文件内容或**行尾**不一致 |
| `node test.js` | 159 项断言（含**全场景 776 组合枚举**：每场景×每选项组合跑 result 验四字段+法条零死链） | 新领域/新场景必须先过这条 |
| `node sync-www.js` | 双端 js 一致性（含**反向孤儿校验**+script 清单比对） | `extra`=移动端孤儿文件；`script-missing`=index 漏挂载 |
| `node tools/verify-apk.js` | **出包后必跑**：包内 assets/www 与源码逐文件比对（出包快照落后已三次复发，此脚本收口） | 「实质不一致」若源码在出包后有新改动=待出下一版，属预期；源码无改动则禁止发布 |

## 高频踩坑清单（症状 → 根因 → 正确做法）

### 工具链

- **sed / node replace 静默 0 命中**（已 5+ 次发作）：锚点里 CRLF/空格数/注释文字与实际不符时 replace 不报错直接跳过。→ **复杂替换一律用 Edit 工具**（old_string 从 Read 精确复制）；用脚本时先 `grep` 验证命中数再写回。
- **bash 双引号里 `\n` 转义炸 JS 字面量**（3 次发作）：`node -e "...\\n..."` 写出的文件里 `\n` 变真换行，字符串字面量被拆断。→ **多行注入用 Write 工具写独立脚本文件再 `node 执行`**，不走 bash 内联。
- **git add 多 pathspec 一处不匹配 → 整条失败**，后续 commit 只进了部分文件。→ 已跟踪文件用 `git add -u`，新文件分组 add。
- **门禁命令接管道吞 exit code**：`node check.js | tail -2` 后 `&&` 判断的是 tail 的退出码。→ 门禁命令裸跑或 `; echo "exit=$?"` 单独看。

### 文件与行尾

- **CRLF/LF 双态**：仓库 `core.autocrlf=true`（索引一律 LF），工作树多为 CRLF。两类坑：①`sed -i` 把工作树 CRLF 写成 LF——git status 语义干净但 check 按字节比较报「双端漂移」→ 修法 `rm 文件 && git checkout -- 文件`（单纯 checkout 不触发重转换）；②node -e 脚本的 LF 锚在 CRLF 文件静默 miss → 锚点写 `\r\n` 或用 Read 确认 `cat -A`。
- **APK 包内比对必须 `diff --strip-trailing-cr`**：包内 LF vs 工作树 CRLF 会全部误报 DIFF；同时 bash 循环里 `2>/dev/null` 会吞 diff 路径解析错误造成「全 OK」假象——用正斜杠 `/d/...` 路径并统计 `^[<>]` 行数。

### 运行时与仿真

- **CSS 启发式缓存**（3 次发作）：改 style.css 后浏览器拿到旧版，视觉验证出现「旧样式假象」。→ 验证前 `link.href = href.split("?")[0] + "?v=" + Date.now()` 强刷。
- **IAB 仿真四坑**：①click actionability 对高频循环点击连续抖动超时（同 locator 两轮全断）→ 改 `evaluate` 原生 `.click()`（监听器绑在目标元素上时等价）；②`evaluate` 只收**单表达式**——多语句分号串报 `Unexpected token ';'`，包 IIFE；③带呼吸/位移动画的元素（nav-breathe）让 Playwright stable 检查永不满足=永久超时；④截图超时重试即恢复。
- **localStorage ≠ 内存态**：模块闭包变量是加载时快照（applock/armTimeout 类运行态拦截），改 localStorage 验证运行态行为无效——运行态逻辑靠代码审查+可达路径实测；配置类改动（legal-ai 等）必须 reload 才生效。
- **验证脚本一次一气呵成**：写配置→reload→stub→发问拆步骤时，中间任何清理（removeItem）都会打翻后续步骤——每轮测试结束才清理。

### 数据与安全

- **出包快照落后**：对侧出包时点之后合入的改动不在包内（N2 连续两轮/检查更新改造两次）——出包后 verify-apk 报「实质不一致」属预期（源码领先包），下次出包自然带上。
- **运行态拦截不能改 localStorage 验证**：闭包变量是加载快照。纵深防御分支（如 change-old 冷却）按代码审查+同 handler 可达路径实测覆盖。
- **安全基线**（安全五件已落地，改动时不得回退）：`allowBackup=false`、原生桥 URL 白名单（ALLOWED_HOSTS 13 域 https + localhost http 豁免 Ollama——**新增 AI provider 须同步白名单**）、esc 全部为完整版（含 `&quot;`，新增文件用 `tools/new-domain.js` 或复制 ui.js 版）、`RECORD_AUDIO` 已移除勿复加。
- **应用锁 ≠ 数据加密**：PIN（4-6 位）只挡 UI 入口，adb pull 后数据明文。若未来做加密，密钥必须 PBKDF2 高迭代派生（≥10 万次），不能直接由 PIN 派生。

## 出包协作流程

**本机实施后**：check/test/sync-www 全绿 → commit（信息按实测写，含失败与自纠记录）→ push → 通知对侧。
**对侧出包后**：pull → `node check.js` + `node test.js` + `node sync-www.js` → `cd legal-assistant mobile && node tools/verify-apk.js` → 出真机回归清单（8 provider 流式/新功能路径）。
**verify-apk 判读**：`实质不一致`=出包后源码有新改动（预期）或快照落后（禁发布）；`仅行尾差异`/`二进制重编码等价`（长度相等）不算漂移。
**版本链**：九处对齐（manifest/build.bat/双端 app-ver/移动README/FEATURES/MANUAL/双端 version.js）——check 会抓，手工勿改单处。

## 长期决策记录（避免反复重议）

- **缓行**：IndexedDB 迁移（同步 API 假设深+迁移风险>收益，除非实测卡顿）· 首屏懒加载（file:// 无网络瓶颈+破坏 check 静态加载模型）· WebViewAssetLoader（源变化致 localStorage 全丢）· 地方标准速查工具（31 省数据维护成本）· 大文件拆分（未到非拆不可）。
- **已跳过待重启**：法条热更新（前置=CSP 通道决策+数据包托管点+移动端走桥下载）、PWA（前置=部署形态决策：私有仓库不能公开 Pages）。
- **红线**：獬豸图标/品牌资产用户原稿禁派生；`RECORD_AUDIO` 勿复加；AI 输出禁伪精确胜诉概率（用「有利/不利因素+风险等级」）。
