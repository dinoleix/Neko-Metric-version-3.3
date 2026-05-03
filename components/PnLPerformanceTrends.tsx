
import React, { useState, useEffect, useMemo } from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy 
} from 'firebase/firestore';
import { db } from '../firebase';
import { 
  SalesMonthlySnapshot, 
  PnLMonthlySnapshot, 
  MONTH_NAMES,
  getOutletName
} from '../types';
import { 
  TrendingUp, 
  Calendar, 
  Filter, 
  Check, 
  BarChart3,
  Activity,
  DollarSign,
  Percent,
  Layers,
  Loader2
} from 'lucide-react';

interface PnLPerformanceTrendsProps {
  user: any;
  selectedOutlets: string[];
  rentals: any[];
}

const METRIC_CONFIG = {
  totalRevenue: { label: 'Total Revenue', color: '#6366f1', type: 'currency' },
  onlineRevenue: { label: 'Online Revenue', color: '#8b5cf6', type: 'currency' },
  eventRevenue: { label: 'Event Revenue', color: '#ec4899', type: 'currency' },
  cogs: { label: 'COGS', color: '#f43f5e', type: 'currency' },
  labour: { label: 'Labour', color: '#fb923c', type: 'currency' },
  ops: { label: 'Operations', color: '#2dd4bf', type: 'currency' },
  rent: { label: 'Fixed (Rent)', color: '#94a3b8', type: 'currency' },
  netProfit: { label: 'Net Profit', color: '#10b981', type: 'currency' },
  grossMargin: { label: 'Gross Margin %', color: '#f59e0b', type: 'percent' },
  netMargin: { label: 'Net Margin %', color: '#06b6d4', type: 'percent' },
};

const PnLPerformanceTrends: React.FC<PnLPerformanceTrendsProps> = ({ user, selectedOutlets, rentals }) => {
  const [period, setPeriod] = useState<number>(6); // Default 6 months
  const [loading, setLoading] = useState(false);
  const [trendData, setTrendData] = useState<any[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(['totalRevenue', 'netProfit', 'netMargin']);

  const fetchTrendData = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const monthsToFetch = [];
      for (let i = 0; i < period; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthsToFetch.push({
          month: MONTH_NAMES[d.getMonth()],
          year: d.getFullYear().toString()
        });
      }

      // We fetch all snapshots for the user and filter in memory to avoid complex index issues
      // especially since we need multiple months
      const salesQuery = query(
        collection(db, 'sales_snapshots'),
        where('userId', '==', user.uid)
      );
      const pnlQuery = query(
        collection(db, 'pnl_snapshots'),
        where('userId', '==', user.uid)
      );

      const [salesSnap, pnlSnap] = await Promise.all([
        getDocs(salesQuery),
        getDocs(pnlQuery)
      ]);

      const salesDocs = salesSnap.docs.map(d => d.data() as SalesMonthlySnapshot);
      const pnlDocs = pnlSnap.docs.map(d => d.data() as PnLMonthlySnapshot);

      const outletIds = selectedOutlets.includes('all') 
        ? rentals.map(r => r.outletId)
        : selectedOutlets;

      const processedData = monthsToFetch.map(({ month, year }) => {
        const monthSales = salesDocs.filter(s => 
          s.month === month && 
          s.year === year && 
          outletIds.includes(s.outletId)
        );
        const monthPnL = pnlDocs.filter(p => 
          p.month === month && 
          p.year === year && 
          outletIds.includes(p.outletId)
        );

        const totalRevenue = monthSales.reduce((acc, s) => acc + (s.posGoodGross || 0) + (s.onlineGoodGross || 0) + (s.eventRevenue || 0), 0);
        const onlineRevenue = monthSales.reduce((acc, s) => acc + (s.onlineGoodGross || 0), 0);
        const eventRevenue = monthSales.reduce((acc, s) => acc + (s.eventRevenue || 0), 0);
        
        const netProfit = monthPnL.reduce((acc, p) => acc + (p.netProfit || 0), 0);
        const netRevenue = monthPnL.reduce((acc, p) => acc + (p.netRevenue || 0), 0);
        const cogsAmount = monthPnL.reduce((acc, p) => acc + (p.cogsAmount || 0), 0);
        const labourAmount = monthPnL.reduce((acc, p) => acc + (p.labourAmount || 0), 0);
        const opsAmount = monthPnL.reduce((acc, p) => acc + (p.opsAmount || 0), 0);
        const rentAmount = monthPnL.reduce((acc, p) => acc + (p.rentAmount || 0), 0);

        // Gross Margin calculation: (Net Inflow - COGS) / Gross Revenue
        const grossMargin = totalRevenue > 0 ? ((netRevenue - cogsAmount) / totalRevenue) * 100 : 0;
        const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

        return {
          name: `${month.substring(0, 3)} ${year.substring(2)}`,
          fullDate: `${month} ${year}`,
          monthIdx: MONTH_NAMES.indexOf(month),
          year: parseInt(year),
          totalRevenue,
          onlineRevenue,
          eventRevenue,
          cogs: cogsAmount,
          labour: labourAmount,
          ops: opsAmount,
          rent: rentAmount,
          netProfit,
          grossMargin,
          netMargin
        };
      }).sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return a.monthIdx - b.monthIdx;
      });

      setTrendData(processedData);
    } catch (err) {
      console.error("Error fetching trend data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrendData();
  }, [user, selectedOutlets, period]);

  const toggleMetric = (metric: string) => {
    if (selectedMetrics.includes(metric)) {
      setSelectedMetrics(selectedMetrics.filter(m => m !== metric));
    } else {
      setSelectedMetrics([...selectedMetrics, metric]);
    }
  };

  const formatValue = (value: number, type: string) => {
    if (type === 'currency') {
      return `₹${(value / 1000).toFixed(1)}k`;
    }
    return `${value.toFixed(1)}%`;
  };

  return (
    <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="p-4 bg-indigo-50 text-indigo-600 rounded-[1.5rem] shadow-inner">
            <TrendingUp size={28} />
          </div>
          <div>
            <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Performance Trends</h3>
            <p className="text-slate-400 text-sm font-medium uppercase tracking-widest mt-1">Multi-month comparative analysis</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
          {[3, 6, 12].map(m => (
            <button
              key={m}
              onClick={() => setPeriod(m)}
              className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${period === m ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {m} Months
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {Object.entries(METRIC_CONFIG).map(([key, config]) => (
          <button
            key={key}
            onClick={() => toggleMetric(key)}
            className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 ${selectedMetrics.includes(key) ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-white border-slate-100 text-slate-400 hover:border-slate-200'}`}
          >
            <div className={`w-2 h-2 rounded-full`} style={{ backgroundColor: config.color }} />
            <span className="text-[9px] font-black uppercase tracking-tight text-center leading-tight">{config.label}</span>
            {selectedMetrics.includes(key) && <Check size={12} className="mt-1" />}
          </button>
        ))}
      </div>

      <div className="h-[450px] w-full mt-6">
        {loading ? (
          <div className="h-full w-full flex flex-col items-center justify-center gap-4">
            <Loader2 size={40} className="text-indigo-600 animate-spin" />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Synthesizing Historical Data...</p>
          </div>
        ) : trendData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData} margin={{ top: 20, right: 30, left: 20, bottom: 0 }}>
              <defs>
                {Object.entries(METRIC_CONFIG).map(([key, config]) => (
                  <linearGradient key={key} id={`color${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={config.color} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={config.color} stopOpacity={0}/>
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                dy={10}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(0)}k` : val}
              />
              <Tooltip 
                contentStyle={{ 
                  borderRadius: '20px', 
                  border: 'none', 
                  boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
                  padding: '16px'
                }}
                itemStyle={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase' }}
                labelStyle={{ marginBottom: '8px', fontWeight: 900, color: '#1e293b' }}
              />
              <Legend 
                verticalAlign="top" 
                align="right" 
                iconType="circle"
                wrapperStyle={{ paddingBottom: '20px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}
              />
              {selectedMetrics.map(metric => (
                <Area
                  key={metric}
                  type="monotone"
                  dataKey={metric}
                  name={METRIC_CONFIG[metric as keyof typeof METRIC_CONFIG].label}
                  stroke={METRIC_CONFIG[metric as keyof typeof METRIC_CONFIG].color}
                  strokeWidth={3}
                  fillOpacity={1}
                  fill={`url(#color${metric})`}
                  animationDuration={1500}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center text-center p-10 bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200">
            <Activity size={48} className="text-slate-200 mb-4" />
            <h4 className="text-lg font-black text-slate-900 uppercase">No Trend Data Found</h4>
            <p className="text-slate-400 text-sm mt-2 max-w-xs">Lock your monthly P&L snapshots to enable historical performance tracking.</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10">
        <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-white rounded-lg shadow-sm text-indigo-600"><Activity size={16}/></div>
            <h4 className="text-xs font-black text-slate-900 uppercase">Growth Velocity</h4>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed font-medium">
            Analyzing the trend slope over {period} months. Positive trajectory in net margin indicates improving operational efficiency.
          </p>
        </div>
        <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-white rounded-lg shadow-sm text-emerald-600"><DollarSign size={16}/></div>
            <h4 className="text-xs font-black text-slate-900 uppercase">Revenue Mix</h4>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed font-medium">
            Compare Online vs Event revenue trends to identify which channels are driving your top-line growth.
          </p>
        </div>
        <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-white rounded-lg shadow-sm text-amber-600"><Percent size={16}/></div>
            <h4 className="text-xs font-black text-slate-900 uppercase">Margin Stability</h4>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed font-medium">
            Gross Margin fluctuations usually indicate COGS volatility or platform commission changes.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PnLPerformanceTrends;
