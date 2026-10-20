export type ChartScaleMode = 'auto' | 'linear' | 'log';
export type ChartScale = {
  requested: ChartScaleMode;
  effective: 'linear' | 'log';
  logAvailable: boolean;
  invalidCount: number;
  minimum: string | null;
  maximum: string | null;
  axisOffset?: string;
  ticks: Array<{ value: string; axisValue?: string; position: number }>;
  position: (value: string) => number | null;
};
export function createChartScale(values: string[], options?: { mode?: ChartScaleMode }): ChartScale;
export function compactChartValue(value: string): string;
