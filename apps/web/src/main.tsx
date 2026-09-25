import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { Board } from './pages/Board';
import { Loading } from './components/ui';
import { Policies } from './pages/Policies';
import { Audit } from './pages/Audit';
import './styles.css';

const Detail = React.lazy(() =>
  import('./pages/Detail').then((module) => ({ default: module.Detail })),
);

const client = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10000 },
    mutations: { retry: false },
  },
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Board />} />
            <Route
              path="pull-requests/:id"
              element={
                <React.Suspense
                  fallback={<Loading>Loading pull request…</Loading>}
                >
                  <Detail />
                </React.Suspense>
              }
            />
            <Route path="policies" element={<Policies />} />
            <Route path="audit" element={<Audit />} />
            <Route
              path="*"
              element={
                <div className="empty-state">
                  <h1>Page not found</h1>
                  <Link to="/">Return to command center</Link>
                </div>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
