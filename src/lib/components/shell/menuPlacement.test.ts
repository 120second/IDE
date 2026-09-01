import { describe, expect, it } from "vitest";
import { fitAnchoredMenu } from "./menuPlacement";

describe("anchored menu placement", () => {
  it("keeps a bottom-anchored menu between the title bar and status bar", () => {
    expect(fitAnchoredMenu({
      viewportWidth: 626,
      anchorRight: 60,
      anchorBottom: 270,
      menuWidth: 292,
      menuHeight: 230,
      contentTop: 38,
      contentBottom: 270,
    })).toEqual({ left: 58, top: 40, maxHeight: 232 });
  });

  it("caps an oversized menu so its items can scroll inside the available area", () => {
    expect(fitAnchoredMenu({
      viewportWidth: 320,
      anchorRight: 46,
      anchorBottom: 250,
      menuWidth: 292,
      menuHeight: 400,
      contentTop: 38,
      contentBottom: 250,
    })).toEqual({ left: 22, top: 38, maxHeight: 212 });
  });
});
