export type LiveCheckSpec = {
  name: string;
  path: string | ((state: Record<string, unknown>) => string);
  method?: string;
  body?: Record<string, unknown> | ((state: Record<string, unknown>) => Record<string, unknown>);
  optional?: boolean;
  required?: boolean;
  expectOk?: boolean;
  capture?: { key: string; from: string[] };
  rejectTruthyJsonPaths?: string[];
  rejectResponseTextPatterns?: string[];
};

export type BrowserJourneySpec = {
  name: string;
  startPath?: string;
  preSubmitActions?: BrowserJourneyActionSpec[];
  formFields: Record<string, string>;
  submitPattern: string;
  expectTextPatterns: string[];
  rejectTextPatterns?: string[];
  postSubmitActions?: BrowserJourneyActionSpec[];
  required?: boolean;
};

export type BrowserJourneyActionSpec = {
  name?: string;
  type: 'click' | 'goto';
  labelPattern?: string;
  path?: string;
  expectUrlPattern?: string;
  expectTextPatterns?: string[];
  rejectTextPatterns?: string[];
};

export type BrowserUiCheckSpec = {
  name: string;
  requiredTextPatterns: string[];
  requiredButtonPatterns: string[];
  requireNoConsoleErrors?: boolean;
  journeys?: BrowserJourneySpec[];
};

export type CanaryInteractionSpec = {
  name: string;
  startPath?: string;
  labelPattern: string;
  fields?: Record<string, string>;
  api?: string;
  dbTables?: string[];
  expectTextPatterns: string[];
  rejectTextPatterns?: string[];
};

export type CanaryScenario = {
  id: string;
  title: string;
  originalIdea: string;
  capabilities: string[];
  requiredRoutes: string[];
  requiredTables: string[];
  surfaceRequirements: string[];
  verificationRequirements: string[];
  liveChecks: LiveCheckSpec[];
  browserUiChecks: BrowserUiCheckSpec[];
  interactionChecks?: CanaryInteractionSpec[];
  extraCriticalTools?: string[];
  requiresExistingBaseline?: boolean;
  baselineTaskDescription?: string;
};
