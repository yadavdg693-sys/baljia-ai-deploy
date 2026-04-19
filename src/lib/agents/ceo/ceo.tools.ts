// CEO Tools — re-exports from split files for clean imports
// CEO_TOOLS = full 40-tool set for founder chat (matches Polsia experience)

import { CEO_TOOLS as CEO_BASE_TOOLS, CEO_EXTRA_TOOLS } from './ceo.tool-defs';

export const CEO_TOOLS = [...CEO_BASE_TOOLS, ...CEO_EXTRA_TOOLS];
export { handleToolCall } from './ceo.tool-handlers';
export type { ToolResult } from './ceo.tool-handlers';
