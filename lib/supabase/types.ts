export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      arena_wallets: {
        Row: {
          created_at: string
          funded_at: string | null
          funding_wallet_address: string | null
          funding_wallet_tx_hash: string | null
          funding_wallet_verified_at: string | null
          id: string
          privy_wallet_id: string
          status: string
          updated_at: string
          user_id: string
          wallet_address: string
        }
        Insert: {
          created_at?: string
          funded_at?: string | null
          funding_wallet_address?: string | null
          funding_wallet_tx_hash?: string | null
          funding_wallet_verified_at?: string | null
          id?: string
          privy_wallet_id: string
          status?: string
          updated_at?: string
          user_id: string
          wallet_address: string
        }
        Update: {
          created_at?: string
          funded_at?: string | null
          funding_wallet_address?: string | null
          funding_wallet_tx_hash?: string | null
          funding_wallet_verified_at?: string | null
          id?: string
          privy_wallet_id?: string
          status?: string
          updated_at?: string
          user_id?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "arena_wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_whitelist: {
        Row: {
          active: boolean
          address: string
          created_at: string
          decimals: number
          id: string
          is_blocklisted: boolean
          is_tradable: boolean
          name: string
          symbol: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          address: string
          created_at?: string
          decimals: number
          id?: string
          is_blocklisted?: boolean
          is_tradable?: boolean
          name: string
          symbol: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string
          created_at?: string
          decimals?: number
          id?: string
          is_blocklisted?: boolean
          is_tradable?: boolean
          name?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      cast_commands: {
        Row: {
          cast_hash: string
          created_at: string
          error_reason: string | null
          fid: number
          id: string
          parsed_action: string | null
          parsed_amount: number | null
          parsed_percent: number | null
          parsed_symbol: string | null
          status: string
          text: string
          updated_at: string
        }
        Insert: {
          cast_hash: string
          created_at?: string
          error_reason?: string | null
          fid: number
          id?: string
          parsed_action?: string | null
          parsed_amount?: number | null
          parsed_percent?: number | null
          parsed_symbol?: string | null
          status?: string
          text: string
          updated_at?: string
        }
        Update: {
          cast_hash?: string
          created_at?: string
          error_reason?: string | null
          fid?: number
          id?: string
          parsed_action?: string | null
          parsed_amount?: number | null
          parsed_percent?: number | null
          parsed_symbol?: string | null
          status?: string
          text?: string
          updated_at?: string
        }
        Relationships: []
      }
      cast_replies: {
        Row: {
          cast_hash: string
          id: string
          published_at: string
          reply_cast_hash: string | null
          reply_kind: string
        }
        Insert: {
          cast_hash: string
          id?: string
          published_at?: string
          reply_cast_hash?: string | null
          reply_kind: string
        }
        Update: {
          cast_hash?: string
          id?: string
          published_at?: string
          reply_cast_hash?: string | null
          reply_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "cast_replies_cast_hash_fkey"
            columns: ["cast_hash"]
            isOneToOne: false
            referencedRelation: "cast_commands"
            referencedColumns: ["cast_hash"]
          },
        ]
      }
      commodus_autotrader_runs: {
        Row: {
          analysis: Json
          cast_command_id: string | null
          created_at: string
          error: string | null
          id: string
          published_cast_hash: string | null
          slot_key: string
          status: string
          trade_execution_id: string | null
          updated_at: string
        }
        Insert: {
          analysis?: Json
          cast_command_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          published_cast_hash?: string | null
          slot_key: string
          status?: string
          trade_execution_id?: string | null
          updated_at?: string
        }
        Update: {
          analysis?: Json
          cast_command_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          published_cast_hash?: string | null
          slot_key?: string
          status?: string
          trade_execution_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commodus_autotrader_runs_cast_command_id_fkey"
            columns: ["cast_command_id"]
            isOneToOne: false
            referencedRelation: "cast_commands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commodus_autotrader_runs_trade_execution_id_fkey"
            columns: ["trade_execution_id"]
            isOneToOne: false
            referencedRelation: "trade_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      commodus_casts: {
        Row: {
          author_fid: number
          created_at: string
          first_seen_at: string
          hash: string
          id: string
          parent_author_fid: number | null
          parent_hash: string | null
          raw_json: Json
          source: string
          text: string
          thread_hash: string | null
        }
        Insert: {
          author_fid: number
          created_at?: string
          first_seen_at?: string
          hash: string
          id?: string
          parent_author_fid?: number | null
          parent_hash?: string | null
          raw_json?: Json
          source: string
          text: string
          thread_hash?: string | null
        }
        Update: {
          author_fid?: number
          created_at?: string
          first_seen_at?: string
          hash?: string
          id?: string
          parent_author_fid?: number | null
          parent_hash?: string | null
          raw_json?: Json
          source?: string
          text?: string
          thread_hash?: string | null
        }
        Relationships: []
      }
      commodus_long_term_memory: {
        Row: {
          body: string
          id: string
          importance: number
          memory_type: string
          title: string
        }
        Insert: {
          body: string
          id?: string
          importance?: number
          memory_type: string
          title: string
        }
        Update: {
          body?: string
          id?: string
          importance?: number
          memory_type?: string
          title?: string
        }
        Relationships: []
      }
      commodus_lore_posts: {
        Row: {
          cast_hash: string | null
          created_at: string
          day: number
          error: string | null
          id: string
          idempotency_key: string
          posted_at: string | null
          scheduled_at: string | null
          scheduled_for: string | null
          season: number
          status: string
          text: string
          updated_at: string
        }
        Insert: {
          cast_hash?: string | null
          created_at?: string
          day: number
          error?: string | null
          id?: string
          idempotency_key: string
          posted_at?: string | null
          scheduled_at?: string | null
          scheduled_for?: string | null
          season: number
          status?: string
          text: string
          updated_at?: string
        }
        Update: {
          cast_hash?: string | null
          created_at?: string
          day?: number
          error?: string | null
          id?: string
          idempotency_key?: string
          posted_at?: string | null
          scheduled_at?: string | null
          scheduled_for?: string | null
          season?: number
          status?: string
          text?: string
          updated_at?: string
        }
        Relationships: []
      }
      commodus_social_blocklist: {
        Row: {
          fid: number
          reason: string
        }
        Insert: {
          fid: number
          reason: string
        }
        Update: {
          fid?: number
          reason?: string
        }
        Relationships: []
      }
      commodus_social_runs: {
        Row: {
          action: string
          created_at: string
          id: string
          idem_key: string
          model_output: Json
          posted_cast_hash: string | null
          prompt_snapshot: Json
          reason: string | null
          risk_flags: Json
          run_type: string
          score: number | null
          selected_cast_hash: string | null
          trigger_cast_hash: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          idem_key: string
          model_output?: Json
          posted_cast_hash?: string | null
          prompt_snapshot?: Json
          reason?: string | null
          risk_flags?: Json
          run_type: string
          score?: number | null
          selected_cast_hash?: string | null
          trigger_cast_hash?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          idem_key?: string
          model_output?: Json
          posted_cast_hash?: string | null
          prompt_snapshot?: Json
          reason?: string | null
          risk_flags?: Json
          run_type?: string
          score?: number | null
          selected_cast_hash?: string | null
          trigger_cast_hash?: string | null
        }
        Relationships: []
      }
      commodus_thread_memory: {
        Row: {
          is_muted: boolean
          last_cast_hash: string | null
          participants: Json
          summary: string
          thread_hash: string
        }
        Insert: {
          is_muted?: boolean
          last_cast_hash?: string | null
          participants?: Json
          summary?: string
          thread_hash: string
        }
        Update: {
          is_muted?: boolean
          last_cast_hash?: string | null
          participants?: Json
          summary?: string
          thread_hash?: string
        }
        Relationships: []
      }
      commodus_user_memory: {
        Row: {
          fid: number
          last_interaction_at: string | null
          relationship: string
          summary: string
        }
        Insert: {
          fid: number
          last_interaction_at?: string | null
          relationship?: string
          summary?: string
        }
        Update: {
          fid?: number
          last_interaction_at?: string | null
          relationship?: string
          summary?: string
        }
        Relationships: []
      }
      farcaster_accounts: {
        Row: {
          created_at: string
          display_name: string | null
          fid: number
          id: string
          pfp_url: string | null
          updated_at: string
          user_id: string
          username: string | null
          verifications: Json
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          fid: number
          id?: string
          pfp_url?: string | null
          updated_at?: string
          user_id: string
          username?: string | null
          verifications?: Json
        }
        Update: {
          created_at?: string
          display_name?: string | null
          fid?: number
          id?: string
          pfp_url?: string | null
          updated_at?: string
          user_id?: string
          username?: string | null
          verifications?: Json
        }
        Relationships: [
          {
            foreignKeyName: "farcaster_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      leaderboard_snapshots: {
        Row: {
          captured_at: string | null
          created_at: string
          id: string
          month: string
          points: number
          rank: number | null
          realized_pnl_usdc: number
          updated_at: string
          user_id: string
        }
        Insert: {
          captured_at?: string | null
          created_at?: string
          id?: string
          month: string
          points?: number
          rank?: number | null
          realized_pnl_usdc?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          captured_at?: string | null
          created_at?: string
          id?: string
          month?: string
          points?: number
          rank?: number | null
          realized_pnl_usdc?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaderboard_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lot_closures: {
        Row: {
          avg_cost_usdc_at_close: number
          closed_at: string
          closing_execution_id: string
          id: string
          lot_id: string
          quantity_closed: number
          realized_pnl_usdc: number
          realized_return_pct: number
        }
        Insert: {
          avg_cost_usdc_at_close: number
          closed_at?: string
          closing_execution_id: string
          id?: string
          lot_id: string
          quantity_closed: number
          realized_pnl_usdc: number
          realized_return_pct: number
        }
        Update: {
          avg_cost_usdc_at_close?: number
          closed_at?: string
          closing_execution_id?: string
          id?: string
          lot_id?: string
          quantity_closed?: number
          realized_pnl_usdc?: number
          realized_return_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "lot_closures_closing_execution_id_fkey"
            columns: ["closing_execution_id"]
            isOneToOne: false
            referencedRelation: "trade_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lot_closures_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
        ]
      }
      lots: {
        Row: {
          asset_symbol: string
          avg_cost_usdc: number
          closed_at: string | null
          id: string
          initial_quantity: number
          opened_at: string
          opening_execution_id: string
          remaining_quantity: number
          updated_at: string
          wallet_id: string
        }
        Insert: {
          asset_symbol: string
          avg_cost_usdc: number
          closed_at?: string | null
          id?: string
          initial_quantity: number
          opened_at?: string
          opening_execution_id: string
          remaining_quantity: number
          updated_at?: string
          wallet_id: string
        }
        Update: {
          asset_symbol?: string
          avg_cost_usdc?: number
          closed_at?: string | null
          id?: string
          initial_quantity?: number
          opened_at?: string
          opening_execution_id?: string
          remaining_quantity?: number
          updated_at?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lots_asset_symbol_fkey"
            columns: ["asset_symbol"]
            isOneToOne: false
            referencedRelation: "asset_whitelist"
            referencedColumns: ["symbol"]
          },
          {
            foreignKeyName: "lots_opening_execution_id_fkey"
            columns: ["opening_execution_id"]
            isOneToOne: true
            referencedRelation: "trade_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lots_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "arena_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          asset_symbol: string
          avg_cost_usdc: number
          id: string
          quantity: number
          updated_at: string
          wallet_id: string
        }
        Insert: {
          asset_symbol: string
          avg_cost_usdc?: number
          id?: string
          quantity?: number
          updated_at?: string
          wallet_id: string
        }
        Update: {
          asset_symbol?: string
          avg_cost_usdc?: number
          id?: string
          quantity?: number
          updated_at?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_asset_symbol_fkey"
            columns: ["asset_symbol"]
            isOneToOne: false
            referencedRelation: "asset_whitelist"
            referencedColumns: ["symbol"]
          },
          {
            foreignKeyName: "positions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "arena_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          award_month: string | null
          award_points: number
          awarded_at: string | null
          first_funded_at: string | null
          id: string
          referred_at: string
          referred_fid: number
          referred_user_id: string
          referrer_fid: number
          referrer_user_id: string
        }
        Insert: {
          award_month?: string | null
          award_points?: number
          awarded_at?: string | null
          first_funded_at?: string | null
          id?: string
          referred_at?: string
          referred_fid: number
          referred_user_id: string
          referrer_fid: number
          referrer_user_id: string
        }
        Update: {
          award_month?: string | null
          award_points?: number
          awarded_at?: string | null
          first_funded_at?: string | null
          id?: string
          referred_at?: string
          referred_fid?: number
          referred_user_id?: string
          referrer_fid?: number
          referrer_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_user_id_fkey"
            columns: ["referrer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_epochs: {
        Row: {
          airdrop_tx_hashes: Json
          created_at: string
          distributed_at: string | null
          id: string
          month: string
          pool_glory_amount: number | null
          snapshot_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          airdrop_tx_hashes?: Json
          created_at?: string
          distributed_at?: string | null
          id?: string
          month: string
          pool_glory_amount?: number | null
          snapshot_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          airdrop_tx_hashes?: Json
          created_at?: string
          distributed_at?: string | null
          id?: string
          month?: string
          pool_glory_amount?: number | null
          snapshot_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      scoring_events: {
        Row: {
          cast_command_id: string
          counted_in_daily_slot: boolean
          created_at: string
          event_type: string
          execution_id: string | null
          id: string
          month: string
          points: number
          user_id: string
        }
        Insert: {
          cast_command_id: string
          counted_in_daily_slot?: boolean
          created_at?: string
          event_type: string
          execution_id?: string | null
          id?: string
          month: string
          points: number
          user_id: string
        }
        Update: {
          cast_command_id?: string
          counted_in_daily_slot?: boolean
          created_at?: string
          event_type?: string
          execution_id?: string | null
          id?: string
          month?: string
          points?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scoring_events_cast_command_id_fkey"
            columns: ["cast_command_id"]
            isOneToOne: false
            referencedRelation: "cast_commands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_events_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "trade_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scoring_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      season_entries: {
        Row: {
          cash_remaining_usdc: number
          created_at: string
          has_qualifying_trade: boolean
          id: string
          max_trades: number
          season_id: string
          settled_portfolio_value_usdc: number | null
          settled_return_pct: number | null
          starting_balance_usdc: number
          status: string
          trades_used: number
          updated_at: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          cash_remaining_usdc?: number
          created_at?: string
          has_qualifying_trade?: boolean
          id?: string
          max_trades?: number
          season_id: string
          settled_portfolio_value_usdc?: number | null
          settled_return_pct?: number | null
          starting_balance_usdc?: number
          status?: string
          trades_used?: number
          updated_at?: string
          user_id: string
          wallet_id: string
        }
        Update: {
          cash_remaining_usdc?: number
          created_at?: string
          has_qualifying_trade?: boolean
          id?: string
          max_trades?: number
          season_id?: string
          settled_portfolio_value_usdc?: number | null
          settled_return_pct?: number | null
          starting_balance_usdc?: number
          status?: string
          trades_used?: number
          updated_at?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_entries_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_entries_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "arena_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      season_positions: {
        Row: {
          average_entry_price: number
          id: string
          season_entry_id: string
          season_id: string
          token_address: string
          token_amount: number
          token_symbol: string
          updated_at: string
          user_id: string
        }
        Insert: {
          average_entry_price?: number
          id?: string
          season_entry_id: string
          season_id: string
          token_address: string
          token_amount?: number
          token_symbol: string
          updated_at?: string
          user_id: string
        }
        Update: {
          average_entry_price?: number
          id?: string
          season_entry_id?: string
          season_id?: string
          token_address?: string
          token_amount?: number
          token_symbol?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_positions_season_entry_id_fkey"
            columns: ["season_entry_id"]
            isOneToOne: false
            referencedRelation: "season_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_positions_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_positions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      season_trades: {
        Row: {
          action: string
          created_at: string
          execution_price: number
          fees_usdc: number
          id: string
          notional_usdc: number
          season_entry_id: string
          season_id: string
          status: string
          token_address: string
          token_amount: number
          token_symbol: string
          trade_execution_id: string
          tx_hash: string | null
          user_id: string
          wallet_id: string
        }
        Insert: {
          action: string
          created_at?: string
          execution_price: number
          fees_usdc?: number
          id?: string
          notional_usdc: number
          season_entry_id: string
          season_id: string
          status?: string
          token_address: string
          token_amount: number
          token_symbol: string
          trade_execution_id: string
          tx_hash?: string | null
          user_id: string
          wallet_id: string
        }
        Update: {
          action?: string
          created_at?: string
          execution_price?: number
          fees_usdc?: number
          id?: string
          notional_usdc?: number
          season_entry_id?: string
          season_id?: string
          status?: string
          token_address?: string
          token_amount?: number
          token_symbol?: string
          trade_execution_id?: string
          tx_hash?: string | null
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_trades_season_entry_id_fkey"
            columns: ["season_entry_id"]
            isOneToOne: false
            referencedRelation: "season_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_trades_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_trades_trade_execution_id_fkey"
            columns: ["trade_execution_id"]
            isOneToOne: true
            referencedRelation: "trade_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_trades_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_trades_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "arena_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      season_tokens: {
        Row: {
          chain_id: number
          closing_price_usdc: number | null
          created_at: string
          decimals: number
          id: string
          is_active: boolean
          season_id: string
          token_address: string
          token_symbol: string
        }
        Insert: {
          chain_id?: number
          closing_price_usdc?: number | null
          created_at?: string
          decimals: number
          id?: string
          is_active?: boolean
          season_id: string
          token_address: string
          token_symbol: string
        }
        Update: {
          chain_id?: number
          closing_price_usdc?: number | null
          created_at?: string
          decimals?: number
          id?: string
          is_active?: boolean
          season_id?: string
          token_address?: string
          token_symbol?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_tokens_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          max_trades: number
          min_trade_size_usdc: number
          name: string
          settled_at: string | null
          starting_balance_usdc: number
          starts_at: string
          status: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          max_trades?: number
          min_trade_size_usdc?: number
          name: string
          settled_at?: string | null
          starting_balance_usdc?: number
          starts_at: string
          status?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          max_trades?: number
          min_trade_size_usdc?: number
          name?: string
          settled_at?: string | null
          starting_balance_usdc?: number
          starts_at?: string
          status?: string
        }
        Relationships: []
      }
      trade_executions: {
        Row: {
          confirmed_at: string | null
          created_at: string
          execution_id: string
          execution_price_usdc: number | null
          failure_reason: string | null
          fee_tx_hash: string | null
          id: string
          notional_usdc: number | null
          privy_transaction_id: string | null
          quantity: number | null
          realized_pnl_usdc: number | null
          realized_return_pct: number | null
          sponsored_gas_usdc: number | null
          status: string
          swap_fee_usdc: number | null
          trade_intent_id: string
          tx_hash: string | null
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          execution_id: string
          execution_price_usdc?: number | null
          failure_reason?: string | null
          fee_tx_hash?: string | null
          id?: string
          notional_usdc?: number | null
          privy_transaction_id?: string | null
          quantity?: number | null
          realized_pnl_usdc?: number | null
          realized_return_pct?: number | null
          sponsored_gas_usdc?: number | null
          status?: string
          swap_fee_usdc?: number | null
          trade_intent_id: string
          tx_hash?: string | null
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          execution_id?: string
          execution_price_usdc?: number | null
          failure_reason?: string | null
          fee_tx_hash?: string | null
          id?: string
          notional_usdc?: number | null
          privy_transaction_id?: string | null
          quantity?: number | null
          realized_pnl_usdc?: number | null
          realized_return_pct?: number | null
          sponsored_gas_usdc?: number | null
          status?: string
          swap_fee_usdc?: number | null
          trade_intent_id?: string
          tx_hash?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_executions_trade_intent_id_fkey"
            columns: ["trade_intent_id"]
            isOneToOne: true
            referencedRelation: "trade_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_intents: {
        Row: {
          action: string
          amount_type: string
          amount_value: number
          asset_symbol: string
          cast_command_id: string
          created_at: string
          id: string
          status: string
          updated_at: string
          wallet_id: string
        }
        Insert: {
          action: string
          amount_type: string
          amount_value: number
          asset_symbol: string
          cast_command_id: string
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          wallet_id: string
        }
        Update: {
          action?: string
          amount_type?: string
          amount_value?: number
          asset_symbol?: string
          cast_command_id?: string
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_intents_asset_symbol_fkey"
            columns: ["asset_symbol"]
            isOneToOne: false
            referencedRelation: "asset_whitelist"
            referencedColumns: ["symbol"]
          },
          {
            foreignKeyName: "trade_intents_cast_command_id_fkey"
            columns: ["cast_command_id"]
            isOneToOne: true
            referencedRelation: "cast_commands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_intents_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "arena_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_stats: {
        Row: {
          months_active: number
          total_points: number
          total_realized_pnl_usdc: number
          updated_at: string
          user_id: string
        }
        Insert: {
          months_active?: number
          total_points?: number
          total_realized_pnl_usdc?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          months_active?: number
          total_points?: number
          total_realized_pnl_usdc?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      wallet_policies: {
        Row: {
          active: boolean
          created_at: string
          id: string
          max_price_impact_bps: number
          max_slippage_bps: number
          max_trade_usdc: number
          max_trades_per_day: number
          min_funding_deposit_usdc: number
          swap_fee_bps: number
          swap_fee_min_usdc: number
          updated_at: string
          wallet_cap_usdc: number
          wallet_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          max_price_impact_bps?: number
          max_slippage_bps?: number
          max_trade_usdc?: number
          max_trades_per_day?: number
          min_funding_deposit_usdc?: number
          swap_fee_bps?: number
          swap_fee_min_usdc?: number
          updated_at?: string
          wallet_cap_usdc?: number
          wallet_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          max_price_impact_bps?: number
          max_slippage_bps?: number
          max_trade_usdc?: number
          max_trades_per_day?: number
          min_funding_deposit_usdc?: number
          swap_fee_bps?: number
          swap_fee_min_usdc?: number
          updated_at?: string
          wallet_cap_usdc?: number
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_policies_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: true
            referencedRelation: "arena_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
