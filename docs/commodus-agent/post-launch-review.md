# Commodus Social Live Posting Review

Live social posting starts only after an explicit operator go-live decision with
`COMMODUS_SOCIAL_DRY_RUN=false`.

## First 48 hours

Keep the launch window conservative for the first 48 hours:

- Do not widen ranking filters, safety filters, or caps during the watch period.
- Keep the production caps at `MAX_AUTHOR_REPLIES_24H = 2` and
  `MAX_THREAD_REPLIES = 3`.
- Treat `commodus_social_blocklist` as an immediate hard stop, even for direct
  mentions.
- Review `commodus_social_runs.posted_cast_hash` against `commodus_casts`
  rows with `source = 'self'` to confirm every live reply has a matching audit
  row.
- Check webhook redeliveries by `commodus_social_runs.idem_key`; repeated
  deliveries must resolve to one posted cast hash.

## Review queries

```sql
select idem_key, trigger_cast_hash, selected_cast_hash, posted_cast_hash, reason, created_at
from commodus_social_runs
where action = 'reply'
order by created_at desc;
```

```sql
select thread_hash, count(*) as self_replies
from commodus_casts
where source = 'self'
  and created_at >= now() - interval '48 hours'
group by thread_hash
order by self_replies desc;
```

```sql
select inbound.author_fid, count(*) as replies_24h
from commodus_social_runs runs
join commodus_casts inbound on inbound.hash = runs.selected_cast_hash
where runs.action = 'reply'
  and runs.posted_cast_hash is not null
  and runs.created_at >= now() - interval '24 hours'
group by inbound.author_fid
order by replies_24h desc;
```

## Widening gate

After the first 48 hours, do not tune caps or filters unless the review shows:

- No author exceeded two live replies in a rolling 24-hour window.
- No thread exceeded three live replies, excluding the originating Commodus cast.
- No blocklisted FID received a reply.
- Webhook redeliveries did not produce duplicate live casts.
- The replies stayed within the voice and safety rules in
  [safety-rules.md](./safety-rules.md) and [voice.md](./voice.md).
