import "server-only";

export type InstagramHistoryEntry = {
  date: string;
  followers: number;
  following: number;
  engagementRate: number;
  avgLikes: number;
  avgComments: number;
  reach: number;
  impressions: number;
  posts: number;
  stories: number;
  reels: number;
};

export type InstagramAccountAnalytics = {
  id: string;
  username: string;
  followerCount: number | null;
  followingCount: number | null;
  mediaCount: number | null;
  lastSyncedAt: string | null;
  history: InstagramHistoryEntry[];
};

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

export async function fetchInstagramAnalytics(
  userId: string,
  days = 30
): Promise<InstagramAccountAnalytics[]> {
  if (!userId) {
    return [];
  }

  if (!checkoutApiKey) {
    console.warn("Missing CHECKOUT_API_KEY; cannot load Instagram analytics.");
    return [];
  }

  try {
    const response = await fetch(
      `${apiBaseUrl}/api/v1/instagram/analytics?user_id=${userId}&days=${days}`,
      {
        headers: {
          "X-API-Key": checkoutApiKey
        },
        cache: "no-store"
      }
    );

    if (!response.ok) {
      console.warn("Failed to fetch Instagram analytics", response.status);
      return [];
    }

    const payload = (await response.json()) as Array<{
      id: string;
      username: string;
      follower_count: number | null;
      following_count: number | null;
      media_count: number | null;
      last_sync_at: string | null;
      history: Array<{
        date: string;
        followers: number;
        following: number;
        engagement_rate: number;
        avg_likes: number;
        avg_comments: number;
        reach: number;
        impressions: number;
        posts: number;
        stories: number;
        reels: number;
      }>;
    }>;

    return payload.map((account) => ({
      id: account.id,
      username: account.username,
      followerCount: account.follower_count ?? null,
      followingCount: account.following_count ?? null,
      mediaCount: account.media_count ?? null,
      lastSyncedAt: account.last_sync_at,
      history: account.history.map((entry) => ({
        date: entry.date,
        followers: entry.followers,
        following: entry.following,
        engagementRate: entry.engagement_rate,
        avgLikes: entry.avg_likes,
        avgComments: entry.avg_comments,
        reach: entry.reach,
        impressions: entry.impressions,
        posts: entry.posts,
        stories: entry.stories,
        reels: entry.reels
      }))
    }));
  } catch (error) {
    console.warn("Unexpected error fetching Instagram analytics", error);
    return [];
  }
}
