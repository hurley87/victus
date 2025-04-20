import { createClient } from '@supabase/supabase-js';

type User = {
  id?: string;
  fid: number;
  openai_thread_id: string;
  created_at?: string;
  last_updated?: string;
  message_count?: number;
  memory?: string;
};

type Conversation = {
  id?: string;
  created_at?: string;
  thread_hash: string;
  openai_thread_id: string;
  last_updated?: string;
};

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const supabaseService = {
  async upsertUser(record: {
    fid: number;
    openai_thread_id: string;
    last_updated: string;
  }) {
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
  // Add direct access to supabase client
  from: supabase.from.bind(supabase),
};
