// Recovered entrypoint matching production bundle root render.

import 'typeface-montserrat';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { configureTextBuilder } from 'troika-three-text';
import { bootstrapDebugTuning } from './debug-tuning.js';

bootstrapDebugTuning();

configureTextBuilder({
  unicodeFontsURL: `${globalThis.location.origin}/vendor/unicode-font-resolver/packages/data`,
});

const { default: App } = await import('./App.jsx');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
