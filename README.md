# 实时金价面板

一个基于 Electron + React + Vite 的桌面实时金价面板，适配 macOS 和 Windows。

## 功能

- 默认每 10 秒刷新浙商银行积存金价格
- 可在浙商银行 / 新浪两个 API 源之间切换
- 涨红色 `▲`，跌绿色 `▼`，持平灰色 `—`
- 无系统标题栏，窗口始终置顶，正常窗口全区域可拖拽
- 背景颜色和透明度实时可调，透明度为 `0` 时仅文字可见
- 设置窗口内可切换小窗 / 正常窗口，也可退出应用
- 小窗贴边显示当前金价，点击恢复正常窗口
- 可设置预警价，触发后窗口抖动三下
- 按 `S` 打开设置，按 `M` 切换小窗/正常窗口，按 `Ctrl/⌘+Q` 退出应用，设置即时生效，不需要保存

## 开发运行

```bash
npm install
npm run dev:desktop
```

也可以分开启动：

```bash
npm run dev
npm run electron
```

## 构建

```bash
npm run build
npm run dist
```

`electron-builder` 会根据当前系统构建对应平台包。macOS 下输出 `dmg/zip`，Windows 下输出 `nsis/portable`。

## 数据源

- 浙商银行积存金：`https://api.tangdouz.com/a/zsgold.php`
- 新浪行情：`https://hq.sinajs.cn/list=SGE_AU9999`

这些接口均由主进程请求，渲染进程只接收标准化后的行情数据。
