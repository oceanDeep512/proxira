import { describe, it, expect } from "vitest";
import { collectBody } from "./http.js";

const textEncoder = new TextEncoder();

describe("collectBody - format detection", () => {
  const bodyLimit = 32768;

  it("should detect JSON by Content-Type", () => {
    const bytes = textEncoder.encode('{"key": "value"}');
    const result = collectBody(bytes, "application/json", bodyLimit);
    expect(result.format).toBe("json");
  });

  it("should detect JSON by content (starts with {)", () => {
    const bytes = textEncoder.encode('{"key": "value"}');
    const result = collectBody(bytes, null, bodyLimit);
    expect(result.format).toBe("json");
  });

  it("should detect JSON array by content (starts with [)", () => {
    const bytes = textEncoder.encode('[{"key": "value"}]');
    const result = collectBody(bytes, null, bodyLimit);
    expect(result.format).toBe("json");
  });

  it("should detect XML by Content-Type", () => {
    const bytes = textEncoder.encode("<root></root>");
    const result = collectBody(bytes, "application/xml", bodyLimit);
    expect(result.format).toBe("xml");
  });

  it("should detect XML by content (starts with <?xml)", () => {
    const bytes = textEncoder.encode('<?xml version="1.0"?><root></root>');
    const result = collectBody(bytes, null, bodyLimit);
    expect(result.format).toBe("xml");
  });

  it("should detect form-urlencoded by Content-Type", () => {
    const bytes = textEncoder.encode("key=value&foo=bar");
    const result = collectBody(bytes, "application/x-www-form-urlencoded", bodyLimit);
    expect(result.format).toBe("form-urlencoded");
  });

  it("should detect form-urlencoded by content pattern", () => {
    const bytes = textEncoder.encode("key=value&foo=bar");
    const result = collectBody(bytes, null, bodyLimit);
    expect(result.format).toBe("form-urlencoded");
  });

  it("should detect HTML by Content-Type", () => {
    const bytes = textEncoder.encode("<html><body></body></html>");
    const result = collectBody(bytes, "text/html", bodyLimit);
    expect(result.format).toBe("html");
  });

  it("should detect HTML by content (has <!doctype html)", () => {
    const bytes = textEncoder.encode("<!DOCTYPE html><html></html>");
    const result = collectBody(bytes, null, bodyLimit);
    expect(result.format).toBe("html");
  });

  it("should detect YAML by Content-Type", () => {
    const bytes = textEncoder.encode("key: value");
    const result = collectBody(bytes, "application/yaml", bodyLimit);
    expect(result.format).toBe("yaml");
  });

  it("should detect YAML by content (starts with ---)", () => {
    const bytes = textEncoder.encode("---\nkey: value");
    const result = collectBody(bytes, null, bodyLimit);
    expect(result.format).toBe("yaml");
  });

  it("should default to text for unknown formats", () => {
    const bytes = textEncoder.encode("plain text content");
    const result = collectBody(bytes, null, bodyLimit);
    expect(result.format).toBe("text");
  });

  it("should mark empty body as text format", () => {
    const bytes = new Uint8Array(0);
    const result = collectBody(bytes, null, bodyLimit);
    expect(result.format).toBe("text");
  });

  it("should detect CSV by Content-Type", () => {
    const bytes = textEncoder.encode("id,name\n1,alice\n2,bob\n");
    const result = collectBody(bytes, "text/csv", bodyLimit);
    expect(result.format).toBe("csv");
  });

  it("should detect CSV by content shape", () => {
    const bytes = textEncoder.encode("id,name,role\n1,alice,dev\n2,bob,design\n");
    const result = collectBody(bytes, null, bodyLimit);
    expect(result.format).toBe("csv");
  });

  it("should detect tab separated values as CSV", () => {
    const bytes = textEncoder.encode("id\tname\n1\talice\n2\tbob\n");
    const result = collectBody(bytes, "text/tab-separated-values", bodyLimit);
    expect(result.format).toBe("csv");
  });

  it("should not treat single-line text as CSV", () => {
    const bytes = textEncoder.encode("just,one,line");
    const result = collectBody(bytes, null, bodyLimit);
    expect(result.format).not.toBe("csv");
  });
});

describe("collectBody - binary preview", () => {
  const bodyLimit = 32768;

  it("should keep a UTF-8 preview for binary content types", () => {
    const bytes = textEncoder.encode('{"error":"upstream failed"}');
    const result = collectBody(bytes, "application/octet-stream", bodyLimit);
    expect(result.isBinary).toBe(true);
    expect(result.text).toBe('{"error":"upstream failed"}');
    expect(result.truncated).toBe(false);
  });

  it("should truncate the binary preview at maxCaptureBytes", () => {
    const bytes = textEncoder.encode("a".repeat(100));
    const result = collectBody(bytes, "application/octet-stream", 10);
    expect(result.isBinary).toBe(true);
    expect(result.text).toBe("a".repeat(10));
    expect(result.truncated).toBe(true);
    expect(result.size).toBe(100);
  });
});
