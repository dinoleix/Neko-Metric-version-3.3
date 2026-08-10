import React from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

// A stale chunk reference (page open from before the latest Vercel deploy,
// then the user navigates to a lazy-loaded tab whose old file hash is gone)
// throws here as a normal render error. Reloading fixes it in one shot, so
// we do that automatically instead of showing the user a dead end — guarded
// by sessionStorage so a genuinely broken chunk doesn't reload-loop forever.
const isChunkLoadError = (error: Error): boolean =>
  /dynamically imported module|Failed to fetch|Importing a module script failed/i.test(error.message);

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  props!: { children: React.ReactNode };
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) {
      const key = 'chunk-reload-attempted';
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
      }
    }
  }

  handleReload = () => {
    sessionStorage.removeItem('chunk-reload-attempted');
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
          <div className="max-w-sm w-full bg-white rounded-[2rem] shadow-xl ring-1 ring-slate-100 p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto">
              <AlertTriangle size={26} className="text-rose-500" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">Something went wrong</h2>
              <p className="text-sm font-medium text-slate-500 mt-1">A page reload should fix this.</p>
            </div>
            <button
              onClick={this.handleReload}
              className="w-full py-3.5 bg-slate-900 text-white rounded-2xl text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
            >
              <RefreshCw size={16} /> Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
