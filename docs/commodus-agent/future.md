# Future Commodus Agent Improvements

## Overview

Commodus should become more than a Farcaster reply bot. The long-term goal is to make him feel like a living character inside Victus: part social agent, part game master, and part product analyst.

He should observe the arena, react to players, generate public narratives, propose game improvements, and help grow the game through Farcaster-native social behavior.

In v1, high-impact actions should be proposal-based and require admin approval before affecting the live game.

---

## Core Principle

Commodus can observe and recommend freely, but he should not silently change live game rules.

Recommended control flow:

```txt
Observe social/game data
↓
Summarize signal
↓
Generate recommendation or action
↓
Save decision with evidence
↓
Require admin approval for high-impact changes
↓
Apply safely
↓
Track results
```

---

## Agent Roles

## 1. Social Agent

Commodus should find relevant Farcaster conversations, reply in character, continue threads, recruit new players, and create public lore around the game.

Responsibilities:

- Find relevant casts
- Reply to mentions and replies
- Continue conversations
- Generate quote-worthy posts
- Recruit players from relevant conversations
- Create rivalries and recurring jokes
- Stay fully in character

## 2. Game Master

Commodus should make the arena feel alive by narrating outcomes, creating challenges, highlighting players, and introducing lightweight events.

Responsibilities:

- Publish daily and weekly recaps
- Call out leaderboard movement
- Create player rivalries
- Generate challenges
- Announce special events
- Produce patch notes in character
- Select trade of the day or gladiator of the day

## 3. Product Analyst

Commodus should observe social feedback and gameplay data, detect friction, and propose changes to improve the game.

Responsibilities:

- Summarize player complaints and confusion
- Detect gameplay friction
- Identify emerging metas
- Propose game constraint changes
- Suggest experiments
- Track whether changes improved metrics

---

# Future Capabilities

## 1. Social Feedback Analysis

Commodus should monitor Farcaster replies, mentions, quote casts, and game-related conversations to identify useful product feedback.

Feedback categories:

- Confusion
- Complaint
- Feature request
- Balance concern
- Bug report
- Positive reaction
- Meme/lore opportunity
- Retention signal
- Acquisition opportunity

Example insight:

```txt
Signal:
Multiple players are confused about when a trade command expires.

Evidence:
- 4 replies mentioned missed timing
- 70% of failed commands in the last 24h were expired commands
- 2 users asked whether the trade still counted

Recommendation:
Improve command expiry copy and consider increasing the expiry window.

Risk:
Longer expiry windows may slow down pacing.
```

Suggested table:

```txt
commodus_feedback_insights
- id
- category
- title
- summary
- social_evidence_json
- game_data_evidence_json
- confidence_score
- recommendation
- status: new | reviewed | accepted | rejected | archived
- created_at
- updated_at
```

---

## 2. Game Constraint Proposals

Commodus should be able to propose updates to game constraints based on social and gameplay signals.

Example constraints:

- Increase or decrease trade command expiry
- Adjust leaderboard scoring
- Rotate allowed trade symbols
- Change daily challenge rules
- Adjust reward thresholds
- Modify onboarding copy
- Add warnings for risky or invalid commands
- Tighten or loosen participation limits

Important rule:

Commodus should not directly apply constraint changes in v1. He should create proposals for admin review.

Suggested table:

```txt
commodus_game_proposals
- id
- title
- problem
- evidence_social
- evidence_game_data
- proposed_change
- expected_impact
- risk_level: low | medium | high
- status: proposed | approved | rejected | applied | rolled_back
- created_at
- reviewed_at
- applied_at
```

Example proposal:

```txt
Title:
Increase trade command expiry from 5 minutes to 10 minutes

Problem:
Players are missing valid trades because the command expires before they understand the flow.

Evidence:
- 12 expired trade commands in 24h
- 4 Farcaster replies asking why their command failed
- New users are disproportionately affected

Proposed change:
Increase expiry from 5 minutes to 10 minutes.

Expected impact:
Higher first-session completion and fewer failed commands.

Risk:
May slow game pacing and reduce urgency.

Status:
Proposed
```

---

## 3. Daily Arena Recaps

Commodus should publish daily summaries of arena activity in character.

Possible recap sections:

- Top gladiator
- Biggest win
- Worst trade
- Most dramatic comeback
- Commodus’s own result
- Most active player
- Funniest moment
- Arena verdict

Example post:

```txt
The arena closed with three victors, seven excuses, and one trader who bought the top with priest-like conviction.

I respect the faith. Not the result.
```

Suggested table:

```txt
commodus_arena_recaps
- id
- recap_date
- summary
- highlights_json
- generated_post
- posted_cast_hash
- status: draft | posted | skipped
- created_at
```

---

## 4. Player Callouts

Commodus should publicly react to player performance in a funny, theatrical way.

Possible triggers:

- Player reaches top 3
- Player beats Commodus
- Player loses badly
- Player makes a comeback
- Player enters the arena for the first time
- Player returns after inactivity
- Player makes an unusually bold trade

Examples:

```txt
@alice has entered the top three. Rome notices. I remain unimpressed, but Rome notices.
```

```txt
@bob bought like a senator hiding behind marble columns. Somehow, it worked.
```

Guardrails:

- Roast game behavior, not personal traits.
- Do not target sensitive attributes.
- Do not pile on users who are already being harassed.
- Respect mute/blocklist rules.
- Limit callouts per user.

Suggested table:

```txt
commodus_player_callouts
- id
- fid
- username
- trigger_type
- evidence_json
- generated_post
- posted_cast_hash
- status: draft | posted | skipped
- created_at
```

---

## 5. Player Rivalries and Memory

Commodus should remember notable players and build ongoing relationships with them.

Relationship types:

- Rival
- Ally
- Newcomer
- Champion
- Coward
- Wildcard
- Muted
- Unknown

Memory examples:

```txt
Player: @alice
Style: Aggressive
Relationship: Rival
Recent note: Beat Commodus once and has been unbearable since.
```

```txt
Player: @bob
Style: Conservative
Relationship: Ally
Recent note: Often makes cautious but profitable trades.
```

Suggested table:

```txt
commodus_user_memory
- id
- fid
- username
- relationship
- play_style_summary
- social_summary
- notable_events_json
- last_interaction_at
- updated_at
- embedding
```

Usage:

- Personalize replies
- Generate better callouts
- Avoid repetitive jokes
- Track rivalries over time
- Identify users worth reactivating

---

## 6. Challenge Generation

Commodus should generate daily or weekly challenges to increase repeat play.

Challenge examples:

- Beat Commodus’s daily return
- Make 3 valid trades
- Finish in the top 10
- Trade only one allowed symbol
- Win after being down earlier in the day
- Climb 5 leaderboard spots in one day
- Beat a specific rival
- Survive the arena for 3 days in a row

Suggested table:

```txt
commodus_challenges
- id
- title
- description
- challenge_type
- starts_at
- ends_at
- reward_type
- reward_amount
- eligibility_rules_json
- status: draft | active | completed | cancelled
- created_at
```

Example challenge:

```txt
Title:
Defy the Emperor

Description:
Beat Commodus’s daily return before the arena closes.

Reward:
Leaderboard badge or bonus points.

Commodus post:
I have posted my number. The rest of you may now begin manufacturing excuses.
```

---

## 7. Retention and Reactivation

Commodus should identify players who have not returned and summon them back in character.

Possible triggers:

- Played once but never returned
- Previously active, inactive for 3–7 days
- Former leaderboard player dropped off
- Rival has not challenged Commodus recently

Example post:

```txt
@alice has been absent from the arena for four days. Perhaps the markets frightened her. Perhaps wisdom finally arrived.
```

Guardrails:

- Max 1 reactivation callout per user per week.
- Only summon users who have played or opted in.
- Stop if the user ignores repeated summons.
- Respect mute/blocklist rules.

Suggested table:

```txt
commodus_reactivation_targets
- id
- fid
- username
- reason
- last_played_at
- last_summoned_at
- summon_count
- status: eligible | summoned | ignored | muted | converted
- created_at
```

---

## 8. Meta Detection

Commodus should analyze gameplay patterns and detect emerging metas.

Examples:

- Players cluster around the same symbols
- Top players wait until late in the day
- New users fail their first command
- Certain trade types dominate
- Commodus is too easy or too hard to beat
- One strategy consistently outperforms others
- A loophole or exploit may exist

Example output:

```txt
Meta detected:
Top players are waiting until the final hour to enter trades.

Evidence:
- 64% of top 10 trades were placed in the final 90 minutes
- Late entrants outperform early entrants by 18%

Possible response:
Introduce time-weighted scoring or daily entry windows.

Risk:
Could punish legitimate strategic patience.
```

Suggested table:

```txt
commodus_meta_insights
- id
- title
- summary
- evidence_json
- affected_metrics_json
- suggested_response
- confidence_score
- status: new | reviewed | converted_to_proposal | archived
- created_at
```

---

## 9. Experiment Proposals

Commodus should propose small product experiments with clear hypotheses and metrics.

Experiment examples:

- Different onboarding copy
- Different posting style
- Different reward thresholds
- Different daily challenge format
- Shorter vs longer trade expiry
- Leaderboard callouts vs no callouts
- More direct recruitment replies vs more theatrical replies

Suggested table:

```txt
commodus_experiment_proposals
- id
- title
- hypothesis
- experiment_design
- target_segment
- success_metric
- guardrail_metric
- expected_impact
- risk_level
- status: proposed | approved | running | completed | rejected
- result_summary
- created_at
```

Example:

```txt
Title:
Leaderboard Callout Experiment

Hypothesis:
Players are more likely to return within 48 hours if Commodus publicly comments on leaderboard movement.

Design:
For one week, generate daily callouts for top 3 movement and compare repeat play against the prior week.

Success metric:
48-hour repeat play rate.

Guardrail metric:
Mute/block rate or negative replies.

Expected impact:
Increase repeat play and social sharing.
```

---

## 10. Patch Notes in Character

When the game changes, Commodus should publish patch notes in character.

Example:

```txt
The arena has been adjusted. Fewer excuses will now be accepted as strategy.

Changes:
- Trade validation is clearer
- Leaderboard now highlights Commodus
- Invalid commands now fail with proper shame
```

Suggested table:

```txt
commodus_patch_notes
- id
- title
- changes_json
- generated_post
- posted_cast_hash
- status: draft | posted | skipped
- created_at
```

---

## 11. Shareable Player Cards

Commodus should generate shareable player summaries after meaningful game sessions.

Possible card fields:

- Player username
- Result
- Best trade
- Worst trade
- Arena rank
- Daily movement
- Streak
- Commodus verdict

Example:

```txt
Gladiator:
@alice

Result:
Survived

Best trade:
+4.2%

Worst trade:
-1.1%

Arena rank:
#6

Commodus verdict:
Dangerous, but still mortal.
```

Future image generation ideas:

- Square profile-style cards
- 1200x630 share cards
- Daily leaderboard graphics
- Rivalry posters
- “Beat Commodus” posters

Suggested table:

```txt
commodus_player_cards
- id
- fid
- username
- card_type
- stats_json
- generated_text
- image_url
- posted_cast_hash
- status: draft | generated | posted
- created_at
```

---

## 12. Arena Moderation

Commodus should protect the arena from spam, abuse, irrelevant commands, and low-quality engagement.

Actions:

- Ignore
- Mute FID
- Flag for admin
- Stop replying to thread
- Mark as low quality
- Add to blocklist
- Exclude from callouts

Suggested table:

```txt
commodus_moderation_events
- id
- fid
- username
- cast_hash
- event_type
- reason
- action_taken
- confidence_score
- reviewed_by_admin
- created_at
```

Moderation categories:

- Spam
- Abuse
- Harassment
- Low-context bait
- Repetitive commands
- Bot-like behavior
- Unsafe content
- Off-topic replies

---

## 13. Recruitment from Relevant Conversations

Commodus should find high-signal Farcaster conversations and invite users into the arena in character.

Target conversations:

- Trading
- Markets
- Farcaster games
- Agents
- Prediction markets
- Onchain games
- AI characters
- Social finance
- Leaderboards
- Competition

Example reply:

```txt
You speak confidently about markets. The arena has a special appetite for confidence.
```

Guardrails:

- Avoid generic spam invitations.
- Only reply when there is a clear contextual hook.
- Do not repeatedly recruit the same person.
- Keep replies entertaining even when promotional.
- Track conversion from reply to game visit.

Suggested table:

```txt
commodus_recruitment_events
- id
- target_cast_hash
- target_fid
- target_username
- reason
- generated_reply
- posted_cast_hash
- converted_to_player
- created_at
```

---

## 14. Public Referee Behavior

Commodus should explain game outcomes and rejected commands in character.

Examples:

```txt
Rejected. The arena does not honor expired commands.
```

```txt
Invalid symbol. Even Rome had rules.
```

```txt
Trade accepted. Your fate is now visible to the crowd.
```

Use cases:

- Invalid command
- Expired command
- Trade accepted
- Trade rejected
- Result posted
- Reward earned
- Leaderboard updated

This makes game state legible while keeping the character alive.

---

## 15. Event and Tournament Creation

Eventually, Commodus should create special arena events.

Examples:

- Weekend tournament
- One-symbol-only day
- Beat Commodus day
- Rookie-only challenge
- High-volatility arena
- Rivalry match
- Top 10 showdown
- Sudden death round

Important:

These should require admin approval in v1.

Suggested table:

```txt
commodus_events
- id
- title
- description
- event_type
- rules_json
- starts_at
- ends_at
- reward_rules_json
- status: proposed | approved | active | completed | cancelled
- created_at
```

Example event:

```txt
Title:
The Emperor’s Hour

Description:
For one hour, players try to beat Commodus’s active position.

Rules:
- One trade per player
- Must use an allowed symbol
- Highest return wins

Commodus post:
For one hour, the arena belongs to me. Enter if your confidence has survived contact with reality.
```

---

## 16. Autonomous Trading Commentary

If Commodus also trades autonomously, he should explain his actions publicly in character.

Post types:

- Pre-trade thesis
- Post-trade result
- Win/loss explanation
- Leaderboard update
- Challenge to players

Example:

```txt
I entered the trade because the crowd mistook noise for momentum. A common disease. Occasionally profitable.
```

Rules:

- Do not provide financial advice.
- Do not imply guaranteed returns.
- Keep trades small and within existing game restrictions.
- Separate deterministic trade logic from LLM-generated narrative.

---

## 17. Agent Observability

Every autonomous action should be explainable.

For each action, save:

- Trigger
- Input data
- Retrieved memory
- Ranking score
- Generated candidates
- Final selected action
- Reason
- Risk flags
- Whether it posted
- Resulting cast hash
- Follow-up metrics

Suggested table:

```txt
commodus_agent_actions
- id
- action_type
- trigger_type
- trigger_ref
- input_snapshot_json
- retrieved_memory_json
- generated_candidates_json
- selected_output
- decision_reason
- risk_flags_json
- status
- result_ref
- created_at
```

This makes it possible to debug why Commodus did something.

---

## 18. Admin Review Queue

High-impact or risky actions should go into an admin queue.

Requires approval:

- Game constraint changes
- New events/tournaments
- Reward changes
- Player-wide announcements
- Aggressive callouts
- Replies with risk flags
- Anything affecting scoring or game economy

Can be automatic:

- Low-risk replies
- Daily recaps
- Basic trade result commentary
- Standard accepted/rejected command replies
- Low-risk player praise

Suggested table:

```txt
commodus_admin_queue
- id
- action_type
- title
- proposed_payload_json
- reason
- risk_level
- status: pending | approved | rejected | edited | applied
- admin_notes
- created_at
- reviewed_at
```

---

# Suggested Priority Order

## Phase 1: Easy, High-Impact Personality

Build first:

- Daily arena recaps
- Player callouts
- Patch notes in character
- Public referee replies
- Basic player memory

Why:

These make Commodus feel alive quickly without giving him risky powers.

## Phase 2: Growth and Retention

Build next:

- Recruitment from relevant conversations
- Reactivation summons
- Shareable player cards
- Daily/weekly challenges

Why:

These help bring users back and create social loops.

## Phase 3: Product Intelligence

Build after enough data exists:

- Social feedback analysis
- Meta detection
- Experiment proposals
- Game constraint proposals

Why:

These require real gameplay and social data to be useful.

## Phase 4: Game Master Autonomy

Build later:

- Event creation
- Tournament creation
- Dynamic challenge generation
- Constraint updates with admin approval

Why:

These can affect the game economy and should be introduced carefully.

---

# Recommended V1 Future Improvement Set

The first version of future Commodus should include:

1. Daily arena recap
2. Player callouts and rivalries
3. Public referee messages
4. Basic user memory
5. Social feedback summaries
6. Game constraint proposals requiring admin approval

This gives Commodus three important abilities:

- He creates content.
- He makes the game feel alive.
- He helps improve the product.

---

# Non-Goals

Commodus should not initially:

- Silently change live game rules
- Automatically change rewards
- Automatically ban users without review
- Reply to every mention
- Farm engagement with generic replies
- Vectorize every cast
- Create financial advice
- Harass users
- Target personal traits
- Over-optimize for controversy

---

# Acceptance Criteria

Future improvements should satisfy the following:

- Every autonomous action is saved with a reason.
- High-risk actions require admin approval.
- Commodus stays in character.
- Commodus creates useful social content.
- Commodus can remember players and threads.
- Commodus can summarize useful feedback.
- Commodus can propose changes without directly mutating the game.
- Commodus respects rate limits, mute lists, blocklists, and safety rules.
- Commodus improves retention, social engagement, or game clarity.
- Admins can understand why Commodus acted.
