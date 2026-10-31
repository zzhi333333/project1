# ⚖️ 法律咨询助手（Android 移动版）

把电脑版 `../legal-assistant/`（纯 Web 应用）封装为**安卓 APK 安装包**，并针对竖屏手机分辨率 **2780×1264**（≈460dp 宽、~2.75x 密度，兼容 360–480dp）重新设计了移动端 UI。**不改动原项目任何文件**，本目录完全独立。

- 包名：`com.zz333.legalassistant`，版本 `1.1`（versionCode 2）
- 系统要求：Android 8.0+（minSdk 26，targetSdk 34），竖屏锁定
- 产物：`dist/legal-assistant-mobile-v1.1.apk`（约 155KB）

## 🆕 v1.1 更新（跟随网页版大更新）

| 功能 | 移动端适配说明 |
|---|---|
| 领域注册表 | js/registry.js 兼容层随桌面版同步，以后扩域零改动 |
| 数据导出/导入 | App 内导出走**原生「另存为」选择器**（CREATE_DOCUMENT），导入走原生文件选择器 + confirm 弹窗 |
| 文书模板生成 | 结果卡「📄 生成文书」底部弹层，一键复制 |
| 时效倒计时 | 工具页第 5 个计算器，30 天内标红 |
| AI 停止/重试 | 「⏹ 停止」经原生桥断开 HTTP 连接（新增 cancel 通道）；失败显示「🔄 重试」 |
| 法条库 81 条 | laws-extra.js 随包内置 |
| 结果卡关联推荐 | FAQ 直达 + 指导性案例精读 |
| 全局搜索 + 首次引导 | 顶栏 🔍 底部弹层；首次打开三步引导（文案已适配手机布局） |
| 图标重绘 | Material You 风格（圆头笔画天平 + 渐变底），支持 Android 13+ 主题图标（monochrome） |

历史版本：`v1.0`（versionCode 1）见 git 记录。

## 📲 安装到手机

1. 把 `dist/legal-assistant-mobile-v1.1.apk` 传到手机（微信文件传输助手 / USB / 网盘均可）
2. 在手机上点开 APK，系统会提示「未知来源应用」——允许本来源安装即可；**已装 v1.0 可直接覆盖升级**（同一签名）
3. 打开「法律咨询助手」App，右上角 🤖 配置 AI 模型（推荐智谱 glm-4-flash，官方免费）

> 签名密钥固定在 `tools/debug.keystore`（密码 `legal123`）。**该密钥已加入 .gitignore、不会提交到仓库**——请在本地妥善备份（U盘/私有云各存一份），丢失后将无法覆盖安装升级（只能卸载重装）。**以后升级请保留该文件**。

## ✨ 与桌面版的功能对照

| 模块 | 移动版状态 | 说明 |
|---|---|---|
| 💬 智能咨询（21 场景决策树） | ✅ 完整 | 引擎与桌面版同源，全离线可用 |
| 🧭 深度分析（规则报告 + AI 可核验分析） | ✅ 完整 | 引用/数字双核验、严格模式重生成 |
| 🤖 AI 模型接入 | ✅ **改为 App 内直连** | 手机上没有本地代理，AI 请求经原生网络桥直连所选服务商（OpenAI 兼容协议 + SSE 流式），密钥仅存 App 私有存储 |
| 📚 法条检索 | ✅ 完整 | 本地知识库离线可用；联网模式经原生桥**直连 flk.npc.gov.cn 官方接口**（与桌面版 server.js 同一协议） |
| 🗂️ 案例检索 | ✅ 完整 | 指导案例精读/典型情景离线；在线检索经原生桥走公开搜索引擎定位 |
| 🧮 四个计算器 | ✅ 完整 | 纯本地计算 |
| 📖 知识讲堂 | ✅ 完整 | 15 篇 FAQ |
| 外链（Word/PDF 下载、原文页） | ✅ 交给系统浏览器/下载器打开 | WebView 内不承载外部页面 |

## 🖼️ 移动端 UI 重设计（2780×1264 竖屏）

- **顶栏**：☰ 菜单 + 品牌 + 联网状态 + AI 设置（56dp）
- **底部导航**：6 个页签（咨询/分析/法条/工具/案例/讲堂），单手可达
- **咨询页**：全屏对话流；对话记录与快捷场景收进**侧滑抽屉**；输入行贴底、键盘弹出自动压缩（adjustResize）
- **AI 设置**：改为**底部弹层**（bottom sheet）
- 触控目标 ≥42dp、正文 15.5px、输入框 16px；所有视图独立滚动、切换自动回顶

## 📁 目录结构

```
legal-assistant mobile/
├── app/src/main/
│   ├── AndroidManifest.xml
│   ├── java/com/zz333/legalassistant/MainActivity.java   # WebView 壳 + 原生网络桥
│   ├── assets/www/            # 移动端 Web 应用（可独立修改，重新打包即生效）
│   │   ├── index.html         # 竖屏重排（保留桌面版全部元素 ID，引擎 JS 原样复用）
│   │   ├── css/style.css      # 移动端全量样式
│   │   └── js/
│   │       ├── bridge.js      # ★ 新增：原生桥封装（Promise 化）
│   │       ├── mobile.js      # ★ 新增：抽屉/滚动/外链等移动交互
│   │       ├── ai.js          # ★ App 内经桥直连流式（桌面浏览器打开仍回退本地代理）
│   │       ├── online.js      # ★ App 内经桥直连 flk/案例检索（与 server.js 同协议）
│   │       └── （其余与桌面版同源：consult/analysis/agent/search/tools/history/main + data/*）
│   └── res/                   # 主题（靛蓝 + 深色状态栏）、自适应图标（天平）
├── build.bat / build.sh       # 一键构建（aapt → javac → d8 → zipalign → apksigner，无需 Gradle）
├── tools/debug.keystore       # 固定签名密钥（首次构建自动生成，勿删）
├── tools/StaticServer.java    # 开发预览用极简静态服务器
└── dist/                      # 构建产物
```

## 🔨 构建

工具链（本机已装好，其它机器按此准备）：

- JDK 17+：`C:\Users\zz333\android\jdk-17.0.20.1+1`（可用环境变量 `JAVA_HOME` 覆盖）
- Android SDK：`C:\Users\zz333\android\sdk`（build-tools 34.0.0 + platforms/android-34；可用 `ANDROID_SDK` 覆盖）

```cmd
:: Windows CMD 双击或执行
build.bat
```
```bash
# Git Bash
bash build.sh
```

产物：`dist/legal-assistant-mobile-v1.0.apk`（已自动 zipalign + 签名 + 校验）。

改版本号：`AndroidManifest.xml` 的 `versionCode/versionName` + 两个构建脚本里的 `VERSION_NAME`。

**改了 Web 界面后**：编辑 `app/src/main/assets/www/` 下文件 → 重新运行构建脚本即可，安卓代码无需重编。

## 🖥️ 桌面预览（不开手机也能调 UI）

```bash
cd "legal-assistant mobile"
"C:/Users/zz333/android/jdk-17.0.20.1+1/bin/java" -cp tools StaticServer "app/src/main/assets/www" 8930
# 浏览器打开 http://127.0.0.1:8930/__preview.html（460×1010 手机壳预览），或直接开 /index.html 后把窗口调成 460×1010
```

桌面浏览器里 `window.AndroidBridge` 不存在 → AI/联网自动回退为桌面逻辑（需 `node server.js`）；App 内则自动走原生桥，两端共用同一份代码。

## 🔌 原生桥协议（js/bridge.js ⇄ MainActivity.java）

```js
AndroidBridge.http(method, url, headersJson, body, cbId)              // → __brResolve(cbId, ok, {status, text})
AndroidBridge.stream(method, url, headersJson, body, cbId)            // SSE：__brChunk(cbId, chunk) × n → __brResolve
AndroidBridge.openUrl(url) / toast(msg) / version()
```

请求默认携带桌面 Chrome UA（flk / 搜索引擎友好），JS 侧可用同名请求头覆盖；支持 http（如本地 Ollama）与 https。

## ⚠️ 免责声明

同桌面版：本工具输出内容仅为基于公开法律信息的规则化参考，不构成法律意见或代理服务；法条以国家法律法规数据库现行有效文本为准，具体案件请咨询执业律师。
