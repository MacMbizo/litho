import React from 'react';
import lithoSvg from '../../../assets/brand/litho.svg?raw';
import lithoSmallSvg from '../../../assets/brand/litho-small.svg?raw';
import docAtlasSvg from '../../../assets/brand/docatlas.svg?raw';

/**
 * Brand marks rendered inline from the SVG sources in assets/brand (the single source of truth, also
 * used to render the app icon). Inline SVG keeps them crisp at any size and needs no image request.
 * Size them with className (e.g. "w-4 h-4"); the SVG fills the box.
 */

const FILL = '[&>svg]:w-full [&>svg]:h-full [&>svg]:block';

export const LithoMark: React.FC<{ className?: string; size?: 'master' | 'small' }> = ({ className = '', size = 'master' }) => (
  <span
    aria-hidden
    className={`inline-block shrink-0 ${FILL} ${className}`}
    dangerouslySetInnerHTML={{ __html: size === 'small' ? lithoSmallSvg : lithoSvg }}
  />
);

export const DocAtlasMark: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span aria-hidden className={`inline-block shrink-0 ${FILL} ${className}`} dangerouslySetInnerHTML={{ __html: docAtlasSvg }} />
);
