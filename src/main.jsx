// Recovered entrypoint matching production bundle root render.

import './index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
const { default: App } = await import('./App.jsx');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
