import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { creerQueryClient } from './lib/query-client';
import './lib/i18n';

/**
 * La police est embarquee, pas appelee sur un service tiers.
 *
 * Tick& s'auto-heberge, souvent sur un reseau ferme : une police servie par
 * Google Fonts n'y arriverait jamais, et l'interface retomberait sans prevenir
 * sur la police systeme -- c'est-a-dire sur l'apparence de tout le monde.
 */
import '@fontsource-variable/archivo';
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
