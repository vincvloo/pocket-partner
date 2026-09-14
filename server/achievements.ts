import { db } from './db.js';
type Tier = { threshold: number; name: string; description: string };
type RateTier = { rate: number; name: string; description: string };
const plays: Tier[] = [
  { threshold: 1, name: 'Curtain Up', description: 'Completed your first rehearsal' },
  { threshold: 10, name: 'Dress Rehearsal', description: 'Completed 10 rehearsals' },
  { threshold: 25, name: 'Opening Night', description: 'Completed 25 rehearsals' },
  { threshold: 50, name: 'Standing Ovation', description: 'Completed 50 rehearsals' },
  { threshold: 100, name: 'Encore', description: 'Completed 100 rehearsals' },
  { threshold: 250, name: 'Long Run', description: 'Completed 250 rehearsals' },
];
const recordings: Tier[] = [
  { threshold: 1, name: 'Table Read', description: 'Recorded your first line' },
  { threshold: 25, name: 'Center Stage', description: 'Recorded 25 lines' },
  { threshold: 100, name: 'Leading Role', description: 'Recorded 100 lines' },
  { threshold: 250, name: 'Star of the Show', description: 'Recorded 250 lines' },
  { threshold: 500, name: 'Voice of the Company', description: 'Recorded 500 lines' },
];
const aiLines: Tier[] = [
  { threshold: 1, name: 'Casting Call', description: 'Prepared your first AI voice' },
  { threshold: 25, name: 'Stage Direction', description: 'Prepared 25 AI lines' },
  { threshold: 100, name: 'Full Production', description: 'Prepared 100 AI lines' },
  { threshold: 250, name: 'Grand Tour', description: 'Prepared 250 AI lines' },
  { threshold: 500, name: 'Broadway Bound', description: 'Prepared 500 AI lines' },
];
const hintFreeMinAttempts = 10;
const hintFreeRateTiers: RateTier[] = [
  { rate: 0.5, name: 'Off Book', description: 'Hint-free on half your cues — reciting from memory' },
  { rate: 0.75, name: 'Word Perfect', description: 'Hint-free on three-quarters of your cues' },
  { rate: 0.95, name: 'Letter Perfect', description: 'Hint-free on 95% of your cues' },
];
const rememberedMinLines = 5;
const rememberedRateTiers: RateTier[] = [
  { rate: 0.75, name: 'Script Free', description: 'Marked three-quarters of your practiced lines Remembered' },
  { rate: 1, name: 'Take a Bow', description: 'Marked every practiced line Remembered' },
];
function countBadges(category: string, tiers: Tier[], current: number) {
  return tiers.map((t) => {
    const shown = Math.min(current, t.threshold);
    return {
      id: category + '-' + t.threshold,
      category,
      name: t.name,
      description: t.description,
      achieved: current >= t.threshold,
      current: shown,
      threshold: t.threshold,
      progressText: shown + ' / ' + t.threshold,
    };
  });
}
function rateBadges(
  category: string,
  tiers: RateTier[],
  rate: number | null,
  sample: number,
  minSample: number,
  sampleNoun: string,
) {
  const qualified = sample >= minSample;
  return tiers.map((t) => {
    const current = qualified ? Math.min(100, Math.round((rate || 0) * 100)) : sample;
    const threshold = qualified ? Math.round(t.rate * 100) : minSample;
    return {
      id: category + '-' + Math.round(t.rate * 100),
      category,
      name: t.name,
      description: t.description,
      achieved: qualified && rate !== null && rate >= t.rate,
      current,
      threshold,
      progressText: qualified
        ? current + '% / ' + threshold + '%'
        : sample + ' of ' + minSample + ' ' + sampleNoun + ' logged',
    };
  });
}
export async function recordLineRecording(uid: string) {
  await db.query(
    'INSERT INTO user_stats(uid,recordings) VALUES($1,1) ON CONFLICT(uid) DO UPDATE SET recordings=user_stats.recordings+1',
    [uid],
  );
}
export async function statsFor(uid: string) {
  const { rows: practiceRows } = await db.query(
    `SELECT coalesce(sum(attempts),0)::int AS attempts, coalesce(sum(hints),0)::int AS hints, count(*) FILTER (WHERE remembered>0)::int AS remembered_lines, count(*)::int AS total_lines FROM practice WHERE uid=$1`,
    [uid],
  );
  const { rows: statRows } = await db.query(
    'SELECT plays,recordings,ai_lines FROM user_stats WHERE uid=$1',
    [uid],
  );
  const { attempts, hints, remembered_lines, total_lines } = practiceRows[0];
  const stats = statRows[0] || { plays: 0, recordings: 0, ai_lines: 0 };
  const hintFreeRate = attempts > 0 ? (attempts - hints) / attempts : null;
  const rememberedRate = total_lines > 0 ? remembered_lines / total_lines : null;
  return {
    hintFreeRate,
    rememberedRate,
    plays: Number(stats.plays),
    recordings: Number(stats.recordings),
    aiLines: Number(stats.ai_lines),
    badges: [
      ...countBadges('plays', plays, Number(stats.plays)),
      ...countBadges('recordings', recordings, Number(stats.recordings)),
      ...countBadges('aiLines', aiLines, Number(stats.ai_lines)),
      ...rateBadges(
        'hintFreeRate',
        hintFreeRateTiers,
        hintFreeRate,
        attempts,
        hintFreeMinAttempts,
        'attempts',
      ),
      ...rateBadges(
        'rememberedRate',
        rememberedRateTiers,
        rememberedRate,
        total_lines,
        rememberedMinLines,
        'practiced lines',
      ),
    ],
  };
}
