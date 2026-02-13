'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { fetchContexts } from '@/lib/api';
import type { ContextEntry } from '@/types';
import { Loader2, AlertCircle, ChevronRight, ChevronDown, GitFork, Link2, Layers } from './icons';

interface TreeNode {
  context: ContextEntry;
  children: TreeNode[];
  spawnReason?: string;
}

interface LineageTreeProps {
  contextId: string;
  onContextClick?: (contextId: string) => void;
  className?: string;
}

function buildTree(contexts: ContextEntry[], targetContextId: string): TreeNode | null {
  // Build lookup maps
  const byId = new Map<string, ContextEntry>();
  const childrenOf = new Map<string, ContextEntry[]>();

  for (const ctx of contexts) {
    byId.set(ctx.context_id, ctx);
    const parentId = ctx.provenance?.parent_context_id;
    if (parentId != null) {
      const key = String(parentId);
      if (!childrenOf.has(key)) childrenOf.set(key, []);
      childrenOf.get(key)!.push(ctx);
    }
  }

  // Walk up from target to find root
  let rootId = targetContextId;
  const visited = new Set<string>();
  while (true) {
    visited.add(rootId);
    const ctx = byId.get(rootId);
    const parentId = ctx?.provenance?.parent_context_id;
    if (!parentId || visited.has(String(parentId))) break;
    rootId = String(parentId);
  }

  const rootCtx = byId.get(rootId);
  if (!rootCtx) return null;

  // Recursively build tree
  function buildNode(ctx: ContextEntry): TreeNode {
    const kids = (childrenOf.get(ctx.context_id) || [])
      .sort((a, b) => Number(a.context_id) - Number(b.context_id));

    return {
      context: ctx,
      children: kids.map(buildNode),
      spawnReason: ctx.provenance?.spawn_reason,
    };
  }

  return buildNode(rootCtx);
}

function TreeNodeView({
  node,
  currentContextId,
  depth,
  onContextClick,
}: {
  node: TreeNode;
  currentContextId: string;
  depth: number;
  onContextClick?: (id: string) => void;
}) {
  const isCurrent = node.context.context_id === currentContextId;
  const continuations = node.children.filter(c => c.spawnReason === 'session_continue');
  const subagents = node.children.filter(c => c.spawnReason !== 'session_continue');
  const [subagentsExpanded, setSubagentsExpanded] = useState(false);

  const title = node.context.title?.replace(/^\[[\w-]+\]\s*/, '').slice(0, 50) || `Context ${node.context.context_id}`;

  return (
    <div>
      {/* This node */}
      <button
        onClick={() => onContextClick?.(node.context.context_id)}
        className={cn(
          'w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors text-xs group',
          isCurrent
            ? 'bg-theme-accent-muted text-theme-accent'
            : 'text-theme-text-secondary hover:bg-theme-bg-tertiary/50'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Connector line for non-root */}
        {depth > 0 && (
          node.spawnReason === 'session_continue'
            ? <Link2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            : <GitFork className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        )}
        {depth === 0 && (
          <Layers className="w-3.5 h-3.5 text-theme-text-dim shrink-0" />
        )}

        <span className={cn(
          'font-mono shrink-0',
          isCurrent ? 'text-theme-accent font-semibold' : 'text-theme-text-dim'
        )}>
          #{node.context.context_id}
        </span>
        <span className="truncate">{title}</span>
        {isCurrent && (
          <span className="ml-auto px-1.5 py-0.5 bg-theme-accent/20 text-theme-accent rounded text-[10px] font-medium shrink-0">
            current
          </span>
        )}
      </button>

      {/* Subagents group (collapsed by default) */}
      {subagents.length > 0 && (
        <div>
          <button
            onClick={() => setSubagentsExpanded(!subagentsExpanded)}
            className="w-full text-left flex items-center gap-2 px-2 py-1 text-xs text-theme-text-dim hover:text-theme-text-muted transition-colors"
            style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
          >
            {subagentsExpanded
              ? <ChevronDown className="w-3 h-3 shrink-0" />
              : <ChevronRight className="w-3 h-3 shrink-0" />
            }
            <GitFork className="w-3 h-3 text-amber-400 shrink-0" />
            <span>{subagents.length} subagent{subagents.length !== 1 ? 's' : ''}</span>
          </button>
          {subagentsExpanded && subagents.map(child => (
            <TreeNodeView
              key={child.context.context_id}
              node={child}
              currentContextId={currentContextId}
              depth={depth + 2}
              onContextClick={onContextClick}
            />
          ))}
        </div>
      )}

      {/* Continuations (always expanded — they're the main chain) */}
      {continuations.map(child => (
        <TreeNodeView
          key={child.context.context_id}
          node={child}
          currentContextId={currentContextId}
          depth={depth + 1}
          onContextClick={onContextClick}
        />
      ))}
    </div>
  );
}

export function LineageTree({ contextId, onContextClick, className }: LineageTreeProps) {
  const [contexts, setContexts] = useState<ContextEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetchContexts({ limit: 1000, include_provenance: true })
      .then((response) => {
        setContexts(response.contexts);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load contexts');
        setLoading(false);
      });
  }, [contextId]);

  const tree = useMemo(() => buildTree(contexts, contextId), [contexts, contextId]);

  if (loading) {
    return (
      <div className={cn('p-4 flex items-center gap-2 text-theme-text-dim', className)}>
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading lineage...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('p-4 flex items-center gap-2 text-amber-400', className)}>
        <AlertCircle className="w-4 h-4" />
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  if (!tree) {
    return (
      <div className={cn('p-4 text-center', className)}>
        <p className="text-sm text-theme-text-dim">No lineage data available</p>
        <p className="text-xs text-theme-text-faint mt-1">
          This context has no parent or child relationships.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('p-2 overflow-y-auto', className)}>
      <TreeNodeView
        node={tree}
        currentContextId={contextId}
        depth={0}
        onContextClick={onContextClick}
      />
    </div>
  );
}

export default LineageTree;
