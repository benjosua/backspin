// Recovered entrypoint matching production bundle root render.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { configureTextBuilder } from 'troika-three-text';
import App from './App.jsx';
configureTextBuilder({
  unicodeFontsURL: `${globalThis.location.origin}/vendor/unicode-font-resolver/packages/data`,
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
