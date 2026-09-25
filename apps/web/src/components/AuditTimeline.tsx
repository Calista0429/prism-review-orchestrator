import { Link } from 'react-router-dom';
import type { AuditEvent } from '@prism/shared';
import { Empty, RouteBadge, dateTime } from './ui';

function detailValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
export function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (!events.length)
    return (
      <Empty>
        No audit events match this view. Assess a pull request or adjust your
        filters.
      </Empty>
    );
  return (
    <ol className="audit-timeline">
      {events.map((event) => (
        <li key={event.id}>
          <div className="timeline-dot" />
          <div className="audit-entry">
            <div className="audit-entry-heading">
              <strong>{event.type.replace(/[_.]/g, ' ')}</strong>
              <time dateTime={event.createdAt}>
                {dateTime(event.createdAt)}
              </time>
            </div>
            <div className="audit-meta">
              <span>{event.actor}</span>
              {event.repository && <span>{event.repository}</span>}
              {event.pullRequestId && (
                <Link to={`/pull-requests/${event.pullRequestId}`}>
                  {event.pullRequestId}
                </Link>
              )}
              {event.route && <RouteBadge route={event.route} />}
            </div>
            {Object.keys(event.details).length > 0 && (
              <dl className="audit-details">
                {Object.entries(event.details).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}</dt>
                    <dd>{detailValue(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
