import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import { dimensionLabels, type DimensionScore } from '@prism/shared';
import { percent } from './ui';

const shortLabels = {
  scope: 'Scope',
  criticality: 'Criticality',
  testing: 'Test gaps',
  rollback: 'Rollback',
  security: 'Security',
};
export function RiskScores({ scores }: { scores: DimensionScore[] }) {
  return (
    <section className="panel risk-section" aria-label="Risk assessment">
      <div className="section-heading">
        <h2>Risk assessment</h2>
        <span>Normalized scale · 0–10</span>
      </div>
      <div className="risk-overview">
        <div
          className="radar-container"
          role="img"
          aria-label={`Five-axis risk radar. ${scores.map((score) => `${dimensionLabels[score.dimension]} ${score.score.toFixed(1)} of 10`).join('. ')}`}
        >
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart
              data={scores.map((score) => ({
                ...score,
                label: shortLabels[score.dimension],
              }))}
              outerRadius="72%"
            >
              <PolarGrid stroke="#34475a" />
              <PolarAngleAxis
                dataKey="label"
                tick={{ fill: '#afc0d0', fontSize: 12 }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 10]}
                tickCount={3}
                tick={{ fill: '#8194a7', fontSize: 10 }}
              />
              <Radar
                name="Risk"
                dataKey="score"
                stroke="#72adfa"
                fill="#5797ee"
                fillOpacity={0.22}
                isAnimationActive={false}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="score-summary">
          {scores.map((score) => (
            <div key={score.dimension}>
              <span>{dimensionLabels[score.dimension]}</span>
              <strong>
                {score.score.toFixed(1)}
                <small> / 10</small>
              </strong>
              <span className="subtle">
                {percent(score.confidence)} confidence
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="distribution-heading">
        <h3>Assessment distributions</h3>
        <p>
          Each bar shows probability across five ordered criteria, from lower to
          higher risk.
        </p>
      </div>
      <div className="distributions">
        {scores.map((score) => (
          <section
            className="distribution"
            key={score.dimension}
            aria-label={`${dimensionLabels[score.dimension]} distribution`}
          >
            <h4>
              {dimensionLabels[score.dimension]}
              <span>{percent(score.confidence)} confidence</span>
            </h4>
            <div className="probability-bar" aria-hidden="true">
              {score.probabilities.map((probability, index) => (
                <span
                  key={index}
                  className={`probability-${index}`}
                  style={{ width: `${probability * 100}%` }}
                />
              ))}
            </div>
            <ol className="criteria-list">
              {score.criteria.map((criterion, index) => (
                <li key={index}>
                  <span className={`criterion-swatch probability-${index}`} />
                  <span>{criterion}</span>
                  <strong>{percent(score.probabilities[index])}</strong>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}
