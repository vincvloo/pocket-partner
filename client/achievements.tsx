import { useEffect, useState } from 'react';
import type { Context } from './App';
import type { Stats, Badge } from './types';
import { Icon } from './icons';
import { Pill } from './views';
import { api } from './api';
const categories: Record<string, string> = {
  plays: 'Rehearsals completed',
  recordings: 'Lines recorded',
  aiLines: 'AI lines prepared',
  hintFreeRate: 'Hint-free rate',
  rememberedRate: 'Remembered rate',
};
function pct(value: number | null) {
  return value === null ? '—' : Math.round(value * 100) + '%';
}
function BadgeCard({ badge }: { badge: Badge }) {
  return (
    <article className={'badge-card ' + (badge.achieved ? 'achieved' : 'locked')}>
      <div className="badge-card-top">
        <Icon name={badge.achieved ? 'check' : 'lock'} />
        <b>{badge.name}</b>
      </div>
      <p>{badge.description}</p>
      {!badge.achieved && (
        <div className="badge-progress" aria-label={badge.name + ' progress'}>
          <div
            className="badge-progress-fill"
            style={{ width: Math.min(100, (badge.current / badge.threshold) * 100) + '%' }}
          />
          <small>{badge.progressText}</small>
        </div>
      )}
    </article>
  );
}
export function AchievementsView({ ctx }: { ctx: Context }) {
  const [stats, setStats] = useState<Stats | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    api<Stats>('/me/stats')
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Your achievements</h1>
          <p>Milestones from every group you rehearse with.</p>
        </div>
        <Pill>
          <Icon name="lock" />
          Only you
        </Pill>
      </div>
      {error ? (
        <div className="empty">
          <p>{error}</p>
        </div>
      ) : !stats ? (
        <div className="empty">Gathering your achievements…</div>
      ) : (
        <>
          <div className="progress-cards">
            <div className="stat-card">
              <Icon name="spark" />
              <strong>{pct(stats.hintFreeRate)}</strong>
              <p>Hint-free rate</p>
            </div>
            <div className="stat-card">
              <Icon name="check" />
              <strong>{pct(stats.rememberedRate)}</strong>
              <p>Remembered rate</p>
            </div>
            <div className="stat-card">
              <Icon name="play" />
              <strong>{stats.plays}</strong>
              <p>Rehearsals completed</p>
            </div>
            <div className="stat-card">
              <Icon name="mic" />
              <strong>{stats.recordings}</strong>
              <p>Lines recorded</p>
            </div>
            <div className="stat-card">
              <Icon name="volume" />
              <strong>{stats.aiLines}</strong>
              <p>AI lines prepared</p>
            </div>
          </div>
          {Object.entries(categories).map(([category, label]) => {
            const badges = stats.badges.filter((b) => b.category === category);
            if (!badges.length) return null;
            return (
              <div key={category}>
                <div className="section-heading">
                  <h2>{label}</h2>
                  <span className="small muted">
                    {badges.filter((b) => b.achieved).length} / {badges.length} earned
                  </span>
                </div>
                <div className="badge-grid">
                  {badges.map((b) => (
                    <BadgeCard badge={b} key={b.id} />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
