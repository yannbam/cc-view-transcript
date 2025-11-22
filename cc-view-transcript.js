#!/usr/bin/env node
/**
 * cc-view-transcript.js - Production-ready Claude Code session transcript viewer
 *
 * Architecture:
 * - Stream-based processing for memory efficiency
 * - Modular design with clear separation of concerns
 * - Extensible filtering and formatting system
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');
const os = require('os');

// ================================================================================
// CONFIGURATION & CONSTANTS
// ================================================================================

const DEFAULT_OPTIONS = {
    showThinking: true,
    showToolCalls: true,
    showToolResults: true,
    showSystemMessages: false,
    showMetadata: true,
    truncateTools: false,
    maxToolLength: 500,
    // TODO: Implement different output formats (full, compact, minimal)
    // outputFormat: 'full',
};

const EMOJI = {
    thinking: '🐱💭',
    claude: '🐱💬',
    human: '👤',
    toolCall: '🔧',
    toolResult: '✅',
    toolError: '❌',
    system: '💻',
    subAgent: '🤖',
    metadata: '📋',
};

// ================================================================================
// MESSAGE PARSER
// ================================================================================

class MessageParser {
    /**
     * Parse a single JSONL line into a structured message
     */
    static parseLine(line) {
        try {
            return JSON.parse(line);
        } catch (error) {
            console.error('Failed to parse line:', error.message);
            return null;
        }
    }

    /**
     * Extract content blocks from a message
     */
    static extractContent(message) {
        const content = [];

        if (!message) return content;

        // Handle different message types
        switch (message.type) {
            case 'assistant':
                return this.extractAssistantContent(message);
            case 'user':
                return this.extractUserContent(message);
            case 'system':
                return this.extractSystemContent(message);
            case 'summary':
                return this.extractSummaryContent(message);
            default:
                return content;
        }
    }

    static extractAssistantContent(message) {
        const content = [];
        const messageContent = message.message?.content || [];

        for (const block of messageContent) {
            switch (block.type) {
                case 'thinking':
                    content.push({
                        type: 'thinking',
                        text: block.thinking,
                        emoji: EMOJI.thinking,
                    });
                    break;
                case 'text':
                    content.push({
                        type: 'text',
                        text: block.text,
                        emoji: EMOJI.claude,
                    });
                    break;
                case 'tool_use':
                    content.push({
                        type: 'tool_call',
                        name: block.name,
                        id: block.id,
                        input: block.input,
                        emoji: EMOJI.toolCall,
                        // TODO: Implement sub-agent transcript parsing
                        // Need to recursively parse tool results that contain nested transcripts
                        isSubAgent: block.name === 'Task' || block.name?.includes('agent'),
                    });
                    break;
            }
        }

        return content;
    }

    static extractUserContent(message) {
        const content = [];
        const messageContent = message.message?.content;

        if (typeof messageContent === 'string') {
            content.push({
                type: 'human',
                text: messageContent,
                emoji: EMOJI.human,
            });
        } else if (Array.isArray(messageContent)) {
            for (const block of messageContent) {
                if (block.type === 'tool_result') {
                    const isError = message.toolUseResult?.is_error ||
                                  block.is_error ||
                                  false;

                    // Extract text from tool result content
                    let resultText = '';
                    if (typeof block.content === 'string') {
                        resultText = block.content;
                    } else if (Array.isArray(block.content) && block.content[0]?.text) {
                        resultText = block.content[0].text;
                    }

                    content.push({
                        type: 'tool_result',
                        id: block.tool_use_id,
                        text: resultText,
                        isError,
                        emoji: isError ? EMOJI.toolError : EMOJI.toolResult,
                    });
                } else if (block.type === 'text') {
                    content.push({
                        type: 'human',
                        text: block.text,
                        emoji: EMOJI.human,
                    });
                }
            }
        }

        return content;
    }

    static extractSystemContent(message) {
        return [{
            type: 'system',
            text: message.content,
            level: message.level,
            emoji: EMOJI.system,
        }];
    }

    static extractSummaryContent(message) {
        return [{
            type: 'summary',
            text: message.summary,
            emoji: EMOJI.metadata,
        }];
    }
}

// ================================================================================
// MESSAGE FORMATTER
// ================================================================================

class MessageFormatter {
    constructor(options = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.separator = '—'.repeat(40);
    }

    /**
     * Format a parsed message for display
     */
    format(message) {
        const content = MessageParser.extractContent(message);
        const output = [];

        for (const block of content) {
            // Apply filters
            if (!this.shouldDisplay(block)) continue;

            const formatted = this.formatBlock(block, message);
            if (formatted) {
                output.push(formatted);
            }
        }

        return output.join('\n');
    }

    shouldDisplay(block) {
        switch (block.type) {
            case 'thinking':
                return this.options.showThinking;
            case 'tool_call':
                return this.options.showToolCalls;
            case 'tool_result':
                return this.options.showToolResults;
            case 'system':
                return this.options.showSystemMessages;
            default:
                return true;
        }
    }

    formatBlock(block, message) {
        const lines = [];

        // Add header
        const prefix = block.type === 'human' ? '' : '● ';
        lines.push('');
        lines.push(`${prefix}${block.emoji} ${this.getBlockLabel(block)}`);
        lines.push(this.separator);

        // Add content based on type
        switch (block.type) {
            case 'thinking':
            case 'text':
            case 'human':
            case 'system':
            case 'summary':
                lines.push(block.text || '');
                break;

            case 'tool_call':
                lines.push(`Tool: ${block.name}`);
                lines.push(`ID: ${block.id}`);
                if (block.isSubAgent) {
                    lines.push(`Type: SUB-AGENT`);
                }

                const inputStr = JSON.stringify(block.input, null, 2);
                if (this.options.truncateTools && inputStr.length > this.options.maxToolLength) {
                    lines.push(`Input: ${inputStr.substring(0, this.options.maxToolLength)}...`);
                    lines.push(`[Truncated - ${inputStr.length} total characters]`);
                } else {
                    lines.push(`Input: ${inputStr}`);
                }
                break;

            case 'tool_result':
                lines.push(`ID: ${block.id}`);
                if (block.isError) {
                    lines.push(`Status: ERROR`);
                }

                const resultStr = block.text || 'null';
                if (this.options.truncateTools && resultStr.length > this.options.maxToolLength) {
                    lines.push(resultStr.substring(0, this.options.maxToolLength) + '...');
                    lines.push(`[Truncated - ${resultStr.length} total characters]`);
                } else {
                    lines.push(resultStr);
                }
                break;
        }

        return lines.join('\n');
    }

    getBlockLabel(block) {
        switch (block.type) {
            case 'thinking': return 'THINKING';
            case 'text': return 'CLAUDE';
            case 'human': return 'HUMAN';
            case 'tool_call':
                return block.isSubAgent ? 'SUB-AGENT CALL' : 'TOOL_CALL';
            case 'tool_result':
                return block.isError ? 'TOOL_ERROR' : 'TOOL_RESULT';
            case 'system': return `SYSTEM (${block.level || 'info'})`;
            case 'summary': return 'SUMMARY';
            default: return block.type.toUpperCase();
        }
    }
}

// ================================================================================
// METADATA EXTRACTOR
// ================================================================================

class MetadataExtractor {
    static async extract(filePath) {
        const metadata = {
            sessionId: null,
            projectPath: null,
            timestamp: null,
            messageCount: 0,
            toolCallCount: 0,
            hasSubAgents: false,
        };

        return new Promise((resolve, reject) => {
            const stream = fs.createReadStream(filePath);
            const rl = readline.createInterface({
                input: stream,
                crlfDelay: Infinity,
            });

            let firstMessage = true;

            rl.on('line', (line) => {
                const message = MessageParser.parseLine(line);
                if (!message) return;

                // Skip file-history-snapshot and other non-message types
                if (!['user', 'assistant', 'system'].includes(message.type)) {
                    return;
                }

                metadata.messageCount++;

                // Extract from first real message
                if (firstMessage && message.sessionId) {
                    metadata.sessionId = message.sessionId;
                    metadata.timestamp = message.timestamp;
                    metadata.projectPath = message.cwd;
                    firstMessage = false;
                }

                // Count tool calls
                if (message.type === 'assistant') {
                    const content = message.message?.content || [];
                    for (const block of content) {
                        if (block.type === 'tool_use') {
                            metadata.toolCallCount++;
                            if (block.name === 'Task' || block.name?.includes('agent')) {
                                metadata.hasSubAgents = true;
                            }
                        }
                    }
                }
            });

            rl.on('close', () => resolve(metadata));
            rl.on('error', reject);
        });
    }

    static format(metadata) {
        const lines = [
            '',
            `${EMOJI.metadata} SESSION METADATA`,
            '═'.repeat(60),
            `Session ID:     ${metadata.sessionId || 'unknown'}`,
            `Project Path:   ${metadata.projectPath || 'unknown'}`,
            `Started:        ${metadata.timestamp ? new Date(metadata.timestamp).toLocaleString() : 'unknown'}`,
            `Messages:       ${metadata.messageCount}`,
            `Tool Calls:     ${metadata.toolCallCount}`,
            `Has Sub-Agents: ${metadata.hasSubAgents ? 'Yes' : 'No'}`,
            '═'.repeat(60),
            '',
        ];
        return lines.join('\n');
    }
}

// ================================================================================
// TRANSCRIPT PROCESSOR (Main Pipeline)
// ================================================================================

class TranscriptProcessor {
    constructor(options = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.formatter = new MessageFormatter(this.options);
    }

    async process(filePath) {
        // Display metadata if requested
        if (this.options.showMetadata) {
            const metadata = await MetadataExtractor.extract(filePath);
            console.log(MetadataExtractor.format(metadata));
        }

        // Process messages
        return new Promise((resolve, reject) => {
            const stream = fs.createReadStream(filePath);
            const rl = readline.createInterface({
                input: stream,
                crlfDelay: Infinity,
            });

            rl.on('line', (line) => {
                const message = MessageParser.parseLine(line);
                if (!message) return;

                const formatted = this.formatter.format(message);
                if (formatted) {
                    console.log(formatted);
                }
            });

            rl.on('close', resolve);
            rl.on('error', reject);
        });
    }
}

// ================================================================================
// CLI INTERFACE
// ================================================================================

class CLI {
    static parseArgs(argv) {
        const options = { ...DEFAULT_OPTIONS };
        const args = argv.slice(2);

        if (args.length === 0) {
            this.showHelp();
            process.exit(0);
        }

        let inputPath = null;

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];

            switch (arg) {
                case '-h':
                case '--help':
                    this.showHelp();
                    process.exit(0);
                    break;

                case '--no-thinking':
                    options.showThinking = false;
                    break;

                case '--no-tools':
                    options.showToolCalls = false;
                    options.showToolResults = false;
                    break;

                case '--no-metadata':
                    options.showMetadata = false;
                    break;

                case '--truncate':
                    options.truncateTools = true;
                    break;

                case '--max-length':
                    i++;
                    options.maxToolLength = parseInt(args[i], 10);
                    break;

                // TODO: Implement --format option
                // case '--format':
                //     i++;
                //     options.outputFormat = args[i];
                //     break;

                case '--show-system':
                    options.showSystemMessages = true;
                    break;

                default:
                    if (arg.startsWith('-')) {
                        console.error(`Unknown option: ${arg}`);
                        process.exit(1);
                    }
                    inputPath = arg;
            }
        }

        return { inputPath, options };
    }

    static showUsage() {
        console.log('Usage: cc-view-transcript <session-id-or-jsonl-file> [options]');
    }

    static showHelp() {
        const help = `
cc-view-transcript - View Claude Code session transcripts

USAGE:
    cc-view-transcript <session-id-or-jsonl-file> [options]

ARGUMENTS:
    <session-id-or-jsonl-file>    Session ID or path to .jsonl file

OPTIONS:
    -h, --help           Show this help message
    --no-thinking        Hide thinking blocks
    --no-tools           Hide tool calls and results
    --no-metadata        Hide session metadata
    --truncate           Truncate long tool inputs/outputs
    --max-length <n>     Maximum length for truncated content (default: 500)
    --show-system        Show system messages

EXAMPLES:
    cc-view-transcript abc123def
    cc-view-transcript session.jsonl --no-thinking
    cc-view-transcript session.jsonl --truncate --max-length 1000

NOTES:
    - By default, shows all content including thinking, tools, and metadata
    - Automatically finds transcript files when given a session ID
    - TODO: Sub-agent transcript parsing not yet implemented
`;
        console.log(help);
    }

    static async findTranscriptFile(sessionId) {
        // Try to find the transcript file for this session ID
        const homeDir = os.homedir();
        const projectsDir = path.join(homeDir, '.claude', 'projects');

        return new Promise((resolve) => {
            const { exec } = require('child_process');
            exec(`find "${projectsDir}" -name "${sessionId}.jsonl" 2>/dev/null | head -1`,
                (error, stdout) => {
                    const found = stdout.trim();
                    resolve(found || null);
                }
            );
        });
    }
}

// ================================================================================
// MAIN ENTRY POINT
// ================================================================================

async function main() {
    const { inputPath, options } = CLI.parseArgs(process.argv);

    let transcriptPath = inputPath;

    // Determine if input is a file or session ID
    if (!fs.existsSync(inputPath)) {
        // Try to find transcript by session ID
        console.log(`Looking for transcript with session ID: ${inputPath}`);
        transcriptPath = await CLI.findTranscriptFile(inputPath);

        if (!transcriptPath) {
            console.error(`Error: Could not find transcript for session ${inputPath}`);
            console.error('Please provide a valid session ID or path to .jsonl file');
            process.exit(1);
        }
    }

    console.log(`=== Parsing: ${transcriptPath} ===\n`);

    try {
        const processor = new TranscriptProcessor(options);
        await processor.process(transcriptPath);
    } catch (error) {
        console.error('Error processing transcript:', error.message);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

// Export for use as library
module.exports = {
    MessageParser,
    MessageFormatter,
    MetadataExtractor,
    TranscriptProcessor,
    DEFAULT_OPTIONS,
};