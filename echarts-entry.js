// ECharts 按需引入（tree-shake 版本）
import * as echarts from 'echarts/core';
import { CandlestickChart } from 'echarts/charts';
import { LineChart } from 'echarts/charts';
import { BarChart } from 'echarts/charts';
import { HeatmapChart } from 'echarts/charts';
import {
  TooltipComponent,
  AxisPointerComponent,
  LegendComponent,
  GridComponent,
  DataZoomComponent,
  VisualMapComponent,
  MarkPointComponent,
  MarkAreaComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  CandlestickChart, LineChart, BarChart, HeatmapChart,
  TooltipComponent, AxisPointerComponent, LegendComponent,
  GridComponent, DataZoomComponent, VisualMapComponent,
  MarkPointComponent, MarkAreaComponent,
  CanvasRenderer,
]);

// 暴露到全局
window.echarts = echarts;
