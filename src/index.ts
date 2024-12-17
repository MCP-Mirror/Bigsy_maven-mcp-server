#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

interface MavenSearchResponse {
  response: {
    docs: Array<{
      id: string;
      g: string; // groupId
      a: string; // artifactId
      v: string; // version
      timestamp: number;
    }>;
  };
}

const isValidMavenArgs = (
  args: any
): args is { dependency: string } =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.dependency === 'string' &&
  args.dependency.includes(':');

class MavenDepsServer {
  private server: Server;
  private axiosInstance;

  constructor() {
    this.server = new Server(
      {
        name: 'maven-deps-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.axiosInstance = axios.create({
      baseURL: 'https://search.maven.org/solrsearch/select',
    });

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_maven_latest_version',
          description: 'Get the latest version of a Maven dependency',
          inputSchema: {
            type: 'object',
            properties: {
              dependency: {
                type: 'string',
                description: 'Maven dependency in format "groupId:artifactId" (e.g. "org.springframework:spring-core")',
              },
            },
            required: ['dependency'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'get_maven_latest_version') {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }

      if (!isValidMavenArgs(request.params.arguments)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Invalid Maven dependency format. Expected "groupId:artifactId"'
        );
      }

      const [groupId, artifactId] = request.params.arguments.dependency.split(':');

      try {
        const response = await this.axiosInstance.get<MavenSearchResponse>('', {
          params: {
            q: `g:"${groupId}" AND a:"${artifactId}"`,
            core: 'gav',
            rows: 1,
            wt: 'json',
            sort: 'timestamp desc',
          },
        });

        if (!response.data.response.docs.length) {
          return {
            content: [
              {
                type: 'text',
                text: `No Maven dependency found for ${groupId}:${artifactId}`,
              },
            ],
            isError: true,
          };
        }

        const latestVersion = response.data.response.docs[0].v;
        return {
          content: [
            {
              type: 'text',
              text: latestVersion,
            },
          ],
        };
      } catch (error) {
        if (axios.isAxiosError(error)) {
          return {
            content: [
              {
                type: 'text',
                text: `Maven Central API error: ${
                  error.response?.data?.error?.msg ?? error.message
                }`,
              },
            ],
            isError: true,
          };
        }
        throw error;
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Maven Dependencies MCP server running on stdio');
  }
}

const server = new MavenDepsServer();
server.run().catch(console.error);
