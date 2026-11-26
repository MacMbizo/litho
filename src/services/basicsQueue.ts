/**
 * "Fix several at once": which basics fixes each project can take, in the order they must run, with
 * safe defaults. Local fixes start ticked; anything legal (licence) or outward-facing (publish, push)
 * starts unticked so the person opts in project by project.
 */
import { describeProject, type ProjectBasicsFacts, type RepoFacts } from './projectBasics';
import { draftReadme, suggestRepoName } from './basicsFixes';

export type QueueStepKind = 'create-readme' | 'add-licence' | 'start-git' | 'publish-github' | 'push';

/** Run order inside a project: README and licence first so Start git commits them. */
export const QUEUE_ORDER: QueueStepKind[] = ['create-readme', 'add-licence', 'start-git', 'publish-github', 'push'];

export interface QueueStep {
  kind: QueueStepKind;
  label: string;
  /** false: shown but can't be ticked (reason says why). */
  available: boolean;
  reason?: string;
  defaultOn: boolean;
  repoPath: string;
  /** A step that must succeed first in this project (e.g. publish after Start git). */
  dependsOn?: QueueStepKind;
}

export interface QueueProject {
  rootPath: string;
  name: string;
  description?: string;
  steps: QueueStep[];
}

export interface QueueProjectInput {
  rootPath: string;
  name: string;
  facts?: ProjectBasicsFacts;
  stack: { frameworks: string[]; scripts: Record<string, string>; packageManager?: string };
}

const readableRepos = (f: ProjectBasicsFacts): RepoFacts[] => f.repos.filter((r) => !r.error);

export function planQueue(projects: QueueProjectInput[]): QueueProject[] {
  const out: QueueProject[] = [];
  for (const p of projects) {
    const f = p.facts;
    if (!f) continue;
    const steps: QueueStep[] = [];
    const repos = readableRepos(f);
    const manifest = f.manifestDescriptions[0]?.text;

    if (!f.readme) {
      steps.push(
        manifest
          ? { kind: 'create-readme', label: 'Create README', available: true, defaultOn: true, repoPath: '' }
          : {
              kind: 'create-readme',
              label: 'Create README',
              available: false,
              reason: 'Nothing describes this project yet: write its description with Create README on the project itself.',
              defaultOn: false,
              repoPath: '',
            }
      );
    }
    if (!f.licence) {
      const repo = repos.find((r) => r.path === '') || repos[0];
      steps.push({ kind: 'add-licence', label: 'Add licence', available: true, defaultOn: false, repoPath: repo?.path || '' });
    }
    if (f.repos.length === 0) {
      steps.push({ kind: 'start-git', label: 'Start git', available: true, defaultOn: true, repoPath: '' });
      steps.push({ kind: 'publish-github', label: 'Publish (private)', available: true, defaultOn: false, repoPath: '', dependsOn: 'start-git' });
    } else {
      const unpublished = repos.find((r) => r.remotes.length === 0);
      if (unpublished) {
        steps.push(
          unpublished.hasCommits
            ? { kind: 'publish-github', label: 'Publish (private)', available: true, defaultOn: false, repoPath: unpublished.path }
            : { kind: 'publish-github', label: 'Publish (private)', available: false, reason: 'Nothing committed yet: commit first.', defaultOn: false, repoPath: unpublished.path }
        );
      }
      const toPush = repos.find((r) => r.hasCommits && r.remotes.length > 0 && r.branch && (!r.upstream || r.ahead > 0));
      if (toPush) {
        steps.push({
          kind: 'push',
          label: toPush.upstream ? `Push ${toPush.ahead}` : 'Push',
          available: true,
          defaultOn: false,
          repoPath: toPush.path,
        });
      }
    }
    if (steps.length) out.push({ rootPath: p.rootPath, name: p.name, description: describeProject(f)?.text, steps });
  }
  return out;
}

/** The README the queue writes: the project's own manifest description, stack and commands. */
export function queueReadme(p: QueueProjectInput): string {
  return draftReadme({
    name: p.name,
    description: p.facts?.manifestDescriptions[0]?.text || '',
    frameworks: p.stack.frameworks,
    scripts: p.stack.scripts,
    packageManager: p.stack.packageManager,
    licence: p.facts?.licence?.kind,
  });
}

export function queueRepoName(p: QueueProjectInput, repoPath: string): string {
  return suggestRepoName(repoPath ? repoPath.split('/').pop()! : p.name);
}

/** Steps to run for one project, in order, given the ticked set. */
export function orderedSteps(project: QueueProject, ticked: Set<string>): QueueStep[] {
  return QUEUE_ORDER.flatMap((k) => project.steps.filter((s) => s.kind === k && s.available && ticked.has(stepKey(project.rootPath, k))));
}

export const stepKey = (rootPath: string, kind: QueueStepKind) => `${rootPath}::${kind}`;
