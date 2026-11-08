# My Mail 标志

一个字母 M：两条竖边 + 一道深 V。深 V 同时是信封翻盖（flap），所以单字母也读作「信」。
配色取自应用自身的 token：主色 `#4b5bd6`（`--accent`）的亮/暗端，墨色 `#1d1c1a`（`--text`），纸白 `#fbfaf8`（`--bg`）。

| 文件 | 用途 |
|---|---|
| `logo.svg` | 主标，1024 画布，靛蓝渐变方块 + 白字 |
| `logo-mono.svg` | 纸白方块 + 墨字，用于浅色/印刷场景 |
| `logo-dark.svg` | 深色模式（近墨底 + `--acc-d` 字） |
| `logo-mark.svg` | 纯字形，透明底，用于列表空态、favicon、邮件头 |
| `icon-*.png` | 16 / 32 / 128 / 512 位图 |
| `brand-sheet.png` | 品牌展示页（由 `preview.html` 渲染） |

应用图标由 `resources/icon.png`（1024×1024，带 alpha）经 `mygo.config.ts` 的 `icon` 字段打进 `.icns`。

菜单栏图标（`backend/desktop.go` 的 `trayImage`）用同一条字形路径在 32×32 的单色模板图里绘制，只保留 alpha：macOS 按菜单栏明暗自动着色，因此不放圆角蓝底（实心方块在模板图里会变成一整块黑）。改字形时需同步这里的常量与下表的坐标。

## 几何

- 画布 1024，方块圆角 230（≈ Apple squircle）
- 字形：竖边 x=302 / 722，字身高 380（y=322→702），V 底 y=632，笔画 94，`stroke-linecap: round`
- 渐变：`#5a69e2 → #3945ba`，方向 (0,0) → (0.35,1)

## 重新生成位图

```
swiftc -O raster.swift -o /tmp/raster        # NSImage 直接栅格化 SVG，保留 alpha
./raster logo.svg ../../resources/icon.png 1024
```
