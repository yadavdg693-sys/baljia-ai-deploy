const fs = require('fs');
const file = 'src/lib/agents/ceo/ceo.tool-handlers.ts';
let c = fs.readFileSync(file, 'utf8');

// Remove dispatch case for list_mcp_servers
c = c.replace(
  "    case 'list_mcp_servers': return handleListMcpServers();",
  "    // list_mcp_servers removed (guardrail — exposes internal infra to founder)"
);

fs.writeFileSync(file, c, 'utf8');
console.log('list_mcp_servers dispatch removed');
