# Wayline

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![CI](https://github.com/NextVariable/wayline/actions/workflows/ci.yml/badge.svg)](https://github.com/NextVariable/wayline/actions/workflows/ci.yml)

**把行程可视化。**

Wayline 为经常出差的人把日历、地图和已订交通住宿放在一起。打开就能看见今天去哪、两场会之间怎么走、时间够不够。跨城日程可以归成一趟出差，已确认的订单和未安排的部分一目了然。

[本地运行](#本地运行) · [项目文档](docs/README.md) · [贡献指南](CONTRIBUTING.md) · [发布验收](docs/release-readiness.md)

## 当前功能

| 功能 | 使用方式 |
| --- | --- |
| 今天的地图 | Google 日历或 `.ics` 导入的日程上图。逐段切换步行、地铁公交、打车或自驾，查看耗时与迟到风险，再打开地图导航。 |
| 一趟出差 | 按日期与常驻城市归组外地日程。支持拆分、合并和查看全程地图。 |
| 交通与住宿 | 汇总日历及受支持的 Gmail 订单。交通未订时可查询参考班次，住宿未订时可查看推荐区域。 |
| 地点与足迹 | 搜索、收藏和按城市查看地点，导入轨迹或补记到访。资料可以备份并恢复到独立空间。 |

**当前阶段为受邀内测候选。** Google 日历和 Gmail 使用只读授权。铁路时刻和道路耗时供参考，航班查询试点覆盖深圳往返上海。生产环境和手机真机的验收进度见[发布验收](docs/release-readiness.md)。

## 本地运行

准备 **Node.js 22** 和 npm。

```bash
git clone https://github.com/NextVariable/wayline.git
cd wayline
npm ci
npm run build
npm start
```

打开 [http://127.0.0.1:8787](http://127.0.0.1:8787/)。游客空间可用于体验基础界面和导入功能。实时地图、道路及 Google 集成需要相应配置。

配置从 [`.env.example`](.env.example) 复制到 `.env.local`。Google 本机回调路径为 `/api/auth/google/callback` 和 `/api/calendar/google/callback`。开发模式、凭证边界和可选供应服务见[开发与配置](docs/development.md)。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| [`src/`](src/) | React 网页、地图界面、产品逻辑与自动测试 |
| [`server/`](server/) | Node 同源服务、账号与同步、地图及交通供应接入 |
| [`shared/`](shared/) | 跨客户端和服务端共用的解析规则 |
| [`public/`](public/) · [`tests/fixtures/`](tests/fixtures/) | 静态资源与隔离验收样本 |
| [`docs/`](docs/README.md) | 当前设计、运行说明与历史验收 |
| [`ios/`](ios/) · [`android/`](android/) | Capacitor 原生工程。网站是当前发布主线。 |

修改后运行 `npm test` 和 `npm run build`。

参见[更新记录](CHANGELOG.md)、[安全报告](SECURITY.md)和[行为准则](CODE_OF_CONDUCT.md)。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。第三方代码与数据的来源及许可见[第三方声明](THIRD_PARTY_NOTICES.md)。
