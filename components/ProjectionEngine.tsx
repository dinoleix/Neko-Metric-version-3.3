
import React, { useState } from 'react';
import { Zap, Loader2, TrendingUp, AlertCircle, Calendar, Sparkles, ArrowRight, Info } from 'lucide-react';
import { SalesProjection, StoreRental } from '../types';
import { generateSalesProjection } from '../projectionService';
import { motion, AnimatePresence } from 'motion/react';

interface ProjectionEngineProps {
  outlet: StoreRental;
  userId: string;
}

const ProjectionEngine: React.FC<ProjectionEngineProps> = ({ outlet, userId }) => {
  const [projection, setProjection] = useState<SalesProjection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!outlet.latitude || !outlet.longitude) {
      setError("Store coordinates missing. Please update in Store Hub.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await generateSalesProjection(outlet.outletId, userId, outlet.latitude, outlet.longitude);
      setProjection(result);
    } catch (err: any) {
      setError("Failed to generate AI projection. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
      <div className="p-8 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-slate-50/50">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-100">
            <Zap size={24} />
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">AI Projection Engine</h3>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Predictive Sales Intelligence v1.0</p>
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="flex items-center gap-3 px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-600 disabled:opacity-50 transition-all shadow-xl shadow-slate-200"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {loading ? 'Analyzing Data...' : 'Generate 5-Day Forecast'}
        </button>
      </div>

      <div className="p-8">
        <AnimatePresence mode="wait">
          {!projection && !loading && !error && (
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="py-20 text-center"
            >
              <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <TrendingUp size={32} className="text-slate-300" />
              </div>
              <h4 className="text-lg font-black text-slate-900 uppercase">Ready for Analysis</h4>
              <p className="text-slate-400 text-sm max-w-md mx-auto mt-2">
                Click generate to combine your historical sales, local holidays, and weather forecasts into a predictive model.
              </p>
            </motion.div>
          )}

          {loading && (
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="py-20 text-center"
            >
              <Loader2 size={48} className="text-indigo-600 animate-spin mx-auto mb-6" />
              <h4 className="text-lg font-black text-slate-900 uppercase animate-pulse">Running Simulation...</h4>
              <p className="text-slate-400 text-sm mt-2">Correlating weather patterns and holiday spikes...</p>
            </motion.div>
          )}

          {error && (
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="py-12 bg-rose-50 rounded-3xl border border-rose-100 text-center"
            >
              <AlertCircle size={32} className="text-rose-500 mx-auto mb-4" />
              <p className="text-rose-600 font-black uppercase text-xs tracking-widest">{error}</p>
            </motion.div>
          )}

          {projection && !loading && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Daily Revenue Forecast</h5>
                    <div className="flex items-center gap-2 text-[10px] font-black text-emerald-500 uppercase">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full" /> Total: ₹{projection.totalProjectedRevenue.toLocaleString()}
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-3">
                    {projection.dailyProjections.map((dp, i) => (
                      <div key={i} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 hover:border-indigo-200 transition-colors group">
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-2">
                          {new Date(dp.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
                        </p>
                        <p className="text-sm font-black text-slate-900">₹{Math.round(dp.projectedRevenue).toLocaleString()}</p>
                        <div className="mt-3 flex flex-wrap gap-1">
                          {dp.factors.slice(0, 2).map((f, fi) => (
                            <span key={fi} className="text-[7px] font-black bg-white px-1.5 py-0.5 rounded border border-slate-100 text-slate-500 uppercase truncate max-w-full">
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-indigo-600 p-8 rounded-[2rem] text-white shadow-xl shadow-indigo-100 relative overflow-hidden">
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-4">
                      <Sparkles size={16} className="text-indigo-200" />
                      <h5 className="text-[10px] font-black uppercase tracking-widest text-indigo-100">AI Strategic Insights</h5>
                    </div>
                    <p className="text-sm font-medium leading-relaxed italic">
                      "{projection.aiInsights}"
                    </p>
                  </div>
                  <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
                </div>
              </div>

              <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 flex items-start gap-4">
                <div className="p-2 bg-white rounded-xl text-indigo-600 shadow-sm">
                  <Info size={18} />
                </div>
                <div>
                  <h6 className="text-xs font-black text-slate-900 uppercase tracking-tight">How this works</h6>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    Our engine analyzes the last 90 days of sales velocity, cross-references upcoming regional holidays from your Registry, and adjusts for weather volatility (precipitation and temperature) to generate these estimates.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default ProjectionEngine;
