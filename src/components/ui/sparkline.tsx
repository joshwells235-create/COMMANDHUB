'use client';

interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}

export function Sparkline({ data, color = '#06b6d4', width = 48, height = 20 }: SparklineProps) {
  if (data.length < 2) return null;

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(' L ')}`;

  // Trend arrow
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const trend = last > prev ? '↑' : last < prev ? '↓' : '';
  const trendColor = last > prev ? 'text-danger' : last < prev ? 'text-success' : 'text-muted';

  return (
    <div className="flex items-center gap-1">
      <svg width={width} height={height} className="flex-shrink-0">
        <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
        {/* Dot on the last point */}
        <circle
          cx={width}
          cy={height - ((last - min) / range) * (height - 2) - 1}
          r="2"
          fill={color}
        />
      </svg>
      {trend && <span className={`text-[10px] font-bold ${trendColor}`}>{trend}</span>}
    </div>
  );
}
