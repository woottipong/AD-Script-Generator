import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { TooltipProvider } from '@/components/ui/tooltip';
import './index.css';

// An API answering UNAUTHENTICATED means the session has ended: sign in again and come back to this page.
// Wrapping fetch once covers every caller (Job List, editor saves, polling, uploads). Other 401s, such as a
// Gemini permission error the server reports as 401, are left to the caller.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const response = await nativeFetch(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  if (response.status === 401 && url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
    const body = await response.clone().json().catch(() => null) as { code?: unknown } | null;
    if (body?.code === 'UNAUTHENTICATED') {
      window.location.assign(`/auth/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
  }
  return response;
};

createRoot(document.getElementById('root')!).render(
  <TooltipProvider delay={400}>
    <App />
  </TooltipProvider>,
);
