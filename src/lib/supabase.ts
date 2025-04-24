import { createClient } from '@supabase/supabase-js';

// --- Types ---
export type User = {
  id?: string; // Supabase ID, usually UUID
  created_at?: string; // Timestamp
  fid: number;
  openai_thread_id: string;
  last_updated: string; // Timestamp
  message_count: number;
  memory?: string | null;
};

// --- End Types ---

type Conversation = {
  id?: string;
  created_at?: string;
  thread_hash: string;
  openai_thread_id: string;
  last_updated?: string;
};

type Coin = {
  fid: number;
  coinAddress: `0x${string}`;
  name: string;
  symbol: string;
  description: string;
  parentCast: string;
};

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const supabaseService = {
  async upsertUser(
    record: Partial<User> &
      Pick<User, 'fid' | 'openai_thread_id' | 'last_updated'>
  ) {
    // Use standard upsert to set fid and openai_thread_id
    // Note: This will NOT increment message_count
    const { data, error } = await supabase
      .from('users')
      .upsert(record, {
        onConflict: 'fid', // Assuming 'fid' is the unique constraint
      })
      .select(); // Select the updated/inserted row

    if (error) {
      console.error('Supabase upsert error (users):', error);
      throw new Error('Failed to upsert user');
    }
    return data;
  },

  async incrementUserMessageCount(fid: number) {
    // Call the specific RPC function to increment the count atomically
    const { error } = await supabase.rpc('increment_message_count_by_fid', {
      p_fid: fid,
    });

    if (error) {
      console.error(
        'Supabase RPC error (increment_message_count_by_fid):',
        error
      );
      // Decide how to handle this error, maybe just log it
      // or throw new Error('Failed to increment message count');
    }
  },

  async upsertConversation(record: Conversation) {
    const { data, error } = await supabase
      .from('conversations')
      .upsert(record, {
        onConflict: 'id',
      })
      .select();

    if (error) {
      console.error('Supabase error:', error);
      throw new Error('Failed to save conversation');
    }

    return data;
  },
  async getConversationByThreadHash(threadHash: string) {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('thread_hash', threadHash);

    if (error) {
      console.error('Supabase error:', error);
      throw new Error('Failed to get conversation');
    }

    return data;
  },
  async getUserByFid(fid: number) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('fid', fid);

    if (error) {
      console.error('Supabase error:', error);
      throw new Error('Failed to get user');
    }

    return data;
  },

  async updateUserMemory(fid: number, memoryData: Pick<User, 'memory'>) {
    const { data, error } = await supabase
      .from('users')
      .update(memoryData)
      .eq('fid', fid)
      .select(); // Optionally select the updated row

    if (error) {
      console.error(
        `Supabase update error (user memory for FID ${fid}):`,
        error
      );
      // Decide if this error should halt execution
      throw new Error('Failed to update user memory');
    }
    console.log(`Updated memory for user FID ${fid}`);
    return data;
  },

  async storeMemory(fid: number, memory: string) {
    const { data, error } = await supabase
      .from('memories')
      .insert({ fid, memory });

    if (error) {
      console.error('Supabase error:', error);
      throw new Error('Failed to store memory');
    }

    return data;
  },

  async storeCoin(coin: Coin) {
    const { data, error } = await supabase.from('coins').insert(coin);

    if (error) {
      console.error('Supabase error:', error);
      throw new Error('Failed to store coin');
    }

    return data;
  },

  // Add direct access to supabase client
  from: supabase.from.bind(supabase),
};
