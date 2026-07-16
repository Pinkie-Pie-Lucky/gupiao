/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';

interface ChartPoint {
  time: string;
  value: number;
  volume?: number;
}

interface InteractiveChartProps {
  data: ChartPoint[];
  title?: string;
  symbolCode?: string;
  isPositive?: boolean;
}

export function InteractiveChart({
  data,
  title,
  symbolCode,
  isPositive = true,
}: InteractiveChartProps) {
  const [timeframe, setTimeframe] = useState<'1D' | '5D' | '1M' | '1Y'>('1D');

  // Let's generate slightly different variations based on the selected timeframe to make it realistic
  const getProcessedData = () => {
    if (timeframe === '1D') return data;
    
    // Simulate other timeframes
    const seed = data[0]?.value || 100;
    const factor = timeframe === '5D' ? 5 : timeframe === '1M' ? 30 : 250;
    const step = timeframe === '5D' ? '日' : timeframe === '1M' ? '号' : '月';
    
    const processed = [];
    let currentVal = seed;
    for (let i = factor; i >= 0; i--) {
      const change = currentVal * (Math.random() - (isPositive ? 0.46 : 0.54)) * 0.015;
      currentVal = currentVal + change;
      
      let label = '';
      if (timeframe === '5D') {
        label = `D-${Math.ceil(i/4)} ${9 + (i % 4) * 2}:00`;
      } else if (timeframe === '1M') {
        label = `7月${Math.max(1, 16 - Math.ceil(i/3))}日`;
      } else {
        label = `${2025 + Math.floor((250 - i) / 24)}年${Math.max(1, Math.ceil((250 - i) / 21) % 12 + 1)}月`;
      }
      
      processed.push({
        time: label,
        value: parseFloat(currentVal.toFixed(2)),
        volume: Math.floor(Math.random() * 80000 + 20000),
      });
    }
    return processed.reverse();
  };

  const chartData = getProcessedData();
  const values = chartData.map((d) => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const padding = (maxVal - minVal) * 0.1 || 10;

  const strokeColor = isPositive ? '#EF4444' : '#10B981'; // Red for up, green for down in Chinese market
  const fillColor = isPositive ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)';

  return (
    <div id="interactive-chart-container" className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      {title && (
        <div className="flex justify-between items-center mb-4">
          <div>
            <h4 id="chart-title" className="font-semibold text-gray-900 text-base">{title}</h4>
            {symbolCode && <p id="chart-code" className="text-xs text-gray-500 font-mono">{symbolCode}</p>}
          </div>
          
          <div id="chart-timeframe-selectors" className="flex space-x-1 bg-gray-100 p-1 rounded-lg text-xs">
            {(['1D', '5D', '1M', '1Y'] as const).map((tf) => (
              <button
                key={tf}
                id={`btn-timeframe-${tf}`}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1 rounded-md transition-all font-medium ${
                  timeframe === tf
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {tf === '1D' ? '分时' : tf === '5D' ? '5日' : tf === '1M' ? '1月' : '1年'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Stock Chart */}
      <div id="chart-canvas-area" className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.2} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#9CA3AF', fontSize: 10 }}
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis
              domain={[minVal - padding, maxVal + padding]}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#9CA3AF', fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(17, 24, 39, 0.95)',
                border: 'none',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '12px',
                padding: '8px 12px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              }}
              labelStyle={{ color: '#9CA3AF', fontWeight: 'bold', marginBottom: '4px' }}
              itemStyle={{ color: strokeColor }}
              formatter={(value: any) => [`${value}`, '价格/指数']}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={strokeColor}
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorValue)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Volume Bars Sub-chart */}
      <div id="chart-volume-area" className="h-12 w-full mt-2 border-t border-gray-50 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 0, right: 5, left: -20, bottom: 0 }}>
            <XAxis dataKey="time" hide />
            <YAxis hide />
            <Bar dataKey="volume" fill="#D1D5DB" opacity={0.6} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
