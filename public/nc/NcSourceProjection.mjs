export const NC_SOURCE_ROW_HEIGHT_PX = 24;
const NC_SOURCE_OVERSCAN_ROWS = 8;

export function projectNcSourceLines(sourceLines, filterLineIds = null) {
  if (!(filterLineIds instanceof Set)) return sourceLines;
  return sourceLines.filter((line) => filterLineIds.has(line.lineId));
}

export function getNcSourceVirtualWindow(lineCount, scrollTop, clientHeight) {
  const viewportRows = Math.max(1, Math.ceil(clientHeight / NC_SOURCE_ROW_HEIGHT_PX));
  const visibleStart = Math.floor(scrollTop / NC_SOURCE_ROW_HEIGHT_PX);
  return {
    first: Math.max(0, visibleStart - NC_SOURCE_OVERSCAN_ROWS),
    last: Math.min(lineCount - 1, visibleStart + viewportRows + NC_SOURCE_OVERSCAN_ROWS),
    totalHeight: lineCount * NC_SOURCE_ROW_HEIGHT_PX
  };
}
