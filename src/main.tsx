import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register the PWA worker only in production; development remains network-first.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/orbit-tasks/service-worker.js', {
      scope: '/orbit-tasks/',
    }).catch((error: unknown) => {
      console.warn('No se pudo registrar el Service Worker de Orbit Tasks.', error);
    });
  });
}
