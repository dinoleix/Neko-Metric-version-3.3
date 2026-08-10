
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

// Vite's own signal for a lazy-import chunk that 404s — happens when a tab
// left open from before the latest deploy navigates to a route whose chunk
// hash has since changed. A reload picks up the new build; guard against a
// reload loop the same way ErrorBoundary does for the render-time case.
window.addEventListener('vite:preloadError', () => {
  const key = 'chunk-reload-attempted';
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, '1');
    window.location.reload();
  }
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// If the app is still healthy 10s after load, drop the reload guard so a
// genuinely new chunk error later in this tab's life (e.g. the next deploy
// landing while the tab stays open) can trigger the automatic reload again.
setTimeout(() => sessionStorage.removeItem('chunk-reload-attempted'), 10000);
