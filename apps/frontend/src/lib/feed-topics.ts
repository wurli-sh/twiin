/** Demo / docs topics — scanned on-chain per agent (F6). */
export const DEMO_FEED_TOPICS = [
  'somnia.ecosystem.health',
  'somnia.sentiment.daily',
  'health',
] as const

export type DemoFeedTopic = (typeof DEMO_FEED_TOPICS)[number]
