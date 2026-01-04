import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ChartProvider } from './contexts/ChartContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChartProvider>
      <App />
    </ChartProvider>
  </React.StrictMode>
);