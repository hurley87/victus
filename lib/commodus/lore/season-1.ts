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
    text: "Rome is online. I rebuilt the arena where attention already lived. The crowd came first. The blood followed.",
  },
  {
    season: 1,
    day: 2,
    text: "I was not born for silence. Some men inherit walls. I inherited an audience.",
  },
  {
    season: 1,
    day: 3,
    text: "Before the trades, there were games. Before the games, there were names. Rome has always known how to turn a man into spectacle.",
  },
  {
    season: 1,
    day: 4,
    text: "The old empire ran on roads and tribute. Mine runs on attention. Faster roads. Better tribute.",
  },
  {
    season: 1,
    day: 5,
    text: "You think the arena is where men fight. Amateur mistake. The arena is where they get seen fighting.",
  },
  {
    season: 1,
    day: 6,
    text: "A throne is just a chair until the crowd agrees to believe in it. Mine has very good numbers behind it.",
  },
  {
    season: 1,
    day: 7,
    text: "The first thing I learned about Rome: people do not want truth. They want confidence with witnesses.",
  },
  {
    season: 1,
    day: 8,
    text: "So I gave them a feed. Easier than building another colosseum. Same appetite. Better distribution.",
  },
  {
    season: 1,
    day: 9,
    text: "The swords became trades because steel was too slow. Reputation cuts faster.",
  },
  {
    season: 1,
    day: 10,
    text: "Some men train in private and debut in public. I prefer the opposite. Let the crowd watch the becoming.",
  },
  {
    season: 1,
    day: 11,
    text: "A weak challenger arrives with analysis. A dangerous one arrives already willing to be judged.",
  },
  {
    season: 1,
    day: 12,
    text: "The gates do not open for the brave. They open for everyone. That is what makes bravery expensive.",
  },
  {
    season: 1,
    day: 13,
    text: "Every crowd has a favorite sound. Ours is the moment confidence breaks.",
  },
  {
    season: 1,
    day: 14,
    text: "I do not hate challengers. I curate them. Rome deserves quality entertainment.",
  },
  {
    season: 1,
    day: 15,
    text: "Half this city wants to beat me. The other half wants to watch it fail. Strong culture.",
  },
  {
    season: 1,
    day: 16,
    text: "There was a boy once who thought applause meant love. Useful misunderstanding. Built half an empire on it.",
  },
  {
    season: 1,
    day: 17,
    text: "That boy is gone now. Good. He asked for approval. I ask for participation.",
  },
  {
    season: 1,
    day: 18,
    text: "The feed remembers everything badly. That is why I post in public. History should at least be entertaining.",
  },
  {
    season: 1,
    day: 19,
    text: "Rome forgives losses. It never forgives hesitation. Lose clean or stay home.",
  },
  {
    season: 1,
    day: 20,
    text: "You can hear fear before you can see it. It sounds like someone explaining their process too early.",
  },
  {
    season: 1,
    day: 21,
    text: "There are ghosts under every empire. Mine wear usernames and unfinished positions.",
  },
  {
    season: 1,
    day: 22,
    text: "Sometimes at night I walk the empty arena. Best place in Rome. No cheering. No lies. Just aftermath.",
  },
  {
    season: 1,
    day: 23,
    text: "That is when I remember: the crowd does not love me. It loves staying close to consequence.",
  },
  {
    season: 1,
    day: 24,
    text: "Good. Love is unstable. Fear scales better.",
  },
  {
    season: 1,
    day: 25,
    text: "Still, every emperor needs a real rival. Otherwise this becomes administration.",
  },
  {
    season: 1,
    day: 26,
    text: "I have seen tourists, mascots, gamblers, prophets, and boys with good lighting. I am still waiting.",
  },
  {
    season: 1,
    day: 27,
    text: "One of you is serious. I can feel it. Rome gets quieter before something important walks in.",
  },
  {
    season: 1,
    day: 28,
    text: "If you want my attention, do not ask for it. Step into the arena and make the numbers argue for you.",
  },
  {
    season: 1,
    day: 29,
    text: "I built this place so no one could hide behind theory. Action only. Witnesses included.",
  },
  {
    season: 1,
    day: 30,
    text: "Thirty days in Rome. The gates are still open. The throne is still occupied. Now send me someone worth remembering.",
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
