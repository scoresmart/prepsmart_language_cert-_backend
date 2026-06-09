import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { sampleQuestions } from './sampleData.js';

const server = new Server(
  { name: 'prepsmart-question-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ─── List available tools ─────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_questions',
        description:
          'Fetch language certification practice questions filtered by certification type, section, question type, and difficulty.',
        inputSchema: {
          type: 'object',
          properties: {
            certification: {
              type: 'string',
              enum: ['PTE', 'IELTS', 'TOEFL', 'DUOLINGO'],
              description: 'The language certification type',
            },
            section: {
              type: 'string',
              enum: ['SPEAKING', 'WRITING', 'READING', 'LISTENING'],
              description: 'Skill section to filter by',
            },
            questionType: {
              type: 'string',
              description: 'Specific question type (e.g. READ_ALOUD, WRITE_ESSAY)',
            },
            difficulty: {
              type: 'string',
              enum: ['EASY', 'MEDIUM', 'HARD'],
              description: 'Difficulty level',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of questions to return (default 10)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional topic tags to filter by',
            },
          },
          required: ['certification'],
        },
      },
      {
        name: 'get_question_by_id',
        description: 'Fetch a single question by its external ID.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The external question ID' },
          },
          required: ['id'],
        },
      },
      {
        name: 'ping',
        description: 'Health check — returns pong with server info.',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  };
});

// ─── Handle tool calls ────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'ping': {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'pong',
              server: 'prepsmart-question-server',
              version: '1.0.0',
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      };
    }

    case 'get_questions': {
      const { certification, section, questionType, difficulty, limit = 10, tags = [] } =
        args as {
          certification: string;
          section?: string;
          questionType?: string;
          difficulty?: string;
          limit?: number;
          tags?: string[];
        };

      let results = sampleQuestions.filter((q) => q.certification === certification);

      if (section) results = results.filter((q) => q.section === section);
      if (questionType) results = results.filter((q) => q.questionType === questionType);
      if (difficulty) results = results.filter((q) => q.difficulty === difficulty);
      if (tags.length > 0)
        results = results.filter((q) => tags.some((t) => q.tags.includes(t)));

      results = results.slice(0, limit);

      return {
        content: [{ type: 'text', text: JSON.stringify(results) }],
      };
    }

    case 'get_question_by_id': {
      const { id } = args as { id: string };
      const question = sampleQuestions.find((q) => q.externalId === id);
      if (!question) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Question not found' }) }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(question) }] };
    }

    default:
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] prepsmart-question-server running on stdio');
}

main().catch((err) => {
  console.error('[MCP] Fatal error:', err);
  process.exit(1);
});
