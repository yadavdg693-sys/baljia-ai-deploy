export interface LocalRepoModePlan {
  mode: 'local_repo';
  steps: string[];
  requiresLocalVerification: boolean;
  pushAfterVerification: boolean;
}

export function shouldUseLocalRepoMode(taskText: string): boolean {
  return /\b(existing app|existing-app|checked[- ]out|local repo|debug|extend|refactor|regression|failing test|complex extension)\b/i.test(taskText);
}

export function createLocalRepoModePlan(taskText: string): LocalRepoModePlan {
  const needsGraph = /\b(existing app|existing-app|extend|debug|refactor|route|component|schema|table)\b/i.test(taskText);
  return {
    mode: 'local_repo',
    requiresLocalVerification: true,
    pushAfterVerification: true,
    steps: [
      'checkout_or_fetch_repo',
      needsGraph ? 'inspect_with_lsp_or_code_graph' : 'inspect_with_read_and_grep',
      'produce_patch_or_diff',
      'run_local_build_or_tests_when_available',
      'push_after_local_verification',
      'deploy_after_push',
    ],
  };
}
