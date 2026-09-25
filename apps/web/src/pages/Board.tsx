import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  GitPullRequest,
  Play,
  Search,
  Users,
  XCircle,
} from 'lucide-react';
import {
  dimensionLabels,
  routeLabels,
  routes,
  type PullRequest,
  type Route,
} from '@prism/shared';
import { api, usePullRequestAction } from '../api';
import {
  Empty,
  ErrorMessage,
  Loading,
  PageHeading,
  RouteBadge,
  percent,
  risk,
} from '../components/ui';

function PullRequestCard({
  pr,
  onRouted,
}: {
  pr: PullRequest;
  onRouted: (message: string) => void;
}) {
  const triage = usePullRequestAction(pr.id, 'assessments');
  const dimensions = [...(pr.assessment?.scores ?? [])]
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  const canAssess =
    pr.route === 'incoming' ||
    (pr.assessment?.status === 'failed' && pr.decision?.kind !== 'override');
  return (
    <article
      className="pr-card"
      aria-label={`${pr.repository} pull request ${pr.number}`}
    >
      <div className="card-meta">
        <span>{pr.repository}</span>
        <span>#{pr.number}</span>
      </div>
      {pr.assessment?.provider === 'demo' && (
        <span className="assessment-source-marker">Demo assessment</span>
      )}
      <Link className="card-title" to={`/pull-requests/${pr.id}`}>
        {pr.title}
        <ArrowUpRight size={14} />
      </Link>
      <div className="card-author">
        <GitPullRequest size={13} />
        {pr.author}
        <span className={`ci ci-${pr.evidence.ci}`}>
          {pr.evidence.ci === 'passed' ? (
            <CheckCircle2 size={12} />
          ) : pr.evidence.ci === 'failed' ? (
            <XCircle size={12} />
          ) : (
            <Clock3 size={12} />
          )}
          CI {pr.evidence.ci}
        </span>
      </div>
      <div className="card-divider" />
      <RouteBadge route={pr.route} />
      <dl className="card-metrics">
        <div>
          <dt>Risk</dt>
          <dd>{risk(pr.decision?.aggregateRisk)}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{percent(pr.decision?.confidence)}</dd>
        </div>
      </dl>
      {dimensions.length ? (
        <div className="top-dimensions">
          {dimensions.map((score) => (
            <div key={score.dimension}>
              <span>{dimensionLabels[score.dimension]}</span>
              <b>{score.score.toFixed(1)}</b>
            </div>
          ))}
        </div>
      ) : (
        <p className="unassessed">Awaiting evidence assessment</p>
      )}
      <div className="card-requirements">
        <span>
          <Users size={13} />
          {pr.decision
            ? `${pr.decision.requirements.count} reviewers`
            : 'Reviewers pending'}
        </span>
        <span>
          <Clock3 size={13} />
          {pr.decision
            ? `${pr.decision.requirements.slaHours}h SLA`
            : 'SLA pending'}
        </span>
      </div>
      {canAssess && (
        <button
          className="button triage-button"
          disabled={triage.isPending}
          onClick={() =>
            triage.mutate(
              {},
              {
                onSuccess: (data) =>
                  onRouted(
                    `${data.repository} routed to ${routeLabels[data.route]}. ${data.decision?.reasons[0] ?? ''}`,
                  ),
              },
            )
          }
        >
          <Play size={13} />
          {triage.isPending
            ? 'Assessing…'
            : pr.assessment?.status === 'failed'
              ? 'Retry assessment'
              : 'Run triage'}
        </button>
      )}
      <ErrorMessage error={triage.error} retry={() => triage.mutate({})} />
    </article>
  );
}
export function Board() {
  const query = useQuery({
    queryKey: ['pull-requests'],
    queryFn: () => api<PullRequest[]>('/api/pull-requests'),
  });
  const [search, setSearch] = useState('');
  const [repository, setRepository] = useState('');
  const [feedback, setFeedback] = useState('');
  const prs = query.data ?? [];
  const filtered = prs.filter(
    (pr) =>
      (!repository || pr.repository === repository) &&
      `${pr.title} ${pr.repository} ${pr.author} ${pr.number}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const lanes: Array<Route | 'incoming'> = ['incoming', ...routes];
  return (
    <>
      <PageHeading
        title="Command center"
        description="The right review path for every change."
      >
        <span className="heading-count">
          <GitPullRequest size={16} />
          {prs.length} open pull requests
        </span>
      </PageHeading>
      <div className="board-toolbar">
        <label className="search-control">
          <Search size={17} />
          <input
            aria-label="Search pull requests"
            placeholder="Search pull requests, authors…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="filter-control">
          <span>Repository</span>
          <select
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
          >
            <option value="">All repositories</option>
            {[...new Set(prs.map((pr) => pr.repository))].sort().map((repo) => (
              <option key={repo}>{repo}</option>
            ))}
          </select>
        </label>
        <span className="toolbar-caption">Policy-driven routing</span>
      </div>
      {feedback && (
        <div className="route-feedback" role="status">
          <CheckCircle2 size={16} />
          {feedback}
          <button
            aria-label="Dismiss routing feedback"
            onClick={() => setFeedback('')}
          >
            ×
          </button>
        </div>
      )}
      <ErrorMessage error={query.error} retry={() => void query.refetch()} />
      {query.isPending ? (
        <Loading />
      ) : (
        query.data && (
          <div className="lane-scroller" aria-label="Review lanes">
            <div className="board-lanes">
              {lanes.map((lane) => {
                const items = filtered.filter((pr) => pr.route === lane);
                return (
                  <section
                    className={`lane route-${lane}`}
                    key={lane}
                    aria-label={`${routeLabels[lane]} lane`}
                  >
                    <header className="lane-header">
                      <h2>
                        <span className="route-dot" />
                        {routeLabels[lane]}
                      </h2>
                      <span className="lane-count">{items.length}</span>
                    </header>
                    <p className="lane-description">
                      {
                        {
                          incoming: 'Ready for assessment',
                          fast: 'Low risk, lighter review',
                          standard: 'Peer review required',
                          critical: 'Expert review required',
                          triage: 'Human judgment needed',
                        }[lane]
                      }
                    </p>
                    <div className="lane-cards">
                      {items.map((pr) => (
                        <PullRequestCard
                          pr={pr}
                          key={pr.id}
                          onRouted={setFeedback}
                        />
                      ))}
                      {!items.length && (
                        <Empty>
                          {search || repository
                            ? 'No matching pull requests'
                            : 'No pull requests'}
                        </Empty>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )
      )}
      <div className="board-footnote">
        <ShieldLabel /> Routing recommends review requirements. Your repository
        protections remain the source of truth.
      </div>
    </>
  );
}
function ShieldLabel() {
  return <span className="footnote-indicator" />;
}
