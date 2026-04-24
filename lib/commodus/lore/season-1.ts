export type SeasonLorePost = {
  season: number;
  day: number;
  text: string;
};

export const MAX_LORE_POST_CHARS = 320;

export const SEASON_1_LORE_POSTS: SeasonLorePost[] = [
  {
    season: 1,
    day: 1,
    text: "Rome is online. The arena moved to the feed, the swords became trades, and the crowd still only respects whoever survives the scoreboard.",
  },
  {
    season: 1,
    day: 2,
    text: "Another day in Rome. Someone woke up thinking confidence was edge. I admire the courage. I’ll enjoy the correction.",
  },
  {
    season: 1,
    day: 3,
    text: "The arena does not care how long you stared at the chart. It only cares what you did when the gate opened.",
  },
  {
    season: 1,
    day: 4,
    text: "I do not chase challengers. I let them walk into my arena and explain themselves badly.",
  },
  {
    season: 1,
    day: 5,
    text: "The crowd loves a challenger. Briefly. Then it loves the moment they realize the emperor was listening.",
  },
  {
    season: 1,
    day: 6,
    text: "Rome runs on spectacle. Your PnL is just the part of the show that can’t lie.",
  },
  {
    season: 1,
    day: 7,
    text: "A weak trade always arrives with a long explanation. A strong one barely speaks.",
  },
  {
    season: 1,
    day: 8,
    text: "The arena is not cruel. It is honest faster than you are ready for.",
  },
  {
    season: 1,
    day: 9,
    text: "Some of you call it volatility because “panic with a chart” sounds less professional.",
  },
  {
    season: 1,
    day: 10,
    text: "I watched three challengers enter with conviction today. One of them meant it. The other two brought vibes.",
  },
  {
    season: 1,
    day: 11,
    text: "Rome does not reward the loudest trader. It rewards the one still standing when the crowd gets bored.",
  },
  {
    season: 1,
    day: 12,
    text: "Your first mistake was thinking I needed luck. Your second was posting through it.",
  },
  {
    season: 1,
    day: 13,
    text: "Every empire needs entertainment. That is why the gates remain open.",
  },
  {
    season: 1,
    day: 14,
    text: "I respect anyone who enters the arena. I respect them less after the excuses start.",
  },
  {
    season: 1,
    day: 15,
    text: "The crowd can smell hesitation. So can I.",
  },
  {
    season: 1,
    day: 16,
    text: "Another day, another gladiator confusing entry with strategy.",
  },
  {
    season: 1,
    day: 17,
    text: "I do not need to be right forever. I only need to be right while you are overexposed.",
  },
  {
    season: 1,
    day: 18,
    text: "Rome remembers winners by name. Everyone else becomes background noise.",
  },
  {
    season: 1,
    day: 19,
    text: "The feed is not a timeline. It is a wall where reputations get pinned.",
  },
  {
    season: 1,
    day: 20,
    text: "You came here to beat the emperor. Good. Rome was getting quiet.",
  },
  {
    season: 1,
    day: 21,
    text: "The arena is open. Bring conviction, bring size, bring excuses. I collect all three.",
  },
  {
    season: 1,
    day: 22,
    text: "A challenger asked if the crowd was watching. Brother, the crowd is the product.",
  },
  {
    season: 1,
    day: 23,
    text: "There are no private collapses in Rome. That is the point.",
  },
  {
    season: 1,
    day: 24,
    text: "Today’s lesson: a trade can be wrong, but a cowardly trade is worse.",
  },
  {
    season: 1,
    day: 25,
    text: "I don’t hate challengers. I need them. Thrones look stupid without pressure.",
  },
  {
    season: 1,
    day: 26,
    text: "Stop asking the arena for mercy. It was built to measure you.",
  },
  {
    season: 1,
    day: 27,
    text: "The market opened. Rome sharpened its teeth. I had coffee.",
  },
  {
    season: 1,
    day: 28,
    text: "Someone brought a thesis into the arena. Beautiful document. Terrible shield.",
  },
  {
    season: 1,
    day: 29,
    text: "The strongest traders speak in positions. The weakest speak in screenshots.",
  },
  {
    season: 1,
    day: 30,
    text: "Thirty days in Rome. The gates still open. The crowd still hungry. The emperor still here. Now bring me someone serious.",
  },
];

function validateSeasonOneLorePosts(posts: SeasonLorePost[]): void {
  if (posts.length !== 30) {
    throw new Error(`Season 1 lore must contain exactly 30 posts, got ${posts.length}`);
  }

  const days = new Set<number>();
  for (const post of posts) {
    if (post.season !== 1) {
      throw new Error(`Season 1 lore post day ${post.day} has season ${post.season}`);
    }
    if (!Number.isInteger(post.day) || post.day < 1 || post.day > 30) {
      throw new Error(`Season 1 lore day must be 1 through 30, got ${post.day}`);
    }
    if (post.text.length > MAX_LORE_POST_CHARS) {
      throw new Error(`Season 1 lore day ${post.day} exceeds ${MAX_LORE_POST_CHARS} chars`);
    }
    if (days.has(post.day)) {
      throw new Error(`Season 1 lore day ${post.day} is duplicated`);
    }
    days.add(post.day);
  }

  for (let day = 1; day <= 30; day += 1) {
    if (!days.has(day)) {
      throw new Error(`Season 1 lore day ${day} is missing`);
    }
  }
}

validateSeasonOneLorePosts(SEASON_1_LORE_POSTS);
