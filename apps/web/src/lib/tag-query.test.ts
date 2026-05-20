import { describe, expect, it } from "vitest";

import {
  buildTagFilterQueryString,
  normalizeTagApiQuery,
  parseTagFilterQuery,
  serializeTagFilterQuery,
  toTagFilterSearchParams,
} from "./tag-query";

const tagId = "01VRZ3NDEKTSV4RRFFQ69G5FAV";
const secondTagId = "01VRZ3NDEKTSV4RRFFQ69G5FBV";

describe("tag query helpers", () => {
  it("parses URL query values into UI filter state", () => {
    expect(
      parseTagFilterQuery(
        new URLSearchParams(`tagIds=${tagId},${secondTagId}&tagMatch=ALL`),
      ),
    ).toEqual({
      tagIds: [tagId, secondTagId],
      tagMatch: "ALL",
    });
  });

  it("serializes selected tags to the shared tag filter query contract", () => {
    expect(
      serializeTagFilterQuery({
        tagIds: [tagId, tagId, secondTagId],
        tagMatch: "ANY",
      }),
    ).toEqual({
      tagIds: `${tagId},${secondTagId}`,
      tagMatch: "ANY",
    });
    expect(
      buildTagFilterQueryString({
        tagIds: [tagId, secondTagId],
        tagMatch: "ANY",
      }),
    ).toBe(`tagIds=${tagId},${secondTagId}&tagMatch=ANY`);
  });

  it("omits inactive tag filters from URLSearchParams", () => {
    expect(toTagFilterSearchParams({ tagIds: [] }).toString()).toBe("");
    expect(parseTagFilterQuery({ tagIds: "not-a-ulid", tagMatch: "ALL" }))
      .toEqual({
        tagIds: [],
        tagMatch: "ALL",
      });
  });

  it("omits tagMatch from API queries unless tagIds are active", () => {
    expect(
      normalizeTagApiQuery({
        page: 1,
        pageSize: 20,
        tagMatch: "ANY",
      }),
    ).toEqual({
      page: 1,
      pageSize: 20,
    });
    expect(
      normalizeTagApiQuery({
        page: 1,
        pageSize: 20,
        tagIds: `${tagId},${secondTagId}`,
        tagMatch: "ANY",
      }),
    ).toEqual({
      page: 1,
      pageSize: 20,
      tagIds: `${tagId},${secondTagId}`,
      tagMatch: "ANY",
    });
  });
});
