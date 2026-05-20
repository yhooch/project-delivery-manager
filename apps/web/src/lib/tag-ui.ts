import type { TagDto } from "@project-delivery/shared";

export type TaggableItem = {
  tags?: readonly TagDto[];
};

export function collectTagsFromItems<TItem extends TaggableItem>(
  items: readonly TItem[],
): TagDto[] {
  const byId = new Map<string, TagDto>();

  for (const item of items) {
    for (const tag of item.tags ?? []) {
      byId.set(tag.id, tag);
    }
  }

  return Array.from(byId.values());
}

export function selectTagsByIds(
  tagIds: readonly string[],
  ...sources: readonly (readonly TagDto[] | undefined)[]
): TagDto[] {
  const byId = new Map<string, TagDto>();

  for (const tags of sources) {
    for (const tag of tags ?? []) {
      byId.set(tag.id, tag);
    }
  }

  return tagIds.flatMap((tagId) => {
    const tag = byId.get(tagId);
    return tag ? [tag] : [];
  });
}

export function getTagIds(tags: readonly Pick<TagDto, "id">[]): string[] {
  return tags.map((tag) => tag.id);
}

export function areTagIdsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((tagId, index) => tagId === right[index])
  );
}
