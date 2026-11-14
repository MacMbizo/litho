import type { ProjectWorkspace } from './document';
import type { FixRecipe } from '../services/fixRecipes';
export type { FixRecipe };

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
  /** Folder of the app/package that declares it, relative to the project root ('' = root). */
  appPath?: string;
  /** Version actually present in node_modules, when it could be read. */
  installedVersion?: string;
  latestVersion?: string;
  latestMajor?: number | null;
  majorBehind?: number;
  severity: StackSeverity;
  upgradeCommands: string[];
  notes: string;
}

/** One buildable unit inside a project: the root, or a nested app such as `mobile/`. */
export interface StackAppUnit {
  path: string; // '' = project root
  label: string;
  manifests: string[];
  frameworks: string[];
  expoSdkVersion?: string;
  packageManager?: string;
  /** All direct npm dependencies (used for Expo SDK alignment checks). */
  npmDependencies?: Record<string, string>;
  /** false when package.json exists but node_modules is missing. */
  depsInstalled?: boolean;
}

/** A runtime pin (Node / Python) found in engines, .nvmrc, Dockerfile etc., with its end-of-life date. */
export interface RuntimePin {
  runtime: 'node' | 'python';
  version: string;
  major: number;
  minor?: number;
  source: string;
  appPath: string;
  /** true when the pin is only a lower bound (e.g. ">=18"). */
  isMinimum: boolean;
  eolDate?: string;
}

export interface ExpoAlignmentIssue {
  appPath: string;
  sdkMajor: number;
  packageName: string;
  declared: string;
  expected: string;
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
  apps?: StackAppUnit[];
  runtimes?: RuntimePin[];
  expoAlignment?: ExpoAlignmentIssue[];
  /** What the newest Expo SDK ships with, e.g. { 'react-native': '0.81.4', react: '19.1.0' }. */
  latestExpoBundle?: { sdkMajor: number; reactNative?: string; react?: string };
  checkedLiveAt?: string;
}

export type FreshnessLevel = 'fresh' | 'aging' | 'stale' | 'critical' | 'unchecked' | 'none';

export interface FreshnessIssue {
  id: string;
  appPath: string;
  severity: 'critical' | 'outdated' | 'minor';
  /** platform = decides whether the app runs/builds at all; library = app code; tooling = dev-only. */
  tier: 'platform' | 'library' | 'tooling';
  title: string;
  detail: string;
  commands: string[];
  /** Set when DocAtlas can run the fix itself (after confirmation); copy-only issues leave it unset. */
  fix?: FixRecipe;
}

export interface StackFreshnessReport {
  score: number | null;
  level: FreshnessLevel;
  headline: string;
  issues: FreshnessIssue[];
  counts: { critical: number; outdated: number; minor: number; current: number; unknown: number };
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
  /** Set when this entry came from the saved snapshot (file contents not loaded). */
  fromSnapshot?: boolean;
  scannedAt?: string;
}
