import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FlaskConical, LockKeyhole, Upload } from 'lucide-react';
import {
  dimensionLabels,
  dimensions,
  policySchema,
  routes,
  type Policy,
  type PolicyVersion,
  type SimulationResult,
} from '@prism/shared';
import { api } from '../api';
import {
  Empty,
  ErrorMessage,
  Loading,
  PageHeading,
  RouteBadge,
  dateTime,
  percent,
} from '../components/ui';

function PolicyEditor({
  current,
  onPublished,
}: {
  current: PolicyVersion;
  onPublished: (message: string) => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<Policy>(() =>
    structuredClone(current.policy),
  );
  const [preview, setPreview] = useState<{
    signature: string;
    result: SimulationResult;
  } | null>(null);
  const simulationKey = useRef<string | undefined>(undefined);
  const publicationKey = useRef<string | undefined>(undefined);
  const signature = JSON.stringify(draft);
  const validation = policySchema.safeParse(draft);
  const simulation = useMutation({
    mutationFn: (policy: Policy) => {
      simulationKey.current ??= crypto.randomUUID();
      return api<SimulationResult>(
        '/api/policies/simulate',
        { policy },
        simulationKey.current,
      );
    },
    onSuccess: (result, policy) => {
      simulationKey.current = undefined;
      setPreview({ signature: JSON.stringify(policy), result });
    },
    onError: () => {
      simulationKey.current = undefined;
    },
  });
  const publication = useMutation({
    mutationFn: () => {
      publicationKey.current ??= crypto.randomUUID();
      return api<PolicyVersion>(
        '/api/policies',
        {
          policy: draft,
          actor: 'demo-operator',
          baseVersion: current.version,
        },
        publicationKey.current,
      );
    },
    onSuccess: (version) => {
      publicationKey.current = undefined;
      setPreview(null);
      client.setQueryData(['policy'], version);
      void client.invalidateQueries({ queryKey: ['policy'] });
      void client.invalidateQueries({ queryKey: ['audit-events'] });
      onPublished(
        `Policy version ${version.version} published. Historical routing decisions are unchanged.`,
      );
    },
    onError: () => {
      publicationKey.current = undefined;
    },
  });
  const result = preview?.signature === signature ? preview.result : null;
  function update(
    key: 'fastThreshold' | 'criticalThreshold' | 'confidenceThreshold',
    value: string,
  ) {
    setDraft((previous) => ({
      ...previous,
      [key]: value === '' ? NaN : Number(value),
    }));
    setPreview(null);
    simulation.reset();
    publication.reset();
  }
  function simulate(event: FormEvent) {
    event.preventDefault();
    if (validation.success) simulation.mutate(draft);
  }
  return (
    <div className="policy-columns">
      <section className="panel policy-editor">
        <div className="section-heading">
          <h2>Draft thresholds</h2>
          <span>Based on v{current.version}</span>
        </div>
        <form onSubmit={simulate}>
          <fieldset disabled={simulation.isPending || publication.isPending}>
            <label>
              Fast lane threshold
              <div className="input-unit">
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={
                    Number.isNaN(draft.fastThreshold) ? '' : draft.fastThreshold
                  }
                  onChange={(event) =>
                    update('fastThreshold', event.target.value)
                  }
                  required
                />
                <span>/ 10</span>
              </div>
              <small>
                Risk below this value can enter Fast lane when every guardrail
                passes.
              </small>
            </label>
            <label>
              Critical threshold
              <div className="input-unit">
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={
                    Number.isNaN(draft.criticalThreshold)
                      ? ''
                      : draft.criticalThreshold
                  }
                  onChange={(event) =>
                    update('criticalThreshold', event.target.value)
                  }
                  required
                />
                <span>/ 10</span>
              </div>
              <small>
                Risk at or above this value requires Critical review.
              </small>
            </label>
            <label>
              Minimum confidence
              <div className="input-unit">
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={
                    Number.isNaN(draft.confidenceThreshold)
                      ? ''
                      : draft.confidenceThreshold
                  }
                  onChange={(event) =>
                    update('confidenceThreshold', event.target.value)
                  }
                  required
                />
                <span>0–1</span>
              </div>
              <small>
                Lower confidence is routed to Needs triage, regardless of risk.
              </small>
            </label>
          </fieldset>
          <div className="guardrail-note">
            <LockKeyhole size={16} />
            <p>
              Mandatory guardrails stay active. Sensitive paths, CI, migrations,
              and ownership can require stricter review.
            </p>
          </div>
          <h3>
            Dimension weights <span className="subtle">Read-only</span>
          </h3>
          <dl className="weight-list">
            {dimensions.map((dimension) => (
              <div key={dimension}>
                <dt>{dimensionLabels[dimension]}</dt>
                <dd>{percent(draft.weights[dimension])}</dd>
              </div>
            ))}
          </dl>
          {!validation.success && (
            <p className="validation-message" role="alert">
              {validation.error.issues[0]?.message}
            </p>
          )}
          <button
            className="button primary"
            type="submit"
            disabled={
              !validation.success ||
              simulation.isPending ||
              publication.isPending
            }
          >
            <FlaskConical size={16} />
            {simulation.isPending ? 'Simulating…' : 'Simulate draft'}
          </button>
          <ErrorMessage error={simulation.error} />
        </form>
      </section>
      <div className="policy-results">
        <section className="panel current-policy">
          <div className="section-heading">
            <h2>Published policy</h2>
            <span className="version-badge">Version {current.version}</span>
          </div>
          <h3>{current.policy.name}</h3>
          <p className="subtle">
            Published {dateTime(current.publishedAt)} by {current.author}
          </p>
          <div className="published-thresholds">
            <div>
              <span>Fast lane below</span>
              <strong>{current.policy.fastThreshold.toFixed(1)}</strong>
            </div>
            <div>
              <span>Critical at</span>
              <strong>{current.policy.criticalThreshold.toFixed(1)}</strong>
            </div>
            <div>
              <span>Min. confidence</span>
              <strong>{percent(current.policy.confidenceThreshold)}</strong>
            </div>
          </div>
        </section>
        {result ? (
          <section className="panel" aria-label="Simulation preview">
            <div className="section-heading">
              <h2>Simulation preview</h2>
              <span>{result.evaluated} assessed PRs</span>
            </div>
            <div className="simulation-summary">
              <div>
                <strong>{result.changes.length}</strong>
                <span>lane changes</span>
              </div>
              <div>
                <strong>
                  {result.reviewerDemandBefore}
                  <ArrowRight size={17} />
                  {result.reviewerDemandAfter}
                </strong>
                <span>required reviewers</span>
              </div>
            </div>
            <div className="simulation-routes">
              {routes.map((route) => (
                <div key={route}>
                  <RouteBadge route={route} />
                  <strong>{result.routes[route]}</strong>
                </div>
              ))}
            </div>
            {result.changes.length ? (
              <ul className="simulation-changes">
                {result.changes.map((change) => (
                  <li key={change.id}>
                    <strong>{change.title}</strong>
                    <span className="subtle">{change.repository}</span>
                    <div>
                      <RouteBadge route={change.from} />
                      <ArrowRight size={14} />
                      <RouteBadge route={change.to} />
                    </div>
                    <p>
                      {change.direction === 'more' ? 'More' : 'Less'}{' '}
                      restricted: {change.reasons.join(' ')}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No PRs change lanes under this draft.</Empty>
            )}
            <p className="section-description">
              This preview uses stored assessments. Publication creates a policy
              version; existing decision history is preserved.
            </p>
          </section>
        ) : (
          <section className="panel simulation-placeholder">
            <FlaskConical size={28} />
            <h2>Preview before publishing</h2>
            <p>
              Adjust the thresholds, then simulate to see lane changes and
              reviewer demand.
            </p>
          </section>
        )}
        <section className="publish-panel">
          <div>
            <h3>Publish a new version</h3>
            <p>
              {result
                ? 'The current draft has a completed simulation.'
                : 'A completed simulation of the current draft is required.'}
            </p>
          </div>
          <button
            className="button"
            disabled={
              !result ||
              !validation.success ||
              simulation.isPending ||
              publication.isPending
            }
            onClick={() => publication.mutate()}
          >
            <Upload size={15} />
            {publication.isPending ? 'Publishing…' : 'Publish policy'}
          </button>
        </section>
        <ErrorMessage
          error={publication.error}
          retry={() => void client.invalidateQueries({ queryKey: ['policy'] })}
        />
      </div>
    </div>
  );
}
export function Policies() {
  const query = useQuery({
    queryKey: ['policy'],
    queryFn: () => api<PolicyVersion>('/api/policies/current'),
  });
  const [message, setMessage] = useState('');
  return (
    <>
      <PageHeading
        title="Policy simulator"
        description="Test review thresholds before making them policy."
      />
      {message && (
        <p role="status" className="route-feedback">
          {message}
        </p>
      )}
      <ErrorMessage error={query.error} retry={() => void query.refetch()} />
      {query.isPending && <Loading>Loading policy…</Loading>}
      {query.data && (
        <PolicyEditor
          key={query.data.version}
          current={query.data}
          onPublished={setMessage}
        />
      )}
    </>
  );
}
