import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import sql from 'mssql';

const config = {
    server: 'tds.cdata.com',
    port: 14333,
    database: process.env.CDATA_CONNECT_CLOUD_CATALOG_NAME,
    user: process.env.CDATA_CONNECT_CLOUD_USER,
    password: process.env.CDATA_CONNECT_CLOUD_PAT,
    options: {
        encrypt: true
    }
};

async function executeQuery(query) {
    let pool;
    try {
        console.error('Executing query:', query);
        pool = await sql.connect(config);
        const result = await pool.request().query(query);
        console.error('Query result:', result);
        return result.recordset;
    } catch (err) {
        console.error('SQL execution error:', err);
        throw err;
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

class CDataMCPServer {
    constructor() {
        this.server = new Server(
            {
                name: 'cdata-mcp-server',
                version: '0.0.1',
            },
            {
                capabilities: {
                    tools: {
                        execute_query: {
                            description: 'Execute SQL query on CData Connect Cloud',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    query: {
                                        type: 'string',
                                        description: 'SQL query to execute',
                                    },
                                },
                                required: ['query'],
                            },
                        },
                    },
                },
            }
        );

        const requiredEnvVars = [
            'CDATA_CONNECT_CLOUD_CATALOG_NAME',
            'CDATA_CONNECT_CLOUD_USER',
            'CDATA_CONNECT_CLOUD_PAT'
        ];
        const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]?.trim());

        if (missingEnvVars.length > 0) {
            throw new Error('Missing required environment variables: ' + missingEnvVars.join(', '));
        }

        this.setupRequestHandlers();

        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }

    setupRequestHandlers() {
        // Get list of tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'execute_query',
                    description: 'Execute SQL query on CData Connect Cloud',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'SQL query to execute',
                            },
                        },
                        required: ['query'],
                    },
                },
            ],
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                console.error('Tool request:', request.params);
                const result = await this.executeToolRequest(request);
                return this.formatSuccessResponse(result);
            } catch (error) {
                console.error('Error in tool execution:', error);
                this.handleToolError(error);
            }
        });
    }

    async executeToolRequest(request) {
        const { name, arguments: args } = request.params;

        if (name === 'execute_query') {
            return executeQuery(args.query);
        }

        throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${name}`
        );
    }

    formatSuccessResponse(result) {
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }

    handleToolError(error) {
        let errorCode = ErrorCode.InternalError;
        let errorMessage = error.message;

        if (error instanceof McpError) {
            throw error;
        }

        throw new McpError(errorCode, errorMessage);
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('CData MCP server running on stdio');
    }
}

const server = new CDataMCPServer();
server.run().catch(console.error);

export { CDataMCPServer };
