import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { creerQueryClient } from './lib/query-client';
import './lib/i18n';
import './index.css';

const queryClient = creerQueryClient();

const container = document.getElementById('root');
if (!container) throw new Error('Element racine introuvable.');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
