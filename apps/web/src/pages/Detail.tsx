import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  FileCode2,
  GitPullRequest,
  Play,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  routeLabels,
  routes,
  type PullRequestDetail,
  type Route,
} from '@prism/shared';
import { api, usePullRequestAction } from '../api';
import { AuditTimeline } from '../components/AuditTimeline';
import { RiskScores } from '../components/RiskScores';
import {
  Empty,
  ErrorMessage,
  Loading,
  RouteBadge,
  dateTime,
  percent,
  risk,
} from '../components/ui';

function OverrideForm({ pr }: { pr: PullRequestDetail }) {
  const [route, setRoute] = useState<Route>(
    pr.route === 'incoming' ? 'standard' : pr.route,
  );
  const [reason, setReason] = useState('');
  const mutation = usePullRequestAction(pr.id, 'overrides');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) return;
    mutation.mutate(
      { route, reason: reason.trim(), actor: 'demo-operator' },
      { onSuccess: () => setReason('') },
    );
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Manual override</h2>
        <ShieldCheck size={17} />
      </div>
      <p className="section-description">
        Record a different review route with a reason. Previous decisions remain
        in the audit trail.
      </p>
      {pr.decision ? (
        <form onSubmit={submit} className="override-form">
          <label>
            Override route
            <select
              value={route}
              onChange={(event) => {
                setRoute(event.target.value as Route);
                mutation.reset();
              }}
            >
              {routes.map((value) => (
                <option value={value} key={value}>
                  {routeLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Override reason
            <textarea
              placeholder="Explain the evidence behind this decision…"
              value={reason}
              maxLength={2000}
              onChange={(event) => {
                setReason(event.target.value);
                mutation.reset();
              }}
              rows={3}
              required
            />
          </label>
          <button
            className="button"
            type="submit"
            disabled={!reason.trim() || mutation.isPending}
          >
            {mutation.isPending ? 'Recording…' : 'Apply override'}
          </button>
          <ErrorMessage error={mutation.error} />
          {mutation.isSuccess && (
            <p role="status" className="success-message">
              Override recorded. Audit history updated.
            </p>
          )}
        </form>
      ) : (
        <Empty>Run triage before applying an override.</Empty>
      )}
    </section>
  );
}
export function Detail() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['pull-request', id],
    queryFn: () =>
      api<PullRequestDetail>(`/api/pull-requests/${encodeURIComponent(id)}`),
  });
  const triage = usePullRequestAction(id, 'assessments');
  const pr = query.data;
  return (
    <>
      <Link className="back-link" to="/">
        <ArrowLeft size={15} />
        Back to command center
      </Link>
      <ErrorMessage error={query.error} retry={() => void query.refetch()} />
      {query.isPending && <Loading>Loading pull request…</Loading>}
      {pr && (
        <>
          <div className="detail-heading">
            <div className="detail-repo">
              <GitPullRequest size={16} />
              {pr.repository}
              <span>#{pr.number}</span>
              <RouteBadge route={pr.route} />
            </div>
            <h1>{pr.title}</h1>
            <p>
              {pr.author}
              <span>Revision {pr.revision.slice(0, 10)}</span>
              <span>Opened {dateTime(pr.createdAt)}</span>
            </p>
          </div>
          <div className="decision-summary">
            <div>
              <span className="subtle">Aggregate risk</span>
              <strong>{risk(pr.decision?.aggregateRisk)}</strong>
            </div>
            <div>
              <span className="subtle">Confidence</span>
              <strong>{percent(pr.decision?.confidence)}</strong>
            </div>
            <div>
              <span className="subtle">Policy</span>
              <strong>
                {pr.decision
                  ? `Version ${pr.decision.policyVersion}`
                  : 'Pending assessment'}
              </strong>
            </div>
            <div>
              <span className="subtle">Assessment source</span>
              <strong>
                {pr.assessment
                  ? `${pr.assessment.provider === 'demo' ? 'Demo' : 'Live'} · ${pr.assessment.status}`
                  : 'Not assessed'}
              </strong>
            </div>
            {(pr.route === 'incoming' ||
              (pr.assessment?.status === 'failed' &&
                pr.decision?.kind !== 'override')) && (
              <button
                className="button primary"
                disabled={triage.isPending}
                onClick={() => triage.mutate({})}
              >
                <Play size={14} />
                {triage.isPending
                  ? 'Assessing…'
                  : pr.assessment?.status === 'failed'
                    ? 'Retry assessment'
                    : 'Run triage'}
              </button>
            )}
          </div>
          <ErrorMessage error={triage.error} retry={() => triage.mutate({})} />
          {pr.assessment?.status === 'failed' && (
            <div className="error-message" role="status">
              Assessment unavailable (
              {pr.assessment.errorCode ?? 'provider error'}). Human triage is
              required; risk and confidence are unavailable.
            </div>
          )}
          <div className="detail-columns">
            <div className="detail-primary">
              {pr.assessment?.scores.length ? (
                <RiskScores scores={pr.assessment.scores} />
              ) : (
                <section className="panel">
                  <h2>Risk assessment</h2>
                  <Empty>
                    {pr.assessment?.status === 'failed'
                      ? 'The provider did not return usable scores.'
                      : 'Run triage to assess the five risk dimensions.'}
                  </Empty>
                </section>
              )}
              <section className="panel" aria-label="Decision trace">
                <div className="section-heading">
                  <h2>Decision trace</h2>
                  <span>Immutable history</span>
                </div>
                {pr.decisions.length ? (
                  <div className="decision-history">
                    {[...pr.decisions]
                      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                      .map((decision) => (
                        <div className="trace-entry" key={decision.id}>
                          <div className="trace-heading">
                            <RouteBadge route={decision.route} />
                            <span>
                              {decision.kind === 'override'
                                ? 'Manual override'
                                : 'Policy assessment'}{' '}
                              · v{decision.policyVersion}
                            </span>
                          </div>
                          <ol>
                            {decision.reasons.map((reason, index) => (
                              <li key={index}>{reason}</li>
                            ))}
                          </ol>
                          {decision.overrideReason && (
                            <blockquote>{decision.overrideReason}</blockquote>
                          )}
                          <p className="subtle">
                            {decision.actor} · {dateTime(decision.createdAt)}
                          </p>
                        </div>
                      ))}
                  </div>
                ) : (
                  <Empty>No routing decision yet.</Empty>
                )}
              </section>
              <section className="panel" aria-label="Audit history">
                <div className="section-heading">
                  <h2>Audit history</h2>
                  <span>{pr.auditEvents.length} events</span>
                </div>
                <AuditTimeline events={pr.auditEvents} />
              </section>
            </div>
            <div className="detail-secondary">
              <section className="panel">
                <div className="section-heading">
                  <h2>Change evidence</h2>
                  <FileCode2 size={17} />
                </div>
                <p className="pr-description">{pr.description}</p>
                <dl className="evidence-list">
                  <div>
                    <dt>Files changed</dt>
                    <dd>{pr.evidence.filesChanged}</dd>
                  </div>
                  <div>
                    <dt>Lines</dt>
                    <dd>
                      <span className="added">+{pr.evidence.linesAdded}</span> /
                      −{pr.evidence.linesDeleted}
                    </dd>
                  </div>
                  <div>
                    <dt>CI status</dt>
                    <dd className={`ci-${pr.evidence.ci}`}>{pr.evidence.ci}</dd>
                  </div>
                  <div>
                    <dt>Repository criticality</dt>
                    <dd>{pr.evidence.repositoryCriticality}</dd>
                  </div>
                  <div>
                    <dt>Database migration</dt>
                    <dd>{pr.evidence.hasMigration ? 'Yes' : 'No'}</dd>
                  </div>
                  <div>
                    <dt>Owner coverage</dt>
                    <dd>{pr.evidence.ownerCoverage ? 'Covered' : 'Missing'}</dd>
                  </div>
                </dl>
                <h3>Changed paths</h3>
                <ul className="path-list">
                  {pr.evidence.paths.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
                <h3>Sensitive paths</h3>
                {pr.evidence.sensitivePaths.length ? (
                  <ul className="path-list">
                    {pr.evidence.sensitivePaths.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="subtle">None identified</p>
                )}
                <h3>Rollback plan</h3>
                <p className="section-description">
                  {pr.evidence.rollback || 'Not provided'}
                </p>
              </section>
              <section className="panel">
                <div className="section-heading">
                  <h2>Review requirements</h2>
                  <Users size={17} />
                </div>
                {pr.decision ? (
                  <>
                    <div className="requirement-numbers">
                      <div>
                        <strong>{pr.decision.requirements.count}</strong>
                        <span>reviewers required</span>
                      </div>
                      <div>
                        <strong>{pr.decision.requirements.slaHours}h</strong>
                        <span>response SLA</span>
                      </div>
                    </div>
                    <div className="skill-tags">
                      {pr.decision.requirements.skills.map((skill) => (
                        <span key={skill}>{skill}</span>
                      ))}
                    </div>
                    <h3>Suggested reviewers</h3>
                    {pr.suggestedReviewers.length ? (
                      <ul className="reviewer-list">
                        {pr.suggestedReviewers.map((reviewer) => (
                          <li key={reviewer.id}>
                            <span className="avatar">
                              {reviewer.name
                                .split(' ')
                                .map((part) => part[0])
                                .slice(0, 2)
                                .join('')}
                            </span>
                            <div>
                              <strong>{reviewer.name}</strong>
                              <span>
                                {reviewer.activeAssignments} /{' '}
                                {reviewer.capacity} assignments ·{' '}
                                {reviewer.available
                                  ? 'Available'
                                  : 'Unavailable'}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="subtle">No eligible reviewers available.</p>
                    )}
                    <h3>Downstream steps</h3>
                    <ul className="downstream-list">
                      {pr.decision.downstreamSteps.map((step) => (
                        <li key={step}>
                          <CheckCircle2 size={14} />
                          {step}
                        </li>
                      ))}
                    </ul>
                    <p className="merge-note">
                      {pr.decision.autoMergeEligible
                        ? 'Auto-merge eligible after required checks. PRISM does not merge changes.'
                        : 'Human approval required before merge.'}
                    </p>
                  </>
                ) : (
                  <Empty>Requirements appear after triage.</Empty>
                )}
              </section>
              <OverrideForm pr={pr} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
