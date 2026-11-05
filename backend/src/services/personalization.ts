export interface Candidate {
  id: string;
  title: string;
  category: string;
  tags: string[];
  videoUrl: string;
  publishedAt?: string | null;
}

export interface RankedCandidate extends Candidate {
  score: number;
  reasons: string[];
}

export interface RankContext {
  interests: string[];
  watched: string[];
  favorites: string[];
  positive: string[];
  negative: string[];
  dismissedCategories: string[];
  now?: string;
}

const INTEREST_WEIGHT = 0.4;
const HISTORY_WEIGHT = 0.25;
const FEEDBACK_WEIGHT = 0.15;
const RELEVANCE_WEIGHT = 0.1;
const FRESHNESS_WEIGHT = 0.1;

export function groundedTopics(category: string, keywords: string[], tags: string[]): string[] {
  const hay = `${category} ${keywords.join(' ')} ${tags.join(' ')}`.toLowerCase();
  const topics = new Set<string>([category.toLowerCase()]);
  const rules: Array<[string, RegExp]> = [
    ['motorsport', /\b(f1|formula|motorsport|racing|grand prix)\b/],
    ['sports', /\b(sport|f1|formula|racing)\b/],
    ['nature', /\b(nature|forest|waterfall|wildlife|ocean|mountain)\b/],
    ['food', /\b(food|cooking|dessert|restaurant)\b/],
    ['technology', /\b(technology|software|computer|gadget)\b/],
    ['travel', /\b(travel|city|beach)\b/],
    ['animals', /\b(animal|wildlife|pet)\b/],
  ];
  for (const [topic, pattern] of rules) {
    if (pattern.test(hay)) topics.add(topic);
  }
  return [...topics];
}

export function topicMatches(interests: string[], category: string, keywords: string[]): boolean {
  const hay = `${category} ${keywords.join(' ')} ${groundedTopics(category, keywords, []).join(' ')}`.toLowerCase();
  return interests.some((interest) => hay.includes(interest.toLowerCase()));
}

export function playable(video: Candidate): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(video.id) && video.videoUrl.startsWith('https://') && video.title.trim().length > 0;
}

export function rankCandidates(videos: Candidate[], context: RankContext): RankedCandidate[] {
  const now = Date.parse(context.now ?? new Date().toISOString());
  const historyCategories = new Set(
    videos.filter((video) => context.watched.includes(video.id)).map((video) => video.category.toLowerCase()),
  );
  const ranked = videos.filter(playable).filter((video) => !context.watched.includes(video.id)).map((video) => {
    const topics = groundedTopics(video.category, video.tags, []);
    const interest = topicMatches(context.interests, video.category, video.tags) ? 1 : 0;
    const history = topics.some((topic) => historyCategories.has(topic)) || historyCategories.has(video.category.toLowerCase()) ? 1 : 0;
    const saved = context.favorites.includes(video.id) || context.positive.includes(video.id);
    const feedback = saved ? 1 : 0;
    const published = video.publishedAt ? Date.parse(video.publishedAt) : now;
    const freshness = Number.isFinite(published) && now - published < 7 * 24 * 60 * 60 * 1000 ? 1 : 0.4;
    let score = interest * INTEREST_WEIGHT + history * HISTORY_WEIGHT + feedback * FEEDBACK_WEIGHT + interest * RELEVANCE_WEIGHT + freshness * FRESHNESS_WEIGHT;
    const reasons = [
      interest ? 'explicit interest' : '',
      history ? 'watch history' : '',
      saved ? 'favorite or positive feedback' : '',
      freshness === 1 ? 'recent' : 'older',
    ].filter(Boolean);
    if (context.dismissedCategories.some((category) => topics.includes(category.toLowerCase()) || category.toLowerCase() === video.category.toLowerCase())) {
      score *= 0.2;
      reasons.push('dismissed category');
    }
    if (context.negative.includes(video.id)) {
      score *= 0.2;
      reasons.push('negative feedback');
    }
    return { ...video, score, reasons };
  });
  return diversify(ranked.sort((left, right) => right.score - left.score), 12);
}

export function diversify<T extends { category: string }>(items: T[], limit: number): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.category.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const output: T[] = [];
  while (output.length < limit) {
    let added = false;
    for (const rows of groups.values()) {
      const next = rows.shift();
      if (!next) continue;
      output.push(next);
      added = true;
      if (output.length >= limit) break;
    }
    if (!added) break;
  }
  return output;
}

export function recommendationSections(videos: Candidate[], context: RankContext): Array<{ title: string; videos: RankedCandidate[] }> {
  const ranked = rankCandidates(videos, context);
  const sections: Array<{ title: string; videos: RankedCandidate[] }> = [];
  for (const interest of context.interests) {
    const rows = ranked.filter((video) => topicMatches([interest], video.category, video.tags));
    if (!rows.length) continue;
    sections.push({ title: `Because You Like ${labelFor(interest)}`, videos: rows.slice(0, 6) });
  }
  const known = new Set(sections.flatMap((section) => section.videos.map((video) => video.id)));
  const fresh = ranked.filter((video) => !known.has(video.id));
  if (fresh.length) sections.push({ title: 'Explore Something New', videos: fresh.slice(0, 6) });
  return sections;
}

export function guestFeed(videos: Candidate[]): { personalized: false; videos: Candidate[] } {
  return { personalized: false, videos: videos.filter(playable) };
}

function labelFor(interest: string): string {
  const labels: Record<string, string> = {
    motorsport: 'Motorsport',
    entertainment: 'Movies',
    nature: 'Nature',
    food: 'Food',
    technology: 'Technology',
  };
  return labels[interest] ?? interest.charAt(0).toUpperCase() + interest.slice(1);
}

export function schedulerGate(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; confirm: boolean; willSend: boolean } {
  const enabled = env.SCHEDULER_ENABLED === 'true';
  const confirm = env.SCHEDULER_CONFIRM === 'true';
  return { enabled, confirm, willSend: enabled && confirm };
}
