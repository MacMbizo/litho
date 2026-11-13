import React from 'react';
import { AlertTriangle, Archive, Bot, CheckCircle2, Clock, Copy, ShieldCheck, Tag } from 'lucide-react';
import type { DocInventoryItem, DocTaxonomyStatus, ProjectDocAuditReport, StackSeverity } from '../../types/docAudit';

type IconComponent = React.ComponentType<{ className?: string }>;

/** DocPassport taxonomy, in display order. Colours and icons follow the DocAtlas spec (section 3). */
export const STATUS_META: Record<
  DocTaxonomyStatus,
  { label: string; badgeClass: string; dotClass: string; buttonClass: string; Icon: IconComponent; description: string }
> = {
  canonical: {
    label: 'Canonical',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    dotClass: 'bg-sky-400',
    buttonClass: 'bg-[#282828] hover:bg-[#333] border-[#383838] text-neutral-300',
    Icon: ShieldCheck,
    description: 'Highest-authority spec for its topic, with no drift.',
  },
  healthy: {
    label: 'Healthy',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    dotClass: 'bg-emerald-400',
    buttonClass: 'bg-[#282828] hover:bg-[#333] border-[#383838] text-neutral-300',
    Icon: CheckCircle2,
    description: 'Relevant, non-conflicting document with valid links.',
  },
  'module-doc': {
    label: 'Module Doc',
    badgeClass: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
    dotClass: 'bg-teal-400',
    buttonClass: 'bg-[#282828] hover:bg-[#333] border-[#383838] text-neutral-300',
    Icon: Tag,
    description: 'Submodule or package doc with distinct content from the root spec.',
  },
  stale: {
    label: 'Stale',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dotClass: 'bg-amber-400',
    buttonClass: 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/40 text-amber-200',
    Icon: Clock,
    description: 'Contains verifiable drift, broken links, or has not been touched in 180+ days.',
  },
  duplicate: {
    label: 'Duplicate',
    badgeClass: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    dotClass: 'bg-orange-400',
    buttonClass: 'bg-orange-500/20 hover:bg-orange-500/30 border-orange-500/40 text-orange-200',
    Icon: Copy,
    description: 'Overlaps heavily with a canonical document or is an explicit copy.',
  },
  deprecated: {
    label: 'Deprecated',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    dotClass: 'bg-rose-400',
    buttonClass: 'bg-rose-500/20 hover:bg-rose-500/30 border-rose-500/40 text-rose-200',
    Icon: Archive,
    description: 'Explicitly deprecated, archived, or stored in a legacy path.',
  },
  orphan: {
    label: 'Orphan',
    badgeClass: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
    dotClass: 'bg-zinc-400',
    buttonClass: 'bg-zinc-500/20 hover:bg-zinc-500/30 border-zinc-500/40 text-zinc-200',
    Icon: AlertTriangle,
    description: 'Unlinked scratchpad or note that nothing else references.',
  },
  'agent-system': {
    label: 'Agent / Skill',
    badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    dotClass: 'bg-purple-400',
    buttonClass: 'bg-[#282828] hover:bg-[#333] border-[#383838] text-neutral-300',
    Icon: Bot,
    description: 'System prompt, agent manifest, or tool skill spec.',
  },
};

export const STATUS_ORDER: DocTaxonomyStatus[] = [
  'canonical',
  'healthy',
  'module-doc',
  'agent-system',
  'stale',
  'duplicate',
  'orphan',
  'deprecated',
];

/** Short, specific passport label, e.g. "Stale: Port Drift" or "Duplicate · 82%". */
export function passportLabel(item: Pick<DocInventoryItem, 'status' | 'issues' | 'similarityScore'>): string {
  const base = STATUS_META[item.status].label;
  if (item.status === 'stale') {
    const reasons: string[] = [];
    if (item.issues.some((i) => i.startsWith('Port drift'))) reasons.push('Port Drift');
    if (item.issues.some((i) => i.startsWith('SDK drift'))) reasons.push('SDK Drift');
    if (item.issues.some((i) => i.includes('broken local link'))) reasons.push('Broken Links');
    if (reasons.length === 0 && item.issues.some((i) => i.startsWith('Not updated'))) reasons.push('Outdated');
    if (reasons.length === 0 && item.issues.some((i) => i.startsWith('Near-empty'))) reasons.push('Stub');
    return reasons.length ? `${base}: ${reasons.join(' + ')}` : base;
  }
  if (item.status === 'duplicate' && item.similarityScore !== undefined && item.similarityScore > 0) {
    return `${base} · ${item.similarityScore}%`;
  }
  return base;
}

/** Primary action label for a state, shown on rows in the state matrix. */
export function primaryActionLabel(status: DocTaxonomyStatus): string {
  switch (status) {
    case 'duplicate':
      return 'Compare & Resolve';
    case 'stale':
      return 'Fix Drift / Review';
    case 'deprecated':
      return 'Archive / Restore';
    case 'orphan':
      return 'Adopt / Clean Up';
    default:
      return 'Details';
  }
}

export const DocPassportBadge: React.FC<{
  item?: Pick<DocInventoryItem, 'status' | 'issues' | 'similarityScore'>;
  status?: DocTaxonomyStatus;
  detailed?: boolean;
  size?: 'xs' | 'sm';
  className?: string;
}> = ({ item, status, detailed = false, size = 'sm', className = '' }) => {
  const s = item?.status || status || 'healthy';
  const meta = STATUS_META[s];
  const label = detailed && item ? passportLabel(item) : meta.label;
  const sizing = size === 'xs' ? 'text-[9px] px-1.5 py-0.5 gap-0.5' : 'text-[10px] px-2 py-0.5 gap-1';
  return (
    <span className={`font-medium rounded border inline-flex items-center whitespace-nowrap ${sizing} ${meta.badgeClass} ${className}`}>
      <meta.Icon className={size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      <span>{label}</span>
    </span>
  );
};

export const GRADE_CLASS: Record<ProjectDocAuditReport['grade'], string> = {
  A: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
  B: 'bg-sky-500/15 border-sky-500/40 text-sky-300',
  C: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
  D: 'bg-rose-500/15 border-rose-500/40 text-rose-300',
};

export const SEVERITY_BADGE: Record<StackSeverity, string> = {
  critical: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  outdated: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  minor: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  current: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  unknown: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
};

/** Number of tracked dependencies a major version (or more) behind their registry release. */
export function countStackDrift(report: ProjectDocAuditReport): number {
  return report.stackProfile.dependencies.filter((d) => d.severity === 'critical' || d.severity === 'outdated').length;
}
