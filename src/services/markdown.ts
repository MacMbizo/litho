import yaml from 'js-yaml';
import { DocumentMetadata, TaskItem } from '../types/document';

export class MarkdownService {
  /**
   * Parse raw markdown string into frontmatter and body
   */
  static parse(raw: string, filePath: string = ''): {
    frontmatter: DocumentMetadata;
    body: string;
    tasks: TaskItem[];
    wordCount: number;
  } {
    let frontmatter: DocumentMetadata = {};
    let body = raw;

    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
    const match = raw.match(frontmatterRegex);

    if (match) {
      try {
        const parsed = yaml.load(match[1]) as Record<string, any>;
        if (parsed && typeof parsed === 'object') {
          frontmatter = parsed;
        }
      } catch (e) {
        console.warn('Failed to parse YAML frontmatter:', e);
      }
      body = raw.slice(match[0].length);
    }

    // Default metadata if not provided
    if (!frontmatter.type) {
      frontmatter.type = 'document';
    }
    if (!frontmatter.title) {
      const headingMatch = body.match(/^#\s+(.+)$/m);
      frontmatter.title = headingMatch ? headingMatch[1].trim() : 'Untitled';
    }
    if (!frontmatter.tags) {
      frontmatter.tags = [];
    }

    // Extract task items
    const tasks = this.extractTasks(body, filePath);

    // Compute word count
    const words = body.trim().split(/\s+/).filter(Boolean).length;

    return {
      frontmatter,
      body,
      tasks,
      wordCount: words,
    };
  }

  /**
   * Serializes frontmatter and body back into standard markdown
   */
  static stringify(frontmatter: DocumentMetadata, body: string): string {
    // Clean empty/undefined keys
    const cleanFrontmatter: Record<string, any> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      if (value !== undefined && value !== null && value !== '') {
        cleanFrontmatter[key] = value;
      }
    }

    if (Object.keys(cleanFrontmatter).length === 0) {
      return body;
    }

    const yamlStr = yaml.dump(cleanFrontmatter, {
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
    });

    return `---\n${yamlStr}---\n\n${body.trimStart()}`;
  }

  /**
   * Extract markdown checkboxes (- [ ] / - [x])
   */
  static extractTasks(body: string, filePath: string): TaskItem[] {
    const lines = body.split(/\r?\n/);
    const tasks: TaskItem[] = [];
    const fileName = filePath.split(/[\\/]/).pop() || 'Untitled';

    const taskRegex = /^\s*-\s*\[([ xX])\]\s*(.+)$/;

    lines.forEach((line, index) => {
      const match = line.match(taskRegex);
      if (match) {
        tasks.push({
          id: `${filePath}:${index + 1}`,
          text: match[2].trim(),
          completed: match[1].toLowerCase() === 'x',
          filePath,
          fileName,
          line: index + 1,
        });
      }
    });

    return tasks;
  }

  /**
   * Toggle task checkbox inside markdown body
   */
  static toggleTask(body: string, targetLine: number, completed: boolean): string {
    const lines = body.split(/\r?\n/);
    if (targetLine <= 0 || targetLine > lines.length) return body;

    const lineIndex = targetLine - 1;
    const taskRegex = /^(\s*-\s*\[)([ xX])(\]\s*.+)$/;
    const match = lines[lineIndex].match(taskRegex);

    if (match) {
      lines[lineIndex] = `${match[1]}${completed ? 'x' : ' '}${match[3]}`;
    }

    return lines.join('\n');
  }

  /**
   * Templates for different document types
   */
  static getTemplate(type: 'project' | 'agent' | 'skill' | 'note'): { frontmatter: DocumentMetadata; body: string } {
    switch (type) {
      case 'agent':
        return {
          frontmatter: {
            title: 'New AI Agent',
            type: 'agent',
            status: 'Active',
            priority: 'High',
            model: 'gemini-1.5-pro',
            tags: ['agent', 'automation'],
            tools: ['web_search', 'read_file', 'run_command'],
            created_at: new Date().toISOString().split('T')[0],
          },
          body: `# New AI Agent\n\n> System Persona and execution instructions.\n\n## System Prompt\nYou are an autonomous agent specialized in...\n\n## Tools & Capabilities\n- [x] Web Search\n- [x] Code Analysis\n- [ ] Sandbox Execution\n\n## Test Inputs\n- Test query: \`Analyze repository health\`\n`,
        };
      case 'skill':
        return {
          frontmatter: {
            title: 'New Skill Definition',
            type: 'skill',
            status: 'Draft',
            tags: ['skill', 'utility'],
            category: 'Developer Tools',
            version: '1.0.0',
            created_at: new Date().toISOString().split('T')[0],
          },
          body: `# Skill: New Skill Definition\n\n## Overview\nDetailed step-by-step procedure and prompt guidance.\n\n## When to Use\n- Use this skill when the user requests...\n\n## Execution Steps\n- [ ] Step 1: Initialize environment\n- [ ] Step 2: Validate inputs\n- [ ] Step 3: Produce formatted output\n`,
        };
      case 'project':
        return {
          frontmatter: {
            title: 'New Project Roadmap',
            type: 'project',
            status: 'In Progress',
            priority: 'High',
            tags: ['project', 'roadmap'],
            created_at: new Date().toISOString().split('T')[0],
          },
          body: `# New Project Roadmap\n\n## Objective\nDefine the primary objective and milestones.\n\n## Scope & Deliverables\n- [ ] Architecture design\n- [ ] MVP implementation\n- [ ] User testing & feedback\n- [ ] Release v1.0\n\n## Notes & Decisions\nKey architecture decisions logged here.\n`,
        };
      default:
        return {
          frontmatter: {
            title: 'Untitled Document',
            type: 'document',
            status: 'Draft',
            tags: ['notes'],
            created_at: new Date().toISOString().split('T')[0],
          },
          body: `# Untitled Document\n\nStart typing your thoughts here or press \`/\` for commands.\n`,
        };
    }
  }

  /**
   * Check if markdown string has YAML frontmatter
   */
  static hasFrontmatter(raw: string): boolean {
    return /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.test(raw);
  }

  /**
   * Upgrade raw markdown file with clean YAML frontmatter
   */
  static upgradeRawMarkdown(raw: string, suggested: Partial<DocumentMetadata> = {}): string {
    const parsed = this.parse(raw);
    const mergedFrontmatter: DocumentMetadata = {
      ...parsed.frontmatter,
      ...suggested,
      updated_at: new Date().toISOString().split('T')[0],
    };

    return this.stringify(mergedFrontmatter, parsed.body);
  }
}
