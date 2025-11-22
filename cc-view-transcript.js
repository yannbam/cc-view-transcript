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
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

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

const DISPLAY = {
    blockSeparator: '—'.repeat(40),
    metadataSeparator: '═'.repeat(60),
};

// ================================================================================
// MESSAGE PARSER
// ================================================================================

class MessageParser {
    /**
     * Check if a tool name indicates a sub-agent call
     * @param {string} toolName - Name of the tool being called
     * @returns {boolean} True if this is a sub-agent (Task tool or name contains 'agent')
     */
    static isSubAgent(toolName) {
        return toolName === 'Task' || toolName?.includes('agent');
    }

    /**
     * Extract text content from tool result, handling multiple blocks and different types
     * @param {string|Array} content - Tool result content (string or array of content blocks)
     * @returns {Object} Object with {text, hasMultipleBlocks, hasNonTextBlocks}
     */
    static extractToolResultText(content) {
        if (typeof content === 'string') {
            return {
                text: content,
                hasMultipleBlocks: false,
                hasNonTextBlocks: false,
            };
        }

        if (!Array.isArray(content)) {
            return {
                text: '',
                hasMultipleBlocks: false,
                hasNonTextBlocks: false,
            };
        }

        const textParts = [];
        const hasMultipleBlocks = content.length > 1;
        let hasNonTextBlocks = false;

        for (let i = 0; i < content.length; i++) {
            const contentBlock = content[i];

            if (contentBlock.type === 'text' && contentBlock.text) {
                // Add separator for multiple blocks
                if (i > 0) {
                    textParts.push('\n--- Content Block ' + (i + 1) + ' ---\n');
                }
                textParts.push(contentBlock.text);
            } else if (contentBlock.type === 'image') {
                // Indicate image blocks
                hasNonTextBlocks = true;
                textParts.push(
                    `\n[IMAGE BLOCK ${i + 1}: ${contentBlock.source?.type || 'unknown type'}]\n`
                );
            } else {
                // Other block types
                hasNonTextBlocks = true;
                textParts.push(
                    `\n[${(contentBlock.type || 'UNKNOWN').toUpperCase()} BLOCK ${i + 1}]\n`
                );
            }
        }

        return {
            text: textParts.join(''),
            hasMultipleBlocks,
            hasNonTextBlocks,
        };
    }

    /**
     * Parse a single JSONL line into a structured message
     * @param {string} line - The JSONL line to parse
     * @param {number} lineNumber - Line number for error reporting
     * @returns {Object} Parsed message or error object
     */
    static parseLine(line, lineNumber = null) {
        try {
            return JSON.parse(line);
        } catch (error) {
            // Return error object instead of null to preserve error information
            // This allows errors to be displayed in the output (Display Integrity principle)
            return {
                type: 'parse_error',
                lineNumber,
                error: error.message,
                preview: line.substring(0, 100),
                fullLine: line,
            };
        }
    }

    /**
     * Extract content blocks from a message
     * @param {Object} message - Parsed message object with type and content
     * @returns {Array<Object>} Array of content blocks with type, text, emoji, and metadata
     */
    static extractContent(message) {
        const content = [];

        // Default case handles null/undefined
        switch (message.type) {
            case 'assistant':
                return this.extractAssistantContent(message);
            case 'user':
                return this.extractUserContent(message);
            case 'system':
                return this.extractSystemContent(message);
            case 'summary':
                return this.extractSummaryContent(message);
            case 'parse_error':
                return this.extractParseErrorContent(message);
            default:
                return content;
        }
    }

    /**
     * Extract content from assistant message
     * @param {Object} message - Assistant message with thinking, text, and tool_use blocks
     * @returns {Array<Object>} Array of content blocks (thinking, text, tool_call)
     */
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
                        isSubAgent: MessageParser.isSubAgent(block.name),
                    });
                    break;
            }
        }

        return content;
    }

    /**
     * Extract content from user message
     * @param {Object} message - User message with text and/or tool_result blocks
     * @returns {Array<Object>} Array of content blocks (human text, tool_result)
     */
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
                    const isError = !!(message.toolUseResult?.is_error || block.is_error);

                    // Extract ALL content blocks from tool result (Display Completeness principle)
                    const { text, hasMultipleBlocks, hasNonTextBlocks } =
                        MessageParser.extractToolResultText(block.content);

                    content.push({
                        type: 'tool_result',
                        id: block.tool_use_id,
                        text,
                        isError,
                        hasMultipleBlocks,
                        hasNonTextBlocks,
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

    /**
     * Extract content from system message
     * @param {Object} message - System message with content and optional level
     * @returns {Array<Object>} Single-element array with system content block
     */
    static extractSystemContent(message) {
        return [{
            type: 'system',
            text: message.content,
            level: message.level,
            emoji: EMOJI.system,
        }];
    }

    /**
     * Extract content from summary message
     * @param {Object} message - Summary message
     * @returns {Array<Object>} Single-element array with summary content block
     */
    static extractSummaryContent(message) {
        return [{
            type: 'summary',
            text: message.summary,
            emoji: EMOJI.metadata,
        }];
    }

    /**
     * Extract content from parse error
     * @param {Object} message - Parse error object with lineNumber, error, and preview
     * @returns {Array<Object>} Single-element array with parse error content block
     */
    static extractParseErrorContent(message) {
        return [{
            type: 'parse_error',
            lineNumber: message.lineNumber,
            error: message.error,
            preview: message.preview,
            emoji: '⚠️',
        }];
    }
}

// ================================================================================
// MESSAGE FORMATTER
// ================================================================================

class MessageFormatter {
    constructor(options = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.separator = DISPLAY.blockSeparator;
    }

    /**
     * Format a parsed message for display
     * @param {Object} message - Parsed message object
     * @returns {string} Formatted message as string with headers, content, and separators
     */
    format(message) {
        const content = MessageParser.extractContent(message);
        const output = [];

        for (const block of content) {
            // Check if content should be displayed in full or as indicator
            if (!this.shouldDisplay(block)) {
                // Show one-line indicator for filtered content (Display Integrity principle)
                const indicator = this.formatFilteredIndicator(block);
                if (indicator) {
                    output.push(indicator);
                }
            } else {
                // Show full content
                const formatted = this.formatBlock(block, message);
                if (formatted) {
                    output.push(formatted);
                }
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

    formatFilteredIndicator(block) {
        // Return one-line indicator showing what's hidden and how to show it
        // This maintains Display Integrity principle - content is never silently removed
        const lines = [''];

        switch (block.type) {
            case 'thinking':
                lines.push(`${block.emoji} [THINKING BLOCK HIDDEN - remove --no-thinking to show]`);
                break;
            case 'tool_call':
                lines.push(`${block.emoji} [TOOL CALL HIDDEN: ${block.name} - remove --no-tools to show]`);
                break;
            case 'tool_result':
                const status = block.isError ? 'ERROR' : 'SUCCESS';
                lines.push(`${block.emoji} [TOOL RESULT HIDDEN (${status}) - remove --no-tools to show]`);
                break;
            case 'system':
                lines.push(`${block.emoji} [SYSTEM MESSAGE HIDDEN - use --show-system to show]`);
                break;
            default:
                return null;
        }

        return lines.join('\n');
    }

    tryPrettyPrintJson(text) {
        // Attempt to parse and pretty-print JSON for better readability
        // If not valid JSON, return original text
        if (!text || typeof text !== 'string') {
            return text;
        }

        // Trim whitespace to check if entire content is JSON
        const trimmed = text.trim();

        // Quick check: does it look like JSON?
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            return text;
        }

        try {
            const parsed = JSON.parse(trimmed);
            return JSON.stringify(parsed, null, 2);
        } catch (error) {
            // Not valid JSON, return original
            return text;
        }
    }

    truncateIfNeeded(text, label = 'content') {
        // Apply truncation consistently to all content types
        // Note: option is called 'truncateTools' for historical reasons,
        // but it now applies to ALL text content (thinking, messages, tools, etc.)
        // Returns array of lines to add to output
        if (!this.options.truncateTools || !text) {
            return [text || ''];
        }

        if (text.length > this.options.maxToolLength) {
            return [
                text.substring(0, this.options.maxToolLength) + '...',
                `[Truncated ${label} - ${text.length} total characters]`
            ];
        }

        return [text];
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
                // Apply truncation to thinking blocks
                lines.push(...this.truncateIfNeeded(block.text, 'thinking block'));
                break;

            case 'text':
                // Apply truncation to Claude responses
                lines.push(...this.truncateIfNeeded(block.text, 'response'));
                break;

            case 'human':
                // Apply truncation to human messages
                lines.push(...this.truncateIfNeeded(block.text, 'message'));
                break;

            case 'system':
                // Apply truncation to system messages
                lines.push(...this.truncateIfNeeded(block.text, 'system message'));
                break;

            case 'summary':
                // Don't truncate summaries (they're metadata)
                lines.push(block.text || '');
                break;

            case 'tool_call':
                lines.push(`Tool: ${block.name}`);
                lines.push(`ID: ${block.id}`);
                if (block.isSubAgent) {
                    lines.push(`Type: SUB-AGENT`);
                }

                // Apply truncation to tool inputs
                const inputStr = JSON.stringify(block.input, null, 2);
                const truncatedInput = this.truncateIfNeeded(inputStr, 'tool input');
                lines.push('Input:');
                lines.push(...truncatedInput);
                break;

            case 'tool_result':
                lines.push(`ID: ${block.id}`);
                if (block.isError) {
                    lines.push(`Status: ERROR`);
                }

                // Show indicator if result contains multiple content blocks
                if (block.hasMultipleBlocks) {
                    lines.push(`Content: Multiple blocks (separated below)`);
                }
                if (block.hasNonTextBlocks) {
                    lines.push(`Note: Contains non-text content (images, etc.)`);
                }

                // Try to pretty-print JSON for better readability
                let resultStr = block.text || 'null';
                resultStr = this.tryPrettyPrintJson(resultStr);

                // Apply truncation to tool results
                lines.push(...this.truncateIfNeeded(resultStr, 'tool result'));
                break;

            case 'parse_error':
                const lineInfo = block.lineNumber ? `Line ${block.lineNumber}` : 'Unknown line';
                lines.push(`${lineInfo}: Failed to parse JSONL`);
                lines.push(`Error: ${block.error}`);
                lines.push(`Preview: ${block.preview}...`);
                lines.push('');
                lines.push('⚠️  This line contains corrupt data and cannot be displayed.');
                lines.push('    The transcript may be incomplete.');
                break;
        }

        return lines.join('\n');
    }

    getBlockLabel(block) {
        // Simple label mappings
        const simpleLabels = {
            thinking: 'THINKING',
            text: 'CLAUDE',
            human: 'HUMAN',
            summary: 'SUMMARY',
            parse_error: 'PARSE ERROR',
        };

        // Check for simple cases first
        if (simpleLabels[block.type]) {
            return simpleLabels[block.type];
        }

        // Handle complex cases with conditional logic
        switch (block.type) {
            case 'tool_call':
                return block.isSubAgent ? 'SUB-AGENT CALL' : 'TOOL_CALL';
            case 'tool_result':
                return block.isError ? 'TOOL_ERROR' : 'TOOL_RESULT';
            case 'system':
                return `SYSTEM (${block.level || 'info'})`;
            default:
                return block.type.toUpperCase();
        }
    }
}

// ================================================================================
// METADATA EXTRACTOR
// ================================================================================

class MetadataExtractor {
    /**
     * Extract metadata from transcript file
     * @param {string} filePath - Path to JSONL transcript file
     * @returns {Promise<Object>} Metadata object with sessionId, projectPath, timestamp, counts
     * @throws {Error} If file cannot be read or stream errors occur
     */
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

            // Cleanup function to close all resources
            const cleanup = () => {
                rl.close();
                stream.destroy();
            };

            let metadataExtracted = false;
            let lineNumber = 0;

            rl.on('line', (line) => {
                lineNumber++;
                const message = MessageParser.parseLine(line, lineNumber);

                // Only process user, assistant, and system messages
                // (skips parse errors, file-history-snapshot, summary, etc.)
                if (!['user', 'assistant', 'system'].includes(message.type)) {
                    return;
                }

                metadata.messageCount++;

                // Extract from first real message
                if (!metadataExtracted && message.sessionId) {
                    metadata.sessionId = message.sessionId;
                    metadata.timestamp = message.timestamp;
                    metadata.projectPath = message.cwd;
                    metadataExtracted = true;
                }

                // Count tool calls
                if (message.type === 'assistant') {
                    const content = message.message?.content || [];
                    for (const block of content) {
                        if (block.type === 'tool_use') {
                            metadata.toolCallCount++;
                            if (MessageParser.isSubAgent(block.name)) {
                                metadata.hasSubAgents = true;
                            }
                        }
                    }
                }
            });

            rl.on('close', () => {
                cleanup();
                resolve(metadata);
            });

            rl.on('error', (error) => {
                cleanup();
                reject(error);
            });

            // Also handle stream errors
            stream.on('error', (error) => {
                cleanup();
                reject(error);
            });
        });
    }

    /**
     * Format metadata as human-readable string
     * @param {Object} metadata - Metadata object from extract()
     * @returns {string} Formatted metadata display with session info and counts
     */
    static format(metadata) {
        const lines = [
            '',
            `${EMOJI.metadata} SESSION METADATA`,
            DISPLAY.metadataSeparator,
            `Session ID:     ${metadata.sessionId || 'unknown'}`,
            `Project Path:   ${metadata.projectPath || 'unknown'}`,
            `Started:        ${metadata.timestamp ? new Date(metadata.timestamp).toLocaleString() : 'unknown'}`,
            `Messages:       ${metadata.messageCount}`,
            `Tool Calls:     ${metadata.toolCallCount}`,
            `Has Sub-Agents: ${metadata.hasSubAgents ? 'Yes' : 'No'}`,
            DISPLAY.metadataSeparator,
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

    /**
     * Process transcript file and output formatted messages
     * @param {string} filePath - Path to JSONL transcript file
     * @returns {Promise<void>} Resolves when processing is complete
     * @throws {Error} If file cannot be read, parse errors occur, or stream fails
     */
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

            // Cleanup function to close all resources
            const cleanup = () => {
                rl.close();
                stream.destroy();
            };

            // Track line number for error reporting
            let lineNumber = 0;

            rl.on('line', (line) => {
                lineNumber++;
                const message = MessageParser.parseLine(line, lineNumber);

                // Always format the message (including parse errors)
                const formatted = this.formatter.format(message);
                if (formatted) {
                    console.log(formatted);
                }
            });

            rl.on('close', () => {
                cleanup();
                resolve();
            });

            rl.on('error', (error) => {
                cleanup();
                reject(error);
            });

            // Also handle stream errors
            stream.on('error', (error) => {
                cleanup();
                reject(error);
            });
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

            // Handle help flags
            if (['-h', '--help'].includes(arg)) {
                this.showHelp();
                process.exit(0);
            }

            switch (arg) {

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
                    const maxLength = parseInt(args[i], 10);
                    if (isNaN(maxLength) || maxLength <= 0) {
                        console.error(`Error: --max-length must be a positive number`);
                        console.error(`Got: "${args[i]}"`);
                        console.error(`Example: --max-length 1000`);
                        process.exit(1);
                    }
                    options.maxToolLength = maxLength;
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
        // Validate session ID to prevent command injection
        // Only allow alphanumeric characters, hyphens, and underscores
        const validSessionIdPattern = /^[a-zA-Z0-9_-]+$/;
        if (!validSessionIdPattern.test(sessionId)) {
            throw new Error(
                `Invalid session ID format: "${sessionId}"\n` +
                `Session IDs must contain only letters, numbers, hyphens, and underscores.`
            );
        }

        // Check if projects directory exists before searching
        const homeDir = os.homedir();
        const projectsDir = path.join(homeDir, '.claude', 'projects');

        if (!fs.existsSync(projectsDir)) {
            throw new Error(
                `Claude Code projects directory not found: ${projectsDir}\n` +
                `Please ensure Claude Code is installed and has been run at least once.`
            );
        }

        // Search for the transcript file using promisified exec
        try {
            const { stdout, stderr } = await execAsync(
                `find "${projectsDir}" -name "${sessionId}.jsonl" 2>&1 | head -1`,
                { timeout: 30000 }  // 30 second timeout
            );

            // Check if stderr contains permission errors
            if (stderr && stderr.includes('Permission denied')) {
                throw new Error(
                    `Permission denied while searching for transcripts.\n` +
                    `Check file permissions on: ${projectsDir}`
                );
            }

            // Return found path or null if not found
            return stdout.trim() || null;
        } catch (error) {
            // Distinguish timeout from other errors
            if (error.killed) {
                throw new Error(
                    `Transcript search timed out after 30 seconds.\n` +
                    `The projects directory may be too large: ${projectsDir}`
                );
            }

            // Other execution errors
            throw new Error(
                `Failed to search for transcript file.\n` +
                `Error: ${error.message}\n` +
                `Directory: ${projectsDir}`
            );
        }
    }
}

// ================================================================================
// MAIN ENTRY POINT
// ================================================================================

async function main() {
    const { inputPath, options } = CLI.parseArgs(process.argv);

    let transcriptPath = inputPath;

    try {
        // Determine if input looks like a file path or session ID
        // Heuristic: if it contains path separators or file extension, treat as file path
        const looksLikeFilePath = inputPath.includes('/') ||
                                   inputPath.includes('\\') ||
                                   inputPath.endsWith('.jsonl');

        if (looksLikeFilePath) {
            // Treat as file path - validate it exists first
            // Using async access() reduces (but doesn't eliminate) race window vs existsSync()
            try {
                await fs.promises.access(transcriptPath, fs.constants.R_OK);
            } catch (accessError) {
                if (accessError.code === 'ENOENT') {
                    throw Object.assign(new Error(`File not found: ${transcriptPath}`), { code: 'ENOENT' });
                } else if (accessError.code === 'EACCES') {
                    throw Object.assign(new Error(`Permission denied: ${transcriptPath}`), { code: 'EACCES' });
                }
                throw accessError;
            }

            console.log(`=== Parsing: ${transcriptPath} ===\n`);
            const processor = new TranscriptProcessor(options);
            await processor.process(transcriptPath);
        } else {
            // Treat as session ID - look up the file
            console.log(`Looking for transcript with session ID: ${inputPath}`);
            transcriptPath = await CLI.findTranscriptFile(inputPath);

            if (!transcriptPath) {
                console.error(`Error: Could not find transcript for session ${inputPath}`);
                console.error('Please provide a valid session ID or path to .jsonl file');
                process.exit(1);
            }

            console.log(`=== Parsing: ${transcriptPath} ===\n`);
            const processor = new TranscriptProcessor(options);
            await processor.process(transcriptPath);
        }
    } catch (error) {
        // Distinguish different error types for better user experience
        if (error.code === 'ENOENT') {
            console.error(`Error: File not found: ${transcriptPath}`);
            console.error('Please check the path and try again.');
            process.exit(1);
        } else if (error.code === 'EACCES') {
            console.error(`Error: Permission denied: ${transcriptPath}`);
            console.error('Please check file permissions and try again.');
            process.exit(1);
        } else if (error.message && error.message.includes('parse')) {
            console.error(`Error: Failed to parse transcript file`);
            console.error(error.message);
            console.error('\nThe transcript file may be corrupt.');
            process.exit(1);
        } else {
            // Generic error with full message
            console.error('Error processing transcript:');
            console.error(error.message);
            if (process.env.DEBUG) {
                console.error('\nStack trace:');
                console.error(error.stack);
            }
            process.exit(1);
        }
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