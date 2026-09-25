import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, RotateCcw } from 'lucide-react';
import { routes, routeLabels, type AuditEvent } from '@prism/shared';
import { api } from '../api';
import { AuditTimeline } from '../components/AuditTimeline';
import { ErrorMessage, Loading, PageHeading } from '../components/ui';

const emptyFilters = {
  repository: '',
  pullRequestId: '',
  route: '',
  actor: '',
  type: '',
  from: '',
  to: '',
};
export function Audit() {
  const [draft, setDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value)
      params.set(
        key,
        key === 'from' || key === 'to' ? new Date(value).toISOString() : value,
      );
  }
  const query = useQuery({
    queryKey: ['audit-events', filters],
    queryFn: () => api<AuditEvent[]>(`/api/audit-events?${params.toString()}`),
  });
  const invalidDates = !!(draft.from && draft.to && draft.from > draft.to);
  function apply(event: FormEvent) {
    event.preventDefault();
    if (!invalidDates) setFilters({ ...draft });
  }
  return (
    <>
      <PageHeading
        title="Audit trail"
        description="A permanent record of assessments, routing, and human decisions."
      />
      <form className="audit-filters panel" onSubmit={apply}>
        {(['repository', 'pullRequestId', 'actor', 'type'] as const).map(
          (key) => (
            <label key={key}>
              {
                {
                  repository: 'Repository',
                  pullRequestId: 'PR ID',
                  actor: 'Actor',
                  type: 'Event type',
                }[key]
              }
              <input
                value={draft[key]}
                placeholder={
                  {
                    repository: 'All repositories',
                    pullRequestId: 'e.g. pr-dealer',
                    actor: 'All actors',
                    type: 'All event types',
                  }[key]
                }
                onChange={(event) =>
                  setDraft({ ...draft, [key]: event.target.value })
                }
              />
            </label>
          ),
        )}
        <label>
          Route
          <select
            value={draft.route}
            onChange={(event) =>
              setDraft({ ...draft, route: event.target.value })
            }
          >
            <option value="">All routes</option>
            {routes.map((route) => (
              <option key={route} value={route}>
                {routeLabels[route]}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="datetime-local"
            value={draft.from}
            onChange={(event) =>
              setDraft({ ...draft, from: event.target.value })
            }
          />
        </label>
        <label>
          To
          <input
            type="datetime-local"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </label>
        <div className="audit-filter-actions">
          <button
            type="submit"
            className="button primary"
            disabled={invalidDates}
          >
            <Filter size={14} />
            Apply filters
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              setDraft(emptyFilters);
              setFilters(emptyFilters);
            }}
          >
            <RotateCcw size={14} />
            Reset
          </button>
        </div>
        {invalidDates && (
          <p role="alert" className="validation-message">
            The end date must be after the start date.
          </p>
        )}
      </form>
      <section className="panel audit-panel" aria-label="Audit events">
        <div className="section-heading">
          <h2>Event timeline</h2>
          <span>{query.data?.length ?? 0} events</span>
        </div>
        <ErrorMessage error={query.error} retry={() => void query.refetch()} />
        {query.isPending ? (
          <Loading>Loading audit history…</Loading>
        ) : (
          query.data && <AuditTimeline events={query.data} />
        )}
      </section>
    </>
  );
}
