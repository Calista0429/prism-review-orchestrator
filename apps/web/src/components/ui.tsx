import type { ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { routeLabels, type Route } from '@prism/shared';

export const percent = (value: number | null | undefined) =>
  value == null ? 'Unavailable' : `${Math.round(value * 100)}%`;
export const risk = (value: number | null | undefined) =>
  value == null ? 'Unavailable' : `${value.toFixed(1)} / 10`;
export const dateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
export function RouteBadge({ route }: { route: Route | 'incoming' }) {
  return (
    <span className={`route-badge route-${route}`}>
      <span className="route-dot" />
      {routeLabels[route]}
    </span>
  );
}
export function Loading({
  children = 'Loading workspace…',
}: {
  children?: ReactNode;
}) {
  return (
    <div className="loading" role="status">
      <RefreshCw size={17} />
      {children}
    </div>
  );
}
export function ErrorMessage({
  error,
  retry,
}: {
  error: Error | null;
  retry?: () => void;
}) {
  return error ? (
    <div className="error-message" role="alert">
      <AlertCircle size={18} />
      <span>{error.message}</span>
      {retry && (
        <button className="button small" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  ) : null;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
