import test from 'node:test';
import assert from 'node:assert/strict';
import {createUsageChartOption, compactAxis, describeUsageDay} from '../usage-chart-options.js';

const labels = {tokens: 'Token 用量', cost: '费用', unitCost: '单位成本', missing: '暂无数据', description: 'Token 柱状图'};
const theme = {text: '#111111', muted: '#666666', background: '#ffffff', border: '#eeeeee', guide: '#d1d5db', tokens: '#60A5FA', tokensTop: '#80B7FA', tokensActive: '#3B82F6', font: 'sans-serif'};
const days = [
  {date: '2026-11-11', amount: null, totalTokens: null},
  {date: '2026-11-12', amount: 0, totalTokens: 0},
  {date: '2026-11-13', amount: 1.3232272, totalTokens: 213750000},
];
test('only Token bars, a single Token axis and a single legend entry are rendered', () => {
  const option = createUsageChartOption(days, labels, theme);
  assert.equal(option.series.length, 1);
  const [bars] = option.series;
  assert.equal(bars.type, 'bar');
  assert.equal(bars.yAxisIndex, 0);
  assert.equal(option.yAxis.type, 'value');
  assert.deepEqual(option.xAxis.data, days.map(day => day.date));
  assert.deepEqual(bars.data, [0, 0, 213750000]);
  assert.equal(option.legend.top, 0);
  assert.equal(option.legend.left, option.grid.left);
  assert.equal(option.grid.outerBoundsMode, 'same');
  assert.equal(option.grid.outerBoundsContain, 'axisLabel');
  assert.ok(option.grid.bottom < 20);
  assert.deepEqual(option.legend.data.map(item => item.name), [labels.tokens]);
  assert.equal(option.legend.data[0].itemStyle.color, theme.tokens);
  assert.deepEqual(bars.itemStyle.borderRadius, [4, 4, 0, 0]);
  assert.deepEqual(bars.itemStyle.color.colorStops, [{offset: 0, color: theme.tokensTop}, {offset: 1, color: theme.tokens}]);
});

test('the Token axis reserves headroom and shows four evenly spaced grid bands', () => {
  for (const totalTokens of [0, 1, 8, 105, 28500000, Number.MAX_SAFE_INTEGER]) {
    const {yAxis: axis} = createUsageChartOption([{date: '2026-11-13', amount: 1e12, totalTokens}], labels, theme);
    assert.ok(Number.isInteger(axis.interval));
    assert.equal(axis.splitLine.lineStyle.type, 'dashed');
    assert.equal(axis.min, 0);
    assert.equal(axis.max / axis.interval, 4);
    assert.ok(axis.max > totalTokens * 1.149);
    assert.ok(Number.isFinite(axis.max));
    const ticks = Array.from({length: 5}, (_, i) => axis.axisLabel.formatter(i * axis.interval));
    assert.equal(new Set(ticks).size, 5);
    assert.equal(axis.axisLabel.fontSize, 12);
    assert.equal(axis.axisLabel.color, theme.muted);
  }
});

test('date spacing scales with width and zero-height bars retain their daily tooltip', () => {
  const month = Object.freeze(Array.from({length: 30}, (_, index) => Object.freeze({
    date: `2026-11-${String(index + 1).padStart(2, '0')}`, amount: index === 29 ? 2.5 : null, totalTokens: null,
  })));
  const option = createUsageChartOption(month, labels, theme, 800);
  const narrow = createUsageChartOption(month, labels, theme, 280);
  assert.ok(option.xAxis.axisLabel.interval >= 2);
  assert.ok(narrow.xAxis.axisLabel.interval > option.xAxis.axisLabel.interval);
  assert.equal(narrow.xAxis.axisLabel.hideOverlap, true);
  assert.equal(narrow.xAxis.axisLabel.fontSize, 12);
  assert.equal(narrow.xAxis.axisLabel.formatter('2026-11-18'), '11-18');
  assert.equal(option.xAxis.triggerEvent, false);
  assert.equal(option.xAxis.axisPointer.label.show, false);
  assert.equal(option.series[0].barMinHeight, 0);
  assert.equal(option.series[0].emphasis.itemStyle.color, theme.tokensActive);
  assert.deepEqual(option.series[0].data, Array(30).fill(0));
  assert.match(option.tooltip.formatter([{dataIndex: 29}]), /¥2\.50/);
  assert.equal(month[0].amount, null);
  assert.equal(month[0].totalTokens, null);
});

test('axis tooltip is confined and shows a light guide, compact Token values and CNY', () => {
  const {tooltip} = createUsageChartOption(days, labels, theme);
  assert.equal(tooltip.trigger, 'axis');
  assert.equal(tooltip.confine, true);
  assert.equal(tooltip.renderMode, 'html');
  assert.equal(tooltip.borderRadius, 8);
  assert.equal(tooltip.backgroundColor, theme.background);
  assert.equal(tooltip.className, 'capinfo-echarts-tooltip');
  assert.match(tooltip.extraCssText, /width:max-content;max-width:788px/);
  assert.match(createUsageChartOption(days, labels, theme, 240).tooltip.extraCssText, /max-width:228px/);
  assert.match(tooltip.extraCssText, /box-shadow:/);
  assert.equal(tooltip.position, undefined, 'ECharts owns collision detection and placement');
  assert.equal(tooltip.axisPointer.axis, 'x');
  assert.equal(tooltip.axisPointer.type, 'line');
  assert.equal(tooltip.axisPointer.lineStyle.color, theme.guide);
  assert.equal(tooltip.axisPointer.label.show, false);
  for (const i of [0, 1]) {
    const html = tooltip.formatter([{dataIndex: i}]);
    assert.match(html, /¥0\.00/);
    assert.match(html, />0 Token<\/span>/);
    assert.doesNotMatch(html, /暂无数据/);
  }
  const actual = tooltip.formatter([{dataIndex: 2}]);
  assert.match(actual, /2026-11-13/);
  assert.match(actual, /¥1\.32/);
  assert.match(actual, /213\.75M Token/);
  assert.match(actual, /&lt;¥0\.01 \/ 1M Token/);
  assert.ok(actual.indexOf(labels.cost) < actual.indexOf(labels.tokens));
  assert.ok(actual.indexOf(labels.tokens) < actual.indexOf(labels.unitCost));
  assert.equal(tooltip.formatter([]), '');
  assert.equal(tooltip.formatter([{dataIndex: 999}]), '');
});

test('tooltip escapes HTML and displays invalid inputs as zero without mutating them', () => {
  const badDay = Object.freeze({date: '<img src=x>', amount: -1, totalTokens: NaN});
  const option = createUsageChartOption([badDay], {...labels, cost: '<script>x</script>'}, theme);
  assert.deepEqual(option.series[0].data, [0]);
  const html = option.tooltip.formatter([{dataIndex: 0}]);
  assert.doesNotMatch(html, /<img|<script>/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.ok(html.indexOf('&lt;script&gt;') < html.indexOf(labels.tokens));
});

test('dark host colors apply to tooltip, grid and axis text without overwriting the series palette', () => {
  const dark = {...theme, background: '#202124', text: '#f2f3f4', muted: '#b2b5ba', border: '#434446'};
  const option = createUsageChartOption(days, labels, dark);
  assert.equal(option.tooltip.backgroundColor, dark.background);
  assert.equal(option.tooltip.textStyle.color, dark.text);
  assert.equal(option.yAxis.splitLine.lineStyle.color, dark.border);
  assert.equal(option.yAxis.axisLabel.color, dark.muted);
  assert.equal(option.legend.textStyle.color, dark.muted);
});

test('tooltip units work across ranges while series values remain exact', () => {
  for (const [totalTokens, expected] of [[0, '0'], [999, '999'], [1520, '1.52K'], [999999, '1M'], [1500000, '1.5M'],
    [5946148, '5.95M'], [12300000, '12.3M'], [1234567890, '1.23B'], [Number.MAX_SAFE_INTEGER, '9007.2T']]) {
    const option = createUsageChartOption([{date: '2026-11-13', amount: 12.5, totalTokens}], labels, theme);
    const html = option.tooltip.formatter([{dataIndex: 0}]);
    assert.ok(html.includes(`>${expected} Token</span>`));
    assert.ok(html.includes('¥12.50'));
    assert.equal(option.series[0].data[0], totalTokens);
  }
  assert.equal(compactAxis(226200), '226.2K');
});

test('keyboard selection announces exact values and the same missing-sample zeros as the chart', () => {
  assert.equal(describeUsageDay(days[2], labels), '2026-11-13; 费用: ¥1.32; Token: 213750000; 单位成本: <¥0.01 / 1M Token');
  assert.equal(describeUsageDay(days[1], labels), '2026-11-12; 费用: ¥0.00; Token: 0; 单位成本: 暂无数据');
  assert.equal(describeUsageDay(days[0], labels), '2026-11-11; 费用: ¥0.00; Token: 0; 单位成本: 暂无数据');
  assert.equal(describeUsageDay(undefined, labels), '');
});

test('cost per million uses raw daily samples and distinguishes zero from missing data', () => {
  for (const [amount, totalTokens, expected] of [
    [12.5, 2500000, '¥5.00 / 1M Token'],
    [0.0004, 1000, '¥0.40 / 1M Token'],
    [7.5, 1504999, '¥4.98 / 1M Token'],
    [0, 2500000, '¥0.00 / 1M Token'],
    [null, 2500000, '—'],
    [12.5, null, '—'],
    [12.5, 0, '—'],
  ]) {
    const day = Object.freeze({date: '2026-11-13', amount, totalTokens});
    const {tooltip} = createUsageChartOption([day], labels, theme);
    assert.ok(tooltip.formatter([{dataIndex: 0}]).includes(`>${expected}</span>`));
  }
});
