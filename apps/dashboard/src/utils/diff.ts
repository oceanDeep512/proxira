export type DiffLine = {
  type: "same" | "add" | "del";
  text: string;
};

export type DiffStats = {
  added: number;
  removed: number;
};

// Minimal LCS line diff: enough to show what changed between two responses
// without pulling a diff library into the bundle.
const buildMatrix = (a: string[], b: string[]): number[][] => {
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      matrix[i]![j] =
        a[i] === b[j] ? (matrix[i + 1]![j + 1] ?? 0) + 1 : Math.max(matrix[i + 1]![j] ?? 0, matrix[i]![j + 1] ?? 0);
    }
  }
  return matrix;
};

export const diffLines = (beforeText: string, afterText: string): DiffLine[] => {
  const a = beforeText.split("\n");
  const b = afterText.split("\n");
  const matrix = buildMatrix(a, b);
  const result: DiffLine[] = [];

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ type: "same", text: a[i] ?? "" });
      i += 1;
      j += 1;
    } else if ((matrix[i + 1]?.[j] ?? 0) >= (matrix[i]?.[j + 1] ?? 0)) {
      result.push({ type: "del", text: a[i] ?? "" });
      i += 1;
    } else {
      result.push({ type: "add", text: b[j] ?? "" });
      j += 1;
    }
  }
  while (i < a.length) {
    result.push({ type: "del", text: a[i] ?? "" });
    i += 1;
  }
  while (j < b.length) {
    result.push({ type: "add", text: b[j] ?? "" });
    j += 1;
  }
  return result;
};

export const diffStats = (lines: DiffLine[]): DiffStats => ({
  added: lines.filter((line) => line.type === "add").length,
  removed: lines.filter((line) => line.type === "del").length,
});

// Collapse long runs of unchanged lines so the diff stays readable.
export const collapseUnchanged = (
  lines: DiffLine[],
  context = 2,
  threshold = 8,
): (DiffLine | { type: "skip"; count: number })[] => {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.type === "same") {
      return;
    }
    for (let offset = -context; offset <= context; offset += 1) {
      const target = index + offset;
      if (target >= 0 && target < lines.length) {
        keep[target] = true;
      }
    }
  });

  const output: (DiffLine | { type: "skip"; count: number })[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped > 0) {
        output.push({ type: "skip", count: skipped });
        skipped = 0;
      }
      output.push(line);
      return;
    }
    skipped += 1;
  });
  if (skipped > 0 && skipped <= threshold) {
    // Too few lines to be worth hiding: show them instead of a summary row.
    const start = lines.length - skipped;
    for (let index = start; index < lines.length; index += 1) {
      const line = lines[index];
      if (line) {
        output.push(line);
      }
    }
    return output;
  }
  if (skipped > 0) {
    output.push({ type: "skip", count: skipped });
  }
  return output;
};
