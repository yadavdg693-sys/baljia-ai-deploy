import type { EngineeringToolDomain } from './engineering-tool-domain';

export const codegraphToolDomain: EngineeringToolDomain = {
  domain: 'codegraph',
  toolNames: [
    'read_codebase_map',
    'write_codebase_map',
    'build_code_graph',
    'read_code_graph_report',
    'query_code_graph',
    'explain_code_node',
    'code_graph_path',
  ],
};
