export type Viewer = {
  id: string;
  nickname: string;
  avatarUrl?: string;
  isVip: boolean;
  vipExpiresAt?: string;
};

export type Program = {
  id: string;
  title: string;
  description?: string;
  coverUrl?: string;
  isVip?: boolean;
  episodeCount?: number;
};

export type Episode = {
  id: string;
  title: string;
  description?: string;
  programId?: string;
  programTitle?: string;
  coverUrl?: string;
  audioUrl?: string;
  duration?: number;
  publishedAt?: string;
  isVip?: boolean;
};

export type DiscoveryPayload = {
  programs: Program[];
  episodes: Episode[];
  source: "member" | "public";
};

export type SessionPayload = {
  authenticated: boolean;
  viewer?: Viewer;
};

export type ApiErrorBody = {
  code?: string;
  message?: string;
  requestId?: string;
};

export type HistoryEntry = Pick<
  Episode,
  "id" | "title" | "programId" | "programTitle" | "coverUrl" | "duration" | "isVip"
> & {
  position: number;
  playedAt: number;
};
