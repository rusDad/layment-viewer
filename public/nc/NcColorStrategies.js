export const NC_COLOR_STRATEGY_IDS = ['motion', 'tool', 'depth', 'feed'];
export const NC_UNKNOWN_TOOL_COLOR = '#8f98a3';
export const NC_FEED_RAPID_COLOR = '#7fb7ff';

const TOOL_PALETTE = ['#42d36b', '#ffad33', '#d45cff', '#5ce1ff', '#ff6b8a', '#c9f26d', '#b38cff', '#ff8f40'];
const SCALE_PALETTE = ['#4f8cff', '#42d36b', '#fff176', '#ffad33', '#ff5c7a'];

export const motionColorStrategy = {
  id: 'motion',
  label: 'Motion',
  getSegmentColor(segment, context) {
    return context.motionColors?.[segment.motion] || context.defaultMotionColors?.[segment.motion] || '#ffffff';
  },
  getLegend(context) {
    return ['G0', 'G1', 'G2', 'G3'].map((motion) => ({ label: motion, color: context.motionColors?.[motion] || context.defaultMotionColors?.[motion] }));
  }
};

export const toolColorStrategy = {
  id: 'tool',
  label: 'Tool',
  getSegmentColor(segment, context) {
    return context.toolColors.get(getToolKey(segment.tool)) || NC_UNKNOWN_TOOL_COLOR;
  },
  getLegend(context) {
    const knownTools = context.tools.map((tool) => ({ label: `T${formatNumber(tool)}`, color: context.toolColors.get(getToolKey(tool)) }));
    return [...knownTools, { label: 'Unknown tool', color: NC_UNKNOWN_TOOL_COLOR }];
  }
};

export const depthColorStrategy = {
  id: 'depth',
  label: 'Depth',
  getSegmentColor(segment, context) {
    return colorFromScale(segment.end?.z, context.depthRange.min, context.depthRange.max);
  },
  getLegend(context) {
    return [
      { label: `Z min ${formatNumber(context.depthRange.min)}`, color: colorFromScale(context.depthRange.min, context.depthRange.min, context.depthRange.max) },
      { label: `Z max ${formatNumber(context.depthRange.max)}`, color: colorFromScale(context.depthRange.max, context.depthRange.min, context.depthRange.max) }
    ];
  },
  getSummary(context) {
    return `Z ${formatNumber(context.depthRange.min)} → ${formatNumber(context.depthRange.max)}`;
  }
};

export const feedColorStrategy = {
  id: 'feed',
  label: 'Feed',
  getSegmentColor(segment, context) {
    if (segment.motion === 'G0') return NC_FEED_RAPID_COLOR;
    return context.feedColors.get(getFeedKey(segment.feed)) || '#8f98a3';
  },
  getLegend(context) {
    const feedItems = context.feeds.map((feed) => ({ label: `F${formatNumber(feed)}`, color: context.feedColors.get(getFeedKey(feed)) }));
    return [{ label: 'G0 rapid', color: NC_FEED_RAPID_COLOR }, ...feedItems];
  },
  getSummary(context) {
    if (!Number.isFinite(context.feedRange.min) || !Number.isFinite(context.feedRange.max)) return 'Feed n/a';
    return `F ${formatNumber(context.feedRange.min)} → ${formatNumber(context.feedRange.max)}`;
  }
};

export const ncColorStrategies = {
  motion: motionColorStrategy,
  tool: toolColorStrategy,
  depth: depthColorStrategy,
  feed: feedColorStrategy
};

export function getSegmentColor(segment, context) {
  const strategy = ncColorStrategies[context.colorStrategy] || motionColorStrategy;
  return strategy.getSegmentColor(segment, context);
}

export function buildNcColorContext(toolpath, settings, defaultMotionColors) {
  const segments = Array.isArray(toolpath?.segments) ? toolpath.segments : [];
  const tools = uniqueSortedNumbers(segments.map((segment) => segment.tool));
  const feeds = uniqueSortedNumbers(segments.filter((segment) => segment.motion !== 'G0').map((segment) => segment.feed));
  const zValues = segments.map((segment) => segment.end?.z).filter(Number.isFinite);
  return {
    colorStrategy: settings.colorStrategy || 'motion',
    motionColors: settings.colors,
    defaultMotionColors,
    tools,
    feeds,
    toolColors: new Map(tools.map((tool, index) => [getToolKey(tool), TOOL_PALETTE[index % TOOL_PALETTE.length]])),
    feedColors: new Map(feeds.map((feed, index) => [getFeedKey(feed), colorFromScale(index, 0, Math.max(1, feeds.length - 1))])),
    depthRange: { min: zValues.length ? Math.min(...zValues) : 0, max: zValues.length ? Math.max(...zValues) : 0 },
    feedRange: { min: feeds.length ? Math.min(...feeds) : NaN, max: feeds.length ? Math.max(...feeds) : NaN }
  };
}

export function getNcColorLegend(context) {
  const strategy = ncColorStrategies[context.colorStrategy] || motionColorStrategy;
  return { title: strategy.label, summary: strategy.getSummary?.(context) || '', items: strategy.getLegend(context).filter((item) => item.color) };
}

function uniqueSortedNumbers(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);
}

function getToolKey(tool) { return Number.isFinite(tool) ? String(tool) : 'unknown'; }
function getFeedKey(feed) { return Number.isFinite(feed) ? String(feed) : 'unknown'; }
function formatNumber(value) { return Number.isFinite(value) ? Number(value.toFixed(3)).toString() : 'n/a'; }

function colorFromScale(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return '#8f98a3';
  if (max <= min) return SCALE_PALETTE[Math.floor(SCALE_PALETTE.length / 2)];
  const normalized = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const scaled = normalized * (SCALE_PALETTE.length - 1);
  return SCALE_PALETTE[Math.round(scaled)];
}
