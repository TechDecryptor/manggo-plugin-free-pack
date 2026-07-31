# Manggo 免费翻译服务包

为 Manggo 提供无需账号、API Key 或额外配置的翻译服务。

## 服务

| 服务 | 结果类型 | 说明 |
| --- | --- | --- |
| 腾讯交互翻译 | 文本 | 使用腾讯交互翻译网页接口 |
| 有道翻译 | 词典 / 文本 | 单词优先返回词典结果，其他内容返回文本译文 |
| Bing 翻译 | 文本 | 使用 Microsoft Edge 翻译接口；短期令牌保存在插件缓存目录，浏览器版本失效时会自动更新后重试 |
| Google 翻译 | 文本 | 使用 Google Translate 网页接口 |

安装后即可在 Manggo 的翻译服务中启用，各服务的配置项均为空。

## 开发

运行测试：

```bash
bun test
```

打包插件：

```bash
bun run package
```

产物位于 `dist/com.TechDecryptor.manggo.free-pack.mplugin`。

这些免配置服务依赖公开网页接口，可能受到上游限流、地区网络或接口变更影响。
