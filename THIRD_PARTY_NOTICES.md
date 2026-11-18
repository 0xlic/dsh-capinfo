# Bundled chart library

The generated client bundle includes Apache ECharts 6.0.0 and ZRender 6.0.0, tree-shaken to the chart types/components used by this plugin. They are locally compiled by esbuild; the plugin does not fetch chart code from a CDN. Upstream code is bundled/minified, not hand-copied into the plugin's chart implementation.

- Apache ECharts: Apache-2.0; see `vendor/echarts.LICENSE.txt` and `vendor/echarts.NOTICE.txt`.
- ECharts' embedded d3 utilities: BSD-3-Clause; see `vendor/d3.LICENSE.txt`.
- ZRender: BSD-3-Clause; see `vendor/zrender.LICENSE.txt`.
- tslib: Microsoft permission notice reproduced in `client.js.LEGAL.txt`.

Apache ECharts
Copyright 2017-2025 The Apache Software Foundation

This product includes software developed at The Apache Software Foundation (https://www.apache.org/).
