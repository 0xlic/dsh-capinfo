import * as echarts from 'echarts/core.js';
import {BarChart} from 'echarts/charts.js';
import {AriaComponent, GridComponent, LegendComponent, TooltipComponent} from 'echarts/components.js';
import {SVGRenderer} from 'echarts/renderers.js';
import {createUsageChartOption, describeUsageDay} from './usage-chart-options.js';

function chartTheme(element) {
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  const color = (token, fallback) => style.getPropertyValue(token).trim() || fallback;
  return {
    text: color('--dsw-alias-label-primary', style.color),
    muted: color('--dsw-alias-label-secondary', style.color),
    border: color('--dsw-alias-border-l1', style.color),
    background: color('--dsw-alias-bg-layer-1', '#ffffff'),
    guide: color('--dsw-alias-border-l2', '#d1d5db'),
    tokens: color('--capinfo-chart-tokens', '#60A5FA'),
    tokensTop: color('--capinfo-chart-tokens-top', '#80B7FA'),
    tokensActive: color('--capinfo-chart-tokens-active', '#3B82F6'),
    font: style.fontFamily,
  };
}

/** The Host React instance owns the component; ECharts is bundled, not a CDN/global. */
export function createUsageChartComponent(React, t) {
  echarts.use([BarChart, AriaComponent, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);
  const h = React.createElement;
  return function UsageChart({days, id}) {
    const host = React.useRef(null);
    const runtime = React.useRef(null);
    const latest = React.useRef(null);
    const keyboardIndex = React.useRef(29);
    const [failed, setFailed] = React.useState(false);
    const [announcedIndex, setAnnouncedIndex] = React.useState(null);
    const labels = {title: t('usageHistory'), description: t('usageChartDescription'),
      tokens: t('usageTokenChart'), cost: t('usageAmount'), unitCost: t('usageUnitCost'), missing: t('usageMissing')};
    latest.current = {days, labels};

    React.useEffect(() => {
      const element = host.current;
      if (!element) return;
      const document = element.ownerDocument, view = document.defaultView;
      let instance = null, frame = null, disposed = false;
      const paint = () => {
        frame = null;
        if (disposed || element.clientWidth <= 0 || element.clientHeight <= 0) return;
        try {
          if (!instance) instance = echarts.init(element, null, {renderer: 'svg'});
          instance.resize();
          instance.setOption(createUsageChartOption(latest.current.days, latest.current.labels, chartTheme(element), element.clientWidth), {notMerge: true});
          setFailed(false);
        } catch {
          // Never replace the rest of the settings page with a chart exception.
          setFailed(true);
        }
      };
      const schedule = () => {
        if (!disposed && frame === null) frame = view.requestAnimationFrame(paint);
      };
      const hide = () => {
        setAnnouncedIndex(null);
        instance?.dispatchAction({type: 'hideTip'});
        instance?.dispatchAction({type: 'updateAxisPointer', currTrigger: 'leave'});
      };
      const escape = event => {if (event.key === 'Escape') hide();};
      const resizeObserver = view.ResizeObserver ? new view.ResizeObserver(schedule) : null;
      resizeObserver?.observe(element);
      // Theme classes/variables can live on any ancestor in the DSH shell.
      const themeObserver = view.MutationObserver ? new view.MutationObserver(schedule) : null;
      for (let node = element; node; node = node.parentElement)
        themeObserver?.observe(node, {attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme']});
      view.addEventListener('resize', schedule);
      document.addEventListener('keydown', escape);
      runtime.current = {schedule, hide, show(index) {
        instance?.dispatchAction({type: 'showTip', seriesIndex: 0, dataIndex: index});
      }};
      schedule();
      return () => {
        disposed = true;
        if (frame !== null) view.cancelAnimationFrame(frame);
        resizeObserver?.disconnect();
        themeObserver?.disconnect();
        view.removeEventListener('resize', schedule);
        document.removeEventListener('keydown', escape);
        instance?.dispose();
        runtime.current = null;
      };
    }, []);
    React.useEffect(() => {runtime.current?.schedule();}, [days, labels.title, labels.tokens, labels.cost, labels.unitCost, labels.missing, labels.description]);

    const keydown = event => {
      if (event.key === 'Escape' && announcedIndex !== null) {
        event.preventDefault();
        event.stopPropagation();
        runtime.current?.hide();
        return;
      }
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      keyboardIndex.current = event.key === 'Home' ? 0 : event.key === 'End' ? days.length - 1
        : Math.max(0, Math.min(days.length - 1, keyboardIndex.current + (event.key === 'ArrowLeft' ? -1 : 1)));
      runtime.current?.show(keyboardIndex.current);
      setAnnouncedIndex(keyboardIndex.current);
    };
    return h('figure', {className: 'capinfo-chart', 'aria-labelledby': `${id}-chart-title`},
      h('figcaption', {id: `${id}-chart-title`}, labels.title),
      h('div', {ref: host, className: 'capinfo-chart-host', tabIndex: 0, 'aria-label': labels.description,
        'aria-describedby': `${id}-chart-help ${id}-chart-live`,
        onKeyDown: keydown, onFocus: () => {runtime.current?.show(keyboardIndex.current); setAnnouncedIndex(keyboardIndex.current);},
        onBlur: () => runtime.current?.hide()}),
      h('span', {id: `${id}-chart-help`, className: 'capinfo-sr-only'}, t('usageChartKeys')),
      h('span', {id: `${id}-chart-live`, className: 'capinfo-sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': true},
        announcedIndex === null ? '' : describeUsageDay(days[announcedIndex], labels)),
      failed ? h('p', {role: 'alert', className: 'capinfo-chart-error'}, t('usageChartError')) : null);
  };
}
