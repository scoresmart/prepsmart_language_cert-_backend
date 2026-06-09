import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { env } from '../config/env';
import { CertificationType, DifficultyLevel, McpQuestionFilter, QuestionType, SkillSection } from '../types';

export interface McpQuestion {
  externalId: string;
  certification: CertificationType;
  section: SkillSection;
  questionType: QuestionType;
  difficulty: DifficultyLevel;
  title: string;
  content: string;
  mediaUrl?: string | null;
  options?: object | null;
  correctAnswer?: string | null;
  explanation?: string | null;
  tags?: string[];
  timeAllotted?: number | null;
  marks: number;
}

export class McpService {
  private client: Client | null = null;

  /**
   * Initialise and connect to the MCP question server.
   * The server details are read from environment variables:
   *   MCP_SERVER_COMMAND  – executable to launch (default: "node")
   *   MCP_SERVER_ARGS     – space-separated args (default: path from MCP_SERVER_SCRIPT)
   */
  async connect(): Promise<void> {
    const command = process.env.MCP_SERVER_COMMAND || 'node';
    const args = process.env.MCP_SERVER_ARGS
      ? process.env.MCP_SERVER_ARGS.split(' ')
      : [process.env.MCP_SERVER_SCRIPT || './mcp-question-server/dist/index.js'];

    const transport = new StdioClientTransport({ command, args });

    this.client = new Client(
      { name: 'prepsmart-language-cert', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    await this.client.connect(transport);
    console.log('[McpService] Connected to MCP question server');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  /**
   * Fetch questions from the MCP server using the `get_questions` tool.
   * Falls back to an empty array if the MCP server is unavailable.
   */
  async fetchQuestions(filter: McpQuestionFilter): Promise<McpQuestion[]> {
    try {
      if (!this.client) {
        await this.connect();
      }

      const result = await this.client!.callTool({
        name: 'get_questions',
        arguments: {
          certification: filter.certification,
          section: filter.section,
          questionType: filter.questionType,
          difficulty: filter.difficulty,
          limit: filter.limit ?? 50,
          tags: filter.tags ?? [],
        },
      });

      // MCP tools return content as an array of content blocks
      const content = result.content as Array<{ type: string; text?: string }>;
      const textBlock = content.find((c) => c.type === 'text');
      if (!textBlock?.text) return [];

      const parsed = JSON.parse(textBlock.text);
      return Array.isArray(parsed) ? (parsed as McpQuestion[]) : (parsed.questions ?? []);
    } catch (error) {
      console.error('[McpService] Failed to fetch questions:', error);
      return [];
    }
  }

  /**
   * List available question tools exposed by the MCP server.
   */
  async listTools(): Promise<unknown[]> {
    if (!this.client) await this.connect();
    const { tools } = await this.client!.listTools();
    return tools;
  }
}
