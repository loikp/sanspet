# SansPet

Undertale 风格的 Android AI 桌宠。V1 骨架版本。

## 这份代码怎么变成 APK

不需要在电脑上安装 Android SDK，用 GitHub Actions 云端打包。

### 1. 上传到 GitHub

1. 打开 GitHub Desktop
2. File -> Add local repository
3. 选择本目录 `D:\codex\sanspet`
4. 如果提示不是仓库，点 "create a repository"
5. 填名字 `sanspet`，点 Create
6. 右上角 Publish repository（Public 免费额度无限）

### 2. 触发打包

方式一（推荐）：

1. 打开仓库页面
2. 点 Actions 标签
3. 左侧选 "Build APK"
4. 点 "Run workflow" -> Run

方式二：打 tag 自动打包，并生成 Release 下载链接

```bash
git tag v0.1.0
git push origin v0.1.0
```

### 3. 下载 APK

- Actions -> 点开这次构建 -> 页面底部 Artifacts -> 下载 `SansPet-APK`
- 如果是打了 tag，还会在 Releases 里生成一个带 APK 的页面，可以直接把链接发给别人

### 4. 安装

1. 手机设置里允许安装未知来源应用
2. 安装 APK
3. 打开应用，授予悬浮窗权限
4. 点"开启桌宠"
5. 在设置里填 API 地址、Key、模型

## 说明

- 第一次打包会下载依赖，可能需要 5-10 分钟
- 签名：当前用 debug 签名，方便先跑通；正式发版前要换成 release keystore
- 桌面悬浮窗需要 `SYSTEM_ALERT_WINDOW` 权限
- 网络请求在原生层发起，不走 WebView，避免跨域问题
