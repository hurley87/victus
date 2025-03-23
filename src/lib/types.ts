/**
 * Background task types for Commodus API
 */

export type BackgroundTaskData =
  | {
      type: 'CREATE';
      name: string;
      symbol: string;
      description: string;
      image: string;
      verifiedAddress: string;
      reply: string;
      parent: string;
    }
  | {
      type: 'TRADE';
      tokenAddress: string;
      size: string;
      direction: 'BUY' | 'SELL';
      verifiedAddress: string;
      reply: string;
      parent: string;
    };
