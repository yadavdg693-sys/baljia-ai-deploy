// Minimal strategy interface — no abstract base class, no template method.
// Each strategy is independently complete. Per-journey divergence is explicit in each
// class's run() method. Shared stages are imported, not inherited.

import type { PipelineContext } from '../types';

export interface OnboardingStrategy {
  run(ctx: PipelineContext): Promise<void>;
}
