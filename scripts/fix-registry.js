const fs = require('fs');
const file = 'src/lib/agents/ceo/ceo.tool-handlers.ts';
const content = fs.readFileSync(file, 'utf8');

// Find the broken point: meta_ads line exists but registry wasn't closed
// We need to find where the PLATFORM_TOOL_REGISTRY ends and insert closing brace
const lines = content.split('\n');
let fixedLines = [];
let registryFixed = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  fixedLines.push(line);
  
  // After the meta_ads line but before the async function, inject missing lines
  if (!registryFixed 
      && line.includes("meta_ads: ['get_campaigns'")
      && i + 1 < lines.length 
      && lines[i + 1].includes('async function handleListMcpTools')) {
    fixedLines.push("  research: ['web_search','search_competitors','get_market_data'],");
    fixedLines.push("  base: ['read_document','write_document','create_task','update_task_status','send_message','save_memory','get_memory','list_scripts','run_script','get_script_output','add_dashboard_link','get_dashboard_links'],");
    fixedLines.push('};');
    fixedLines.push('');
    registryFixed = true;
    console.log(`Fixed registry at line ${i + 1}`);
  }
}

fs.writeFileSync(file, fixedLines.join('\n'), 'utf8');
console.log(`Done. Registry fixed: ${registryFixed}`);
