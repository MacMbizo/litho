import type { ProjectWorkspace } from './document';

export type DocTaxonomyStatus =
  | 'canonical'
  | 'healthy'
  | 'module-doc'
  | 'stale'
  | 'duplicate'
  | 'deprecated'
  | 'orphan'
  | 'agent-system';

export type DocCategory =
  | 'Core Spec'
  | 'Architecture'
  | 'Operations & Deploy'
  | 'Governance'
  | 'Agent / Skill'
  | 'Planning / Notes'
  | 'Archive';

export interface DocInventoryItem {
  fileId: string;
  path: string;
  name: string;
  title: string;
  status: DocTaxonomyStatus;
  category: DocCategory;
  wordCount: number;
  lastModifiedMs?: number;
  issues: string[];
  duplicateOf?: string;
  duplicateGroupKey?: string;
  similarityScore?: number;
  isScopedModuleDoc?: boolean;
  incomingLinksCount: number;
  referencedByFiles: string[];
  canonicalScore: number;
  brokenLinks: string[];
}

export interface MissingDocRecommendation {
  id: string;
  fileName: string;
  title: string;
  priority: 'critical' | 'recommended' | 'optional';
  reason: string;
  templateContent: string;
}

export type StackSeverity = 'current' | 'minor' | 'outdated' | 'critical' | 'unknown';

export interface StackDependencyStatus {
  name: string;
  ecosystem: 'npm' | 'pypi' | 'runtime';
  sourceFile: string;
  currentVersion: string;
  currentMajor: number | null;
  latestVersion?: string;
  latestMajor?: number | null;
  majorBehind?: number;
  severity: StackSeverity;
  upgradeCommands: string[];
  notes: string;
}

export interface DetectedStackProfile {
  frameworks: string[];
  configFilesFound: string[];
  expoSdkVersion?: string;
  nodeEngine?: string;
  packageManager?: string;
  localPort?: number;
  scripts: Record<string, string>;
  dependencies: StackDependencyStatus[];
  checkedLiveAt?: string;
}

export interface ProjectDocAuditReport {
  healthScore: number;
  grade: 'A' | 'B' | 'C' | 'D';
  inventory: DocInventoryItem[];
  counts: Record<DocTaxonomyStatus, number>;
  missingDocs: MissingDocRecommendation[];
  stackProfile: DetectedStackProfile;
  auditedAt: string;
}

export interface PortfolioProjectSummary {
  workspace: ProjectWorkspace;
  auditReport: ProjectDocAuditReport;
}
