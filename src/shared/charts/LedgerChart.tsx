import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { compactChartValue, createChartScale, type ChartScaleMode } from './chartScale.mjs';
import './ledgerChart.css';

export type ChartPoint = {
  id: string;
  /** Unix milliseconds. Input order remains the ledger's order. */
  time: number;
  /** Decimal string; no floating-point conversion for exact evidence. */
  value: string;
  /** Optional complete display label, including units; raw value stays exact. */
  valueLabel?: string;
  detail?: string;
  href?: string;
  block?: number;
  approximate?: boolean;
};

export type ChartSeries = {
  id: string;
  label: string;
  style: 'line' | 'points' | 'reference';
  points: ChartPoint[];
};

export type LedgerChartProps = {
  title: string;
  unitLabel: string;
  series: ChartSeries[];
  controls?: ReactNode;
  formatTick?: (value: string) => string;
  coverage?: string;
  quoteNote?: string;
  emptyMessage?: string;
};

type Observation = { point: ChartPoint; series: ChartSeries; seriesIndex: number; key: string };
type PositionedObservation = Observation & { x: number; y: number };

const CHART_HEIGHT = 280;
const dateOnly = new Intl.DateTimeFormat('en', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const dateShort = new Intl.DateTimeFormat('en', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const timeShort = new Intl.DateTimeFormat('en', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function validTime(time: number) {
  return Number.isFinite(time) && time > 0 && !Number.isNaN(new Date(time).getTime());
}

function exactTime(time: number) {
  return validTime(time) ? new Date(time).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'Time unavailable';
}

function evidenceHref(href?: string) {
  if (!href) return undefined;
  // Chart records can supply evidence, never script or application authority.
  return /^(?:https?:\/\/|\/(?!\/))/.test(href) ? href : undefined;
}

function PointMark({ x, y, style, index, selected = false }: {
  x: number; y: number; style: ChartSeries['style']; index: number; selected?: boolean;
}) {
  const size = selected ? 5.5 : 3.5;
  const className = `ledger-chart-point${style === 'points' && index % 3 === 0 ? ' is-solid' : ''}${selected ? ' is-selected' : ''}`;
  if (style === 'points' && index % 3 === 0) {
    return <rect className={className} x={x - size} y={y - size} width={size * 2} height={size * 2} />;
  }
  if (style === 'points' && index % 3 === 1) {
    return <path className={className} d={`M ${x} ${y - size - 1} L ${x + size + 1} ${y} L ${x} ${y + size + 1} L ${x - size - 1} ${y} Z`} />;
  }
  return <circle className={className} cx={x} cy={y} r={size} />;
}

export function LedgerChart({
  title, unitLabel, series, controls, formatTick = compactChartValue, coverage, quoteNote,
  emptyMessage = 'No confirmed observations are available.',
}: LedgerChartProps) {
  const id = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [mode, setMode] = useState<ChartScaleMode>('auto');
  const [selection, setSelection] = useState<string | null>(null);
  const observations = useMemo<Observation[]>(() => series.flatMap((item, seriesIndex) =>
    item.points.map((point, pointIndex) => ({
      point, series: item, seriesIndex, key: `${item.id}:${point.id}:${pointIndex}`,
    }))), [series]);
  const scale = useMemo(() => createChartScale(observations.map(({ point }) => point.value), { mode }), [observations, mode]);
  const primarySeries = series.find((item) => item.style === 'line' && item.points.length) || series.find((item) => item.points.length);
  const latest = primarySeries?.points[primarySeries.points.length - 1];
  const defaultIndex = Math.max(0, observations.findIndex((item) => item.point === latest));
  const selectedIndex = selection ? observations.findIndex((item) => item.key === selection) : defaultIndex;
  const activeIndex = selectedIndex < 0 ? defaultIndex : selectedIndex;
  const active = observations[activeIndex];
  const dates = observations.map(({ point }) => point.time).filter(validTime);
  const minTime = dates.length ? Math.min(...dates) : 0;
  const maxTime = dates.length ? Math.max(...dates) : 0;
  const chartWidth = Math.max(160, width);
  const tickLabels = scale.ticks.map((tick) => formatTick(tick.axisValue ?? tick.value));
  const left = Math.min(chartWidth * 0.42, Math.max(58, ...tickLabels.map((label) => label.length * 6.8 + 16)));
  const right = 16;
  const top = 20;
  const bottom = 42;
  const plotWidth = Math.max(1, chartWidth - left - right);
  const plotHeight = CHART_HEIGHT - top - bottom;
  const xForTime = (time: number) => left + (maxTime === minTime ? 0.5 : (time - minTime) / (maxTime - minTime)) * plotWidth;
  const positions = observations.map((observation): PositionedObservation | null => {
    const valuePosition = scale.position(observation.point.value);
    return valuePosition === null || !validTime(observation.point.time) ? null
      : { ...observation, x: xForTime(observation.point.time), y: top + (1 - valuePosition) * plotHeight };
  });
  const positionsBySeries = series.map((_, seriesIndex) =>
    positions.filter((_, index) => observations[index].seriesIndex === seriesIndex));
  const markerIndex = (item: ChartSeries) => series.filter((entry) => entry.style === 'points').findIndex((entry) => entry.id === item.id);
  const plotted = positions.filter((point): point is PositionedObservation => point !== null);
  const activePosition = positions[activeIndex];
  const unplottedCount = observations.length - plotted.length;
  const hasTimeReversal = series.some((item) => item.points.some((point, index) =>
    index > 0 && validTime(point.time) && validTime(item.points[index - 1].time) && point.time < item.points[index - 1].time));
  const tickCount = chartWidth < 420 ? 2 : chartWidth < 640 ? 3 : 4;
  const timeTicks = minTime === maxTime ? [minTime]
    : Array.from({ length: tickCount }, (_, index) => minTime + (maxTime - minTime) * index / (tickCount - 1));
  const scaleText = `${mode === 'auto' ? 'Auto · ' : ''}${scale.effective === 'log' ? 'Log · equal proportional changes' : `${mode === 'log' ? 'Linear fallback' : 'Linear'} · equal absolute changes`}`;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const measured = frame.getBoundingClientRect().width;
      if (measured > 0) setWidth(Math.round(measured));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  function selectFromPointer(event: PointerEvent<SVGSVGElement>) {
    if (!plotted.length) return;
    if (event.type === 'pointermove' && event.pointerType === 'touch' && !event.buttons) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * chartWidth / bounds.width;
    const y = (event.clientY - bounds.top) * CHART_HEIGHT / bounds.height;
    let nearest = plotted[0];
    let distance = Infinity;
    for (const point of plotted) {
      const candidateDistance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (candidateDistance < distance) {
        distance = candidateDistance;
        nearest = point;
      }
    }
    setSelection(nearest.key);
  }

  const exactValue = (point: ChartPoint) => `${point.approximate ? 'Approximately ' : ''}${point.valueLabel ?? `${point.value || 'Unavailable'} ${unitLabel}`}`;
  const selectedDescription = active ? `${active.series.label}, ${exactValue(active.point)}, ${exactTime(active.point.time)}` : '';
  return (
    <section className="ledger-chart" aria-label={`${title} chart`}>
      <div className="ledger-chart-heading">
        <div className="ledger-chart-heading-copy">
          <h4 id={`${id}-title`}>{title}</h4>
          {latest && (
            <p className="ledger-chart-current" aria-label={`Latest ${primarySeries?.label}: ${exactValue(latest)}`}>
              <span>{latest.approximate ? '≈ ' : ''}{formatTick(latest.value)}</span>
              <span className="ledger-chart-unit">{unitLabel}</span>
            </p>
          )}
          {latest && <p className="ledger-chart-latest">Latest {primarySeries?.label} · {validTime(latest.time) ? dateOnly.format(latest.time) : 'Time unavailable'}</p>}
        </div>
        <div className="ledger-chart-toolbar">
          {controls}
          <div className="ledger-chart-scale" role="group" aria-label={`${title} scale`}>
            {(['auto', 'linear', 'log'] as const).map((option) => (
              <button key={option} type="button" aria-pressed={(mode === 'log' && !scale.logAvailable ? 'linear' : mode) === option}
                disabled={option === 'log' && !scale.logAvailable}
                aria-describedby={option === 'log' && !scale.logAvailable ? `${id}-scale-note` : undefined}
                onClick={() => setMode(option)}>
                {option === 'auto' ? 'Auto' : option === 'linear' ? 'Linear' : 'Log'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="ledger-chart-scale-note" id={`${id}-scale-note`}>
        {scaleText}{!scale.logAvailable && observations.length > 0 ? '. Log requires every available value to be greater than zero.' : '.'}
      </p>
      {series.length > 1 && (
        <ul className="ledger-chart-legend" aria-label="Chart series">
          {series.map((item) => (
            <li key={item.id}>
              <svg width="24" height="16" viewBox="0 0 24 16" aria-hidden="true">
                {item.style !== 'points'
                  ? <line className={`ledger-chart-line${item.style === 'reference' ? ' is-reference' : ''}`} x1="1" x2="23" y1="8" y2="8" />
                  : <PointMark x={12} y={8} style={item.style} index={markerIndex(item)} />}
              </svg>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="ledger-chart-frame" ref={frameRef}>
        {plotted.length ? (
          <svg className="ledger-chart-svg" width={chartWidth} height={CHART_HEIGHT} viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
            role="img" aria-labelledby={`${id}-title ${id}-description`}
            onPointerMove={selectFromPointer} onPointerDown={selectFromPointer}>
            <desc id={`${id}-description`}>
              {title} in {unitLabel}. {scaleText}. {plotted.length} observations.
              Use Inspect observation or View data below for exact values and evidence.
            </desc>
            <defs><clipPath id={`${id}-plot`}><rect x={left - 7} y={top - 7} width={plotWidth + 14} height={plotHeight + 14} /></clipPath></defs>
            {scale.ticks.map((tick) => {
              const y = top + (1 - tick.position) * plotHeight;
              return <g key={tick.value} className="ledger-chart-axis">
                <line className="ledger-chart-grid" x1={left} x2={chartWidth - right} y1={y} y2={y} />
                <text x={left - 10} y={y + 4} textAnchor="end"><title>{tick.value} {unitLabel}</title>{scale.axisOffset && tick.axisValue !== '0' ? '+' : ''}{formatTick(tick.axisValue ?? tick.value)}</text>
              </g>;
            })}
            {timeTicks.filter(validTime).map((time, index) => (
              <text key={time} className="ledger-chart-time" x={xForTime(time)} y={CHART_HEIGHT - 16}
                textAnchor={timeTicks.length === 1 ? 'middle' : index === 0 ? 'start' : index === timeTicks.length - 1 ? 'end' : 'middle'}>
                <title>{exactTime(time)}</title>
                {maxTime - minTime < 86400000 ? timeShort.format(time) : dateShort.format(time)}
              </text>
            ))}
            <g clipPath={`url(#${id}-plot)`}>
              {series.map((item, seriesIndex) => {
                const seriesPositions = positionsBySeries[seriesIndex];
                let previous: PositionedObservation | null = null;
                let path = '';
                // Iterate original observations to break on unavailable values
                // as well as backwards timestamps, never reorder chain history.
                for (const position of seriesPositions) {
                  if (!position) {
                    previous = null;
                    continue;
                  }
                  const command = previous && position.point.time >= previous.point.time ? 'L' : 'M';
                  path += `${command} ${position.x} ${position.y} `;
                  previous = position;
                }
                // References are applicable from their supplied observation
                // time onward; never invent an earlier mint-price history.
                if (item.style === 'reference' && previous) path += `L ${chartWidth - right} ${previous.y}`;
                return <g key={item.id}>
                  {item.style !== 'points' && <path className={`ledger-chart-line${item.style === 'reference' ? ' is-reference' : ''}`} d={path} />}
                  {seriesPositions.map((point, index) => point && (item.style === 'points' || index === seriesPositions.length - 1)
                    ? <PointMark key={point.key} x={point.x} y={point.y} style={item.style} index={markerIndex(item)} /> : null)}
                </g>;
              })}
              {activePosition && <>
                <line className="ledger-chart-cursor" x1={activePosition.x} x2={activePosition.x} y1={top} y2={top + plotHeight} />
                <PointMark x={activePosition.x} y={activePosition.y} style={activePosition.series.style} index={markerIndex(activePosition.series)} selected />
              </>}
            </g>
          </svg>
        ) : <p className="ledger-chart-empty">{observations.length ? 'Available observations cannot be plotted. Inspect their values and times below.' : emptyMessage}</p>}
      </div>
      {active && (
        <div className="ledger-chart-inspection">
          <div className="ledger-chart-inspector" id={`${id}-inspector`}>
            <p className="ledger-chart-observation-kind">{active.series.label} · {exactTime(active.point.time)}</p>
            <p className="ledger-chart-exact">{exactValue(active.point)}</p>
            {active.point.block !== undefined && <p>Block {active.point.block.toLocaleString('en')}</p>}
            {active.point.detail && <p className="ledger-chart-detail">{active.point.detail}</p>}
            {evidenceHref(active.point.href) && <a href={evidenceHref(active.point.href)} target="_blank" rel="noreferrer">View transaction evidence <span aria-hidden="true">↗</span></a>}
          </div>
          {observations.length > 1 && (
            <div className="ledger-chart-scrubber">
              <label htmlFor={`${id}-observation`}>Inspect observation <span>{activeIndex + 1} of {observations.length}</span></label>
              <div className="ledger-chart-scrubber-controls">
                <button type="button" aria-label="Previous observation" disabled={activeIndex === 0}
                  onClick={() => setSelection(observations[activeIndex - 1].key)}>←</button>
                <input id={`${id}-observation`} type="range" min={0} max={observations.length - 1} step={1} value={activeIndex}
                  aria-label="Inspect observation"
                  aria-valuetext={selectedDescription} aria-describedby={`${id}-inspector`}
                  onChange={(event) => setSelection(observations[Number(event.target.value)].key)} />
                <button type="button" aria-label="Next observation" disabled={activeIndex === observations.length - 1}
                  onClick={() => setSelection(observations[activeIndex + 1].key)}>→</button>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="ledger-chart-notes">
        {dates.length > 0 && <p>{dateOnly.format(minTime)}{minTime !== maxTime ? ` – ${dateOnly.format(maxTime)}` : ''} · UTC · {observations.length.toLocaleString('en')} available observations</p>}
        {coverage && <p>{coverage}</p>}
        {quoteNote && <p>{quoteNote}</p>}
        {scale.axisOffset && <p>Axis labels show the change from {scale.axisOffset} {unitLabel}. Exact observations remain below.</p>}
        {unplottedCount > 0 && <p>{unplottedCount} observation{unplottedCount === 1 ? '' : 's'} with an unavailable value or time {unplottedCount === 1 ? 'is' : 'are'} retained in the data table.</p>}
        {hasTimeReversal && <p>Ledger order is preserved. Lines break where recorded time moves backward.</p>}
      </div>
      {observations.length > 0 && (
        <details className="ledger-chart-data">
          <summary>View data <span>({observations.length.toLocaleString('en')})</span></summary>
          <div className="ledger-chart-table-scroll" tabIndex={0} role="region" aria-label={`${title} exact data`}>
            <table>
              <caption>{title} · {unitLabel} · supplied observation order</caption>
              <thead><tr><th scope="col">Series</th><th scope="col">Time (UTC)</th><th scope="col">Value ({unitLabel})</th><th scope="col">Evidence</th></tr></thead>
              <tbody>{observations.map(({ point, series: item, key }) => (
                <tr key={key}>
                  <th scope="row">{item.label}</th>
                  <td>{exactTime(point.time)}</td>
                  <td className="ledger-chart-data-value">{point.approximate ? '≈ ' : ''}{point.valueLabel ?? point.value}</td>
                  <td>{point.block !== undefined && <span>Block {point.block.toLocaleString('en')}. </span>}{point.detail && <span>{point.detail} </span>}
                    {evidenceHref(point.href) && <a href={evidenceHref(point.href)} target="_blank" rel="noreferrer">Transaction ↗</a>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
