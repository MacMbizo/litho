import React, { useState } from 'react';
import { Sigma, Copy, Check, Code2 } from 'lucide-react';

interface MathBlockProps {
  latex: string;
}

const GREEK_AND_SYMBOLS: Record<string, string> = {
  '\\alpha': 'α',
  '\\beta': 'β',
  '\\gamma': 'γ',
  '\\delta': 'δ',
  '\\epsilon': 'ε',
  '\\varepsilon': 'ε',
  '\\zeta': 'ζ',
  '\\eta': 'η',
  '\\theta': 'θ',
  '\\iota': 'ι',
  '\\kappa': 'κ',
  '\\lambda': 'λ',
  '\\mu': 'μ',
  '\\nu': 'ν',
  '\\xi': 'ξ',
  '\\pi': 'π',
  '\\rho': 'ρ',
  '\\sigma': 'σ',
  '\\tau': 'τ',
  '\\upsilon': 'υ',
  '\\phi': 'φ',
  '\\varphi': 'ϕ',
  '\\chi': 'χ',
  '\\psi': 'ψ',
  '\\omega': 'ω',
  '\\Gamma': 'Γ',
  '\\Delta': 'Δ',
  '\\Theta': 'Θ',
  '\\Lambda': 'Λ',
  '\\Xi': 'Ξ',
  '\\Pi': 'Π',
  '\\Sigma': '∑',
  '\\Phi': 'Φ',
  '\\Psi': 'Ψ',
  '\\Omega': 'Ω',
  '\\sum': '∑',
  '\\prod': '∏',
  '\\int': '∫',
  '\\oint': '∮',
  '\\infty': '∞',
  '\\partial': '∂',
  '\\nabla': '∇',
  '\\pm': '±',
  '\\mp': '∓',
  '\\times': '×',
  '\\div': '÷',
  '\\cdot': '·',
  '\\leq': '≤',
  '\\le': '≤',
  '\\geq': '≥',
  '\\ge': '≥',
  '\\neq': '≠',
  '\\ne': '≠',
  '\\approx': '≈',
  '\\equiv': '≡',
  '\\sim': '∼',
  '\\propto': '∝',
  '\\in': '∈',
  '\\notin': '∉',
  '\\subset': '⊂',
  '\\subseteq': '⊆',
  '\\cup': '∪',
  '\\cap': '∩',
  '\\forall': '∀',
  '\\exists': '∃',
  '\\rightarrow': '→',
  '\\to': '→',
  '\\leftarrow': '←',
  '\\leftrightarrow': '↔',
  '\\Rightarrow': '⇒',
  '\\Leftarrow': '⇐',
  '\\Leftrightarrow': '⇔',
  '\\iff': '⟺',
  '\\dots': '…',
  '\\cdots': '⋯',
  '\\ldots': '…',
};

/**
 * Formats a LaTeX math string into clean mathematical HTML/React nodes
 */
export function renderMathExpression(expr: string): React.ReactNode {
  let formatted = expr.trim();

  // Replace \text{...} or \mathrm{...}
  formatted = formatted.replace(/\\(?:text|mathrm|mathbf)\{([^}]*)\}/g, '$1');

  // Replace \sqrt{...}
  formatted = formatted.replace(/\\sqrt\{([^}]*)\}/g, '√($1)');

  // Replace symbols
  const sortedKeys = Object.keys(GREEK_AND_SYMBOLS).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    formatted = formatted.split(key).join(GREEK_AND_SYMBOLS[key]);
  }

  // Tokenize fractions \frac{num}{den}, superscripts ^{...} or ^x, subscripts _{...} or _x
  const parts: React.ReactNode[] = [];
  const tokenRegex = /\\frac\{([^}]*)\}\{([^}]*)\}|\^\{([^}]*)\}|\^([A-Za-z0-9+-])|_\{([^}]*)\}|_([A-Za-z0-9+-])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRegex.exec(formatted)) !== null) {
    if (match.index > lastIndex) {
      parts.push(formatted.slice(lastIndex, match.index));
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // Fraction
      parts.push(
        <span
          key={`frac-${keyIdx++}`}
          className="inline-flex flex-col items-center align-middle mx-1 px-1 text-[0.88em] leading-tight"
        >
          <span className="border-b border-neutral-400/70 pb-0.5 px-1">{match[1]}</span>
          <span className="pt-0.5 px-1">{match[2]}</span>
        </span>
      );
    } else if (match[3] !== undefined || match[4] !== undefined) {
      // Superscript
      const supVal = match[3] !== undefined ? match[3] : match[4];
      parts.push(
        <sup key={`sup-${keyIdx++}`} className="text-[0.75em] ml-0.5 font-semibold text-amber-200/90">
          {supVal}
        </sup>
      );
    } else if (match[5] !== undefined || match[6] !== undefined) {
      // Subscript
      const subVal = match[5] !== undefined ? match[5] : match[6];
      parts.push(
        <sub key={`sub-${keyIdx++}`} className="text-[0.75em] ml-0.5 text-neutral-300">
          {subVal}
        </sub>
      );
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < formatted.length) {
    parts.push(formatted.slice(lastIndex));
  }

  return parts;
}

export const InlineMath: React.FC<{ latex: string }> = ({ latex }) => {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-100 font-serif italic text-[0.95em]"
      title={`LaTeX: $${latex}$`}
    >
      {renderMathExpression(latex)}
    </span>
  );
};

export const MathBlock: React.FC<MathBlockProps> = ({ latex }) => {
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(latex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = latex
    .split(/\r?\n|\\\\/)
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className="my-4 rounded-xl bg-[#16161b] border border-[#2c2c36] overflow-hidden group shadow-sm">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#1b1b22] border-b border-[#282832] text-[11px] text-neutral-400">
        <div className="flex items-center gap-1.5">
          <Sigma className="w-3.5 h-3.5 text-amber-400" />
          <span className="font-medium text-amber-200/90">Equation Block (LaTeX)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowSource(!showSource)}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#25252e] hover:bg-[#2f2f3a] text-neutral-300 hover:text-white transition"
          >
            <Code2 className="w-3 h-3 text-amber-400" />
            <span>{showSource ? 'Rendered' : 'LaTeX'}</span>
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-[#25252e] text-neutral-400 hover:text-white transition"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {showSource ? (
        <pre className="p-4 text-xs font-mono text-amber-200/90 overflow-x-auto">
          <code>{latex}</code>
        </pre>
      ) : (
        <div className="py-5 px-6 text-center space-y-2 overflow-x-auto bg-gradient-to-b from-[#17171c] to-[#141418]">
          {lines.map((line, idx) => (
            <div
              key={idx}
              className="text-lg font-serif italic text-amber-100 tracking-wide leading-relaxed"
            >
              {renderMathExpression(line)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
