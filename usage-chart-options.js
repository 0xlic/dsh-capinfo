const escape = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const tokens = value => Number.isSafeInteger(value) && value >= 0;
const units = [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]];
const compact = (value, digits) => {
  for (const [index, [unit, divisor]] of units.entries()) {
    if (Math.abs(value) < divisor) continue;
    const rounded = Number((value / divisor).toFixed(digits));
    return index > 0 && Math.abs(rounded) >= 1000
      ? `${Math.sign(rounded)}${units[index - 1][0]}` : `${rounded}${unit}`;
  }
  return String(value);
};
export const compactAxis = value => compact(value, 1);

// Missing/invalid samples are zero only in the chart; stored billing data stays unchanged.
const chartAmount = value => amount(value) ? value : 0;
const chartTokens = value => tokens(value) ? value : 0;

const formatCost = value => `¥${chartAmount(value).toFixed(2)}`;
export function formatUnitCost(day) {
  if (!day || !amount(day.amount) || !tokens(day.totalTokens) || day.totalTokens === 0) return null;
  const perMillion = day.amount / (day.totalTokens / 1e6);
  if (!Number.isFinite(perMillion)) return null;
  const price = day.amount > 0 && perMillion < 0.01 ? '<¥0.01' : `¥${perMillion.toFixed(2)}`;
  return `${price} / 1M Token`;
}

const splits = 4;
function tokenAxisScale(peak) {
  const target = Math.max(1, peak * (1.15 / splits));
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const interval = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(factor =>
    Number((factor * magnitude).toPrecision(12))).find(step => step >= target * (1 - 1e-12) && Number.isInteger(step));
  return {min: 0, max: interval * splits, interval, splitNumber: splits};
}

/** Exact spoken keyboard selection, independent of HTML tooltip rendering. */
export function describeUsageDay(day, labels) {
  if (!day) return '';
  return `${day.date}; ${labels.cost}: ${formatCost(day.amount)}; Token: ${chartTokens(day.totalTokens)}; ${labels.unitCost}: ${formatUnitCost(day) ?? labels.missing}`;
}

/** Pure presentation builder: missing samples render at zero, never mutate source data. */
export function createUsageChartOption(days, labels, theme, width = 800) {
  const tokenValues = days.map(day => chartTokens(day.totalTokens));
  const tokenScale = tokenAxisScale(Math.max(0, ...tokenValues));
  // Leave room for the value axis and give date labels a wider berth on narrow screens.
  const dateLabels = Math.max(2, Math.min(10, Math.floor((width - 60) / 60)));
  const axisText = {color: theme.muted, fontSize: 12};
  return {
    animation: false,
    backgroundColor: 'transparent',
    textStyle: {fontFamily: theme.font, color: theme.text},
    aria: {enabled: true, label: {enabled: true, description: labels.description}},
    grid: {top: 36, left: 8, right: 8, bottom: 6, outerBoundsMode: 'same', outerBoundsContain: 'axisLabel'},
    legend: {top: 0, left: 8, padding: 0, selectedMode: false, itemWidth: 18, itemHeight: 8,
      textStyle: axisText,
      data: [{name: labels.tokens, icon: 'roundRect', itemStyle: {color: theme.tokens}}]},
    tooltip: {
      trigger: 'axis', triggerOn: 'mousemove|click', renderMode: 'html', confine: true,
      appendToBody: false, className: 'capinfo-echarts-tooltip', enterable: false, transitionDuration: 0, hideDelay: 0,
      backgroundColor: theme.background, borderColor: theme.border, borderWidth: 1, borderRadius: 8, padding: [10, 12],
      textStyle: {color: theme.text, fontSize: 13},
      extraCssText: `width:max-content;max-width:${Math.max(0, width - 12)}px;box-sizing:border-box;white-space:normal;overflow-wrap:anywhere;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,0.10);`,
      axisPointer: {axis: 'x', type: 'line', snap: true, lineStyle: {color: theme.guide || theme.border, type: 'dashed', width: 1},
        label: {show: false}},
      formatter(params) {
        const index = (Array.isArray(params) ? params[0] : params)?.dataIndex;
        const day = days[index];
        if (!day) return '';
        const row = (name, value) => `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-top:6px"><span style="color:${escape(theme.muted)}">${escape(name)}</span><span style="font-weight:600;font-variant-numeric:tabular-nums;text-align:right">${escape(value)}</span></div>`;
        return `<div style="font-weight:600">${escape(day.date)}</div>`
          + row(labels.cost, formatCost(day.amount))
          + row(labels.tokens, `${compact(tokenValues[index], 2)} Token`)
          + row(labels.unitCost, formatUnitCost(day) ?? '—');
      },
    },
    xAxis: {type: 'category', data: days.map(day => String(day.date)), boundaryGap: true,
      triggerEvent: false, axisPointer: {label: {show: false}},
      axisLine: {lineStyle: {color: theme.border}}, axisTick: {show: false},
      axisLabel: {interval: Math.max(0, Math.ceil((days.length - 1) / (dateLabels - 1)) - 1),
        ...axisText, margin: 9, hideOverlap: true,
        showMinLabel: true, showMaxLabel: true, formatter: date => String(date).slice(5)}},
    yAxis: {type: 'value', ...tokenScale, axisLabel: {...axisText, formatter: compactAxis},
      axisLine: {show: false}, axisTick: {show: false},
      splitLine: {lineStyle: {color: theme.border, type: 'dashed', opacity: 0.65}}},
    series: [
      {name: labels.tokens, type: 'bar', yAxisIndex: 0, data: tokenValues,
        barMaxWidth: 26, barMinHeight: 0, z: 2,
        itemStyle: {color: {type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{offset: 0, color: theme.tokensTop || theme.tokens}, {offset: 1, color: theme.tokens}]},
          borderRadius: [4, 4, 0, 0]},
        emphasis: {itemStyle: {color: theme.tokensActive || theme.tokens}}},
    ],
  };
}
