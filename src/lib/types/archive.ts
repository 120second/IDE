export type ArchiveStatus = "unfinished" | "completed" | "review" | "mastered";

export interface ArchiveFile {
  id: number;
  path: string;
  title: string;
  platform: string;
  status: ArchiveStatus;
  note: string;
  favorite: boolean;
  archived: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastOpened?: string;
  reviewStep?: number;
  nextReviewAt?: string;
  lastReviewedAt?: string;
  reviewCompleted: boolean;
}

export interface ArchiveInput {
  path: string;
  title: string;
  platform: string;
  status: ArchiveStatus;
  note: string;
  favorite: boolean;
  tags: string[];
}

export interface ArchiveQuery {
  search: string;
  inboxOnly: boolean;
  favoriteOnly: boolean;
  recentOnly: boolean;
  reviewOnly: boolean;
  platform?: string;
  status?: ArchiveStatus;
  tag?: string;
  collectionId?: number;
}

export interface ArchiveBulkInput {
  fileIds: number[];
  addTags: string[];
  platform?: string;
  status?: ArchiveStatus;
}

export interface NamedCount {
  name: string;
  count: number;
}

export interface ArchiveFacets {
  inboxCount: number;
  favoriteCount: number;
  recentCount: number;
  completedCount: number;
  reviewCount: number;
  dueReviewCount: number;
  platforms: NamedCount[];
  tags: NamedCount[];
}

export interface SmartCollectionInput {
  name: string;
  platform?: string;
  status?: ArchiveStatus;
  tags: string[];
}

export interface SmartCollection extends SmartCollectionInput {
  id: number;
  count: number;
  createdAt: string;
  updatedAt: string;
}
