import { describe, expect, it } from "vitest";
import {
  buildCreateDocument,
  buildAddText,
  buildTransformLayer,
  buildExportImage,
  buildMakeSelection,
  escapeString
} from "./script-builder.js";

describe("Photopea script builders", () => {
  it("builds a new document script with requested dimensions", () => {
    const script = buildCreateDocument({ width: 1080, height: 1080, resolution: 300, name: "Test Art" });
    expect(script).toContain("1080");
    expect(script).toContain("Test Art");
  });

  it("escapes text before embedding it in Photopea JavaScript", () => {
    expect(escapeString("one's\\nline")).toBe("one\\'s\\\\nline");
    const script = buildAddText({ content: "Hello", x: 12, y: 24 });
    expect(script).toContain("Hello");
  });

  it("builds layer transform operations", () => {
    const script = buildTransformLayer({ target: "Title", scaleX: 120, scaleY: 120, rotation: 5 });
    expect(script).toContain("Title");
    expect(script).toContain("120");
  });

  it("converts export quality from percentage to Photopea's 0-1 scale", () => {
    expect(buildExportImage({ format: "jpg", quality: 85, outputPath: "/ignored.jpg" })).toContain("jpg:0.85");
  });

  it("builds selection scripts", () => {
    expect(buildMakeSelection({ type: "rect", bounds: { x: 0, y: 0, width: 100, height: 50 } })).toContain("select");
  });
});
