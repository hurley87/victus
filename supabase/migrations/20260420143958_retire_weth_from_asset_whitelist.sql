-- Retire WETH from the tradable universe. Rows stay in `asset_whitelist` for
-- FK integrity (lots / intents may reference historical symbols).
-- Arena UI loads `active = true` and `is_blocklisted = false`; execution
-- requires `is_tradable`.

update public.asset_whitelist
set is_tradable = false, active = false
where symbol = 'WETH';
