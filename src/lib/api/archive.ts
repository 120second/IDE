import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ArchiveBulkInput,
  ArchiveFacets,
  ArchiveFile,
  ArchiveInput,
  ArchiveQuery,
  SmartCollection,
  SmartCollectionInput,
} from "../types/archive";

export function listArchiveFiles(query: ArchiveQuery): Promise<ArchiveFile[]> {
  return isTauri() ? invoke<ArchiveFile[]>("list_archive_files", { query }) : Promise.resolve([]);
}

export function getArchiveFile(path: string): Promise<ArchiveFile | undefined> {
  return isTauri()
    ? invoke<ArchiveFile | null>("get_archive_file", { path }).then((file) => file ?? undefined)
    : Promise.resolve(undefined);
}

export function saveArchiveFile(input: ArchiveInput): Promise<ArchiveFile> {
  return invoke<ArchiveFile>("archive_file", { input });
}

export function setArchiveFavorite(id: number, favorite: boolean): Promise<void> {
  return invoke<void>("set_archive_favorite", { id, favorite });
}

export function bulkUpdateArchive(input: ArchiveBulkInput): Promise<void> {
  return invoke<void>("bulk_update_archive", { input });
}

export function listArchiveTags(search = ""): Promise<string[]> {
  return isTauri() ? invoke<string[]>("list_archive_tags", { search }) : Promise.resolve([]);
}

export function listArchiveFacets(): Promise<ArchiveFacets> {
  return isTauri()
    ? invoke<ArchiveFacets>("list_archive_facets")
    : Promise.resolve(emptyArchiveFacets());
}

export function listSmartCollections(): Promise<SmartCollection[]> {
  return isTauri() ? invoke<SmartCollection[]>("list_smart_collections") : Promise.resolve([]);
}

export function createSmartCollection(input: SmartCollectionInput): Promise<SmartCollection> {
  return invoke<SmartCollection>("create_smart_collection", { input });
}

export function updateSmartCollection(
  id: number,
  input: SmartCollectionInput,
): Promise<SmartCollection> {
  return invoke<SmartCollection>("update_smart_collection", { id, input });
}

export function deleteSmartCollection(id: number): Promise<void> {
  return invoke<void>("delete_smart_collection", { id });
}

export function emptyArchiveFacets(): ArchiveFacets {
  return {
    inboxCount: 0,
    favoriteCount: 0,
    recentCount: 0,
    completedCount: 0,
    reviewCount: 0,
    platforms: [],
    difficulties: [],
    tags: [],
  };
}
