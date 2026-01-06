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
    showSystemMessages: true,
    showMetadata: true,
    showTimestamps: true,
    truncateTools: false,
    maxToolLength: 500,
    includeAgents: true,
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
    separatorWidth: 50,
    blockSeparator: '—'.repeat(50),
    metadataSeparator: '═'.repeat(60),
};

// Resolution result types for SessionResolver
const RESOLVE_TYPE = {
    FILE: 'file',           // Direct file path
    MATCH: 'match',         // Single session match
    CANDIDATES: 'candidates', // Multiple matches found
    NOT_FOUND: 'not_found', // No matches
    ERROR: 'error',         // Resolution error
};

// ================================================================================
// TIME FORMATTING UTILITIES
// ================================================================================

/**
 * Format a date/timestamp as local ISO8601 with timezone offset
 * Example: 2025-12-29T10:30:45 +01:00
 * @param {Date|string|number} input - Date object, ISO string, or timestamp
 * @returns {string} Local ISO8601 formatted string with offset
 */
function formatLocalIso(input) {
    const d = new Date(input);

    // Handle invalid dates
    if (isNaN(d.getTime())) {
        return String(input);
    }

    // Calculate timezone offset
    const offsetMinutes = -d.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
    const offsetMins = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');

    // Build local date components
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const sec = String(d.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}T${hour}:${min}:${sec} ${sign}${offsetHours}:${offsetMins}`;
}

/**
 * Format a date/timestamp as short local datetime with offset (for listings)
 * Example: 2025-12-29 10:30 +01:00
 * @param {Date|string|number} input - Date object, ISO string, or timestamp
 * @returns {string} Short local datetime with offset
 */
function formatLocalShort(input) {
    const d = new Date(input);

    // Handle invalid dates
    if (isNaN(d.getTime())) {
        return String(input);
    }

    // Calculate timezone offset
    const offsetMinutes = -d.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
    const offsetMins = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');

    // Build local date components (without seconds for brevity)
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hour}:${min} ${sign}${offsetHours}:${offsetMins}`;
}

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
        // Track tool calls to match them with results
        // Maps tool_use_id -> tool_name
        this.toolCallMap = new Map();
    }

    /**
     * Format a parsed message for display
     * @param {Object} message - Parsed message object
     * @param {number|null} lineNumber - Line number in JSONL file (for L-prefix display)
     * @returns {string} Formatted message as string with headers, content, and separators
     */
    format(message, lineNumber = null) {
        // Track tool calls from assistant messages before formatting
        if (message.type === 'assistant') {
            const messageContent = message.message?.content || [];
            for (const block of messageContent) {
                if (block.type === 'tool_use') {
                    // Store mapping: tool_use_id -> tool_name
                    this.toolCallMap.set(block.id, block.name);
                }
            }
        }

        const content = MessageParser.extractContent(message);
        const output = [];

        for (const block of content) {
            // Check if content should be displayed in full or as indicator
            if (!this.shouldDisplay(block)) {
                // Show one-line indicator for filtered content (Display Integrity principle)
                const indicator = this.formatFilteredIndicator(block, message, lineNumber);
                if (indicator) {
                    output.push(indicator);
                }
            } else {
                // Show full content
                const formatted = this.formatBlock(block, message, lineNumber);
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

    formatFilteredIndicator(block, message, lineNumber = null) {
        // Return one-line indicator showing what's hidden
        // This maintains Display Integrity principle - content is never silently removed

        // Build the indicator text
        let indicatorText;
        switch (block.type) {
            case 'thinking':
                indicatorText = `● ${block.emoji} [THINKING BLOCK HIDDEN]`;
                break;
            case 'tool_call':
                indicatorText = `● ${block.emoji} [TOOL CALL HIDDEN: ${block.name}]`;
                break;
            case 'tool_result':
                const status = block.isError ? 'ERROR' : 'SUCCESS';
                // Look up tool name from the tool call map
                const toolName = this.toolCallMap.get(block.id) || 'Unknown';
                indicatorText = `● ${block.emoji} [TOOL RESULT HIDDEN (${status}): ${toolName}]`;
                break;
            case 'system':
                // System messages are fully suppressed when hidden (no indicator)
                return null;
            default:
                return null;
        }

        // Build suffix parts (timestamp and line number)
        const suffixParts = [];
        if (this.options.showTimestamps && message.timestamp) {
            const localTimestamp = formatLocalIso(message.timestamp);
            suffixParts.push(`[${localTimestamp}]`);
        }
        if (lineNumber !== null) {
            suffixParts.push(`L${lineNumber}`);
        }

        // Add right-aligned suffix if we have any parts
        if (suffixParts.length > 0) {
            const suffix = suffixParts.join(' ');
            const minPadding = 2;
            const minWidth = indicatorText.length + minPadding + suffix.length;
            const width = Math.max(DISPLAY.separatorWidth, minWidth);
            const padding = width - indicatorText.length - suffix.length;
            indicatorText = `${indicatorText}${' '.repeat(padding)}${suffix}`;
        }

        return '\n' + indicatorText;
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

    formatBlock(block, message, lineNumber = null) {
        const lines = [];

        // Build the label part of the header
        const prefix = block.type === 'human' ? '' : '● ';
        const label = `${prefix}${block.emoji} ${this.getBlockLabel(block)}:`;

        // Build suffix parts (timestamp and line number)
        const suffixParts = [];
        if (this.options.showTimestamps && message.timestamp) {
            const localTimestamp = formatLocalIso(message.timestamp);
            suffixParts.push(`[${localTimestamp}]`);
        }
        if (lineNumber !== null) {
            suffixParts.push(`L${lineNumber}`);
        }

        // Build header line with optional right-aligned suffix
        let headerLine = label;
        let separatorWidth = DISPLAY.separatorWidth;

        if (suffixParts.length > 0) {
            const suffix = suffixParts.join(' ');
            const minPadding = 2;
            const neededWidth = label.length + minPadding + suffix.length;

            // Extend separator if content would overflow
            if (neededWidth > separatorWidth) {
                separatorWidth = neededWidth;
            }

            // Calculate padding to right-align suffix
            const padding = separatorWidth - label.length - suffix.length;
            headerLine = `${label}${' '.repeat(padding)}${suffix}`;
        }

        // Generate separator (may be extended for long content)
        const separator = '—'.repeat(separatorWidth);

        // Add header with blank lines above and below for breathing room
        lines.push('');
        lines.push(separator);
        lines.push(headerLine);
        lines.push('');

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
                // Look up tool name from the tool call map
                const resultToolName = this.toolCallMap.get(block.id) || 'Unknown';
                lines.push(`Tool: ${resultToolName}`);
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
        const startedTime = metadata.timestamp
            ? formatLocalIso(metadata.timestamp)
            : 'unknown';

        const lines = [
            '',
            `${EMOJI.metadata} SESSION METADATA`,
            DISPLAY.metadataSeparator,
            `Session ID:     ${metadata.sessionId || 'unknown'}`,
            `Project Path:   ${metadata.projectPath || 'unknown'}`,
            `Started:        ${startedTime}`,
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
// SESSION RESOLVER
// ================================================================================

/**
 * Resolves session identifiers to transcript file paths.
 * Handles: file paths, full UUIDs, prefix matches, directory lookups.
 */
class SessionResolver {
    /**
     * Create a SessionResolver instance
     * @param {Object} options - Resolution options
     * @param {boolean} options.includeAgents - Include agent sessions in results (default: true)
     * @param {boolean} options.latest - Auto-pick most recent on multiple matches
     */
    constructor(options = {}) {
        this.includeAgents = options.includeAgents !== false;
        this.latest = options.latest || false;
        this.projectsDir = path.join(os.homedir(), '.claude', 'projects');
    }

    /**
     * Check if a path exists as a file
     * @param {string} filePath - Path to check
     * @returns {Promise<boolean>} True if file exists
     * @throws {Error} For permission errors, filesystem errors, etc.
     */
    async fileExists(filePath) {
        try {
            const stats = await fs.promises.stat(filePath);
            return stats.isFile();
        } catch (error) {
            // ENOENT = genuinely doesn't exist - return false
            if (error.code === 'ENOENT') {
                return false;
            }
            // Other errors (EACCES, EMFILE, EIO, etc.) should propagate
            throw error;
        }
    }

    /**
     * Check if a path exists as a directory
     * @param {string} dirPath - Path to check
     * @returns {Promise<boolean>} True if directory exists
     * @throws {Error} For permission errors, filesystem errors, etc.
     */
    async isDirectory(dirPath) {
        try {
            const stats = await fs.promises.stat(dirPath);
            return stats.isDirectory();
        } catch (error) {
            // ENOENT = genuinely doesn't exist - return false
            if (error.code === 'ENOENT') {
                return false;
            }
            // Other errors (EACCES, EMFILE, EIO, etc.) should propagate
            throw error;
        }
    }

    /**
     * Encode a directory path to project folder name
     * Follows Claude Code's encoding: all non-alphanumeric chars become '-'
     * @param {string} dirPath - Absolute directory path
     * @returns {string} Encoded project folder name
     */
    static encodeProjectPath(dirPath) {
        // Replace all non-alphanumeric characters with hyphens
        return dirPath.replace(/[^a-zA-Z0-9]/g, '-');
    }

    /**
     * Format file size for human-readable display
     * @param {number} bytes - File size in bytes
     * @returns {string} Formatted size (e.g., "1.2 MB")
     */
    static formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    /**
     * Format datetime for display (local time with timezone offset)
     * @param {Date} date - Date to format
     * @returns {string} Formatted local date with offset (YYYY-MM-DD HH:MM +HH:MM)
     */
    static formatDateTime(date) {
        return formatLocalShort(date);
    }

    /**
     * Read the mother session ID from an agent file
     * @param {string} agentFilePath - Path to agent .jsonl file
     * @returns {Promise<string|null>} Mother session ID or null (with warning on error)
     */
    async getAgentParentId(agentFilePath) {
        let stream;
        let rl;
        let result = null;

        try {
            stream = fs.createReadStream(agentFilePath, { encoding: 'utf8' });
            rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

            for await (const line of rl) {
                try {
                    const data = JSON.parse(line);
                    if (data.sessionId) {
                        result = data.sessionId;
                        break; // Found it - exit loop, cleanup in finally
                    }
                } catch {
                    // Skip lines that aren't valid JSON - continue scanning
                }
            }
        } catch (error) {
            // Log warning but don't fail - we're in a scan loop
            const filename = path.basename(agentFilePath);
            console.error(`Warning: Could not read agent parent ID from ${filename}: ${error.message}`);
        } finally {
            // Ensure streams are always cleaned up
            if (rl) rl.close();
            if (stream) stream.destroy();
        }

        return result;
    }

    /**
     * Scan a project directory for session files
     * @param {string} projectDirPath - Full path to project directory
     * @param {string} projectDirName - Encoded project folder name
     * @returns {Promise<Array>} Array of session info objects
     */
    async scanProjectDir(projectDirPath, projectDirName) {
        const sessions = [];

        try {
            const files = await fs.promises.readdir(projectDirPath);

            for (const filename of files) {
                if (!filename.endsWith('.jsonl')) continue;

                const isAgent = filename.startsWith('agent-');

                // Skip agent files unless includeAgents is set
                if (isAgent && !this.includeAgents) continue;

                const filePath = path.join(projectDirPath, filename);

                try {
                    const stats = await fs.promises.stat(filePath);

                    const sessionInfo = {
                        path: filePath,
                        sessionId: filename.replace('.jsonl', ''),
                        projectDir: projectDirName,
                        modified: stats.mtime,
                        size: stats.size,
                        isAgent: isAgent,
                        parentSessionId: null,
                    };

                    // Get parent session ID for agent files
                    if (isAgent) {
                        sessionInfo.parentSessionId = await this.getAgentParentId(filePath);
                    }

                    sessions.push(sessionInfo);
                } catch (error) {
                    // ENOENT = file deleted between readdir and stat (race condition, expected)
                    if (error.code !== 'ENOENT') {
                        console.error(`Warning: Cannot read session ${filename}: ${error.message}`);
                    }
                }
            }
        } catch (error) {
            // ENOENT = directory doesn't exist (expected for non-existent project paths)
            if (error.code !== 'ENOENT') {
                console.error(`Warning: Cannot scan ${projectDirPath}: ${error.message}`);
            }
        }

        return sessions;
    }

    /**
     * Scan all project directories for session files
     * @returns {Promise<Array>} Array of session info objects
     */
    async scanSessions() {
        const sessions = [];

        try {
            const projectDirs = await fs.promises.readdir(this.projectsDir, { withFileTypes: true });

            for (const projDir of projectDirs) {
                if (!projDir.isDirectory()) continue;

                const projPath = path.join(this.projectsDir, projDir.name);
                const projectSessions = await this.scanProjectDir(projPath, projDir.name);
                sessions.push(...projectSessions);
            }
        } catch (error) {
            // Projects directory not accessible
            throw new Error(`Cannot access projects directory: ${this.projectsDir}`);
        }

        // Sort by modification date (newest first)
        sessions.sort((a, b) => b.modified - a.modified);

        return sessions;
    }

    /**
     * Find sessions matching a prefix
     * @param {string} prefix - Session ID prefix to match
     * @returns {Promise<Array>} Matching sessions
     */
    async findByPrefix(prefix) {
        // If searching for agent- prefix, temporarily include agents in scan
        const searchingForAgent = prefix.toLowerCase().startsWith('agent-');
        const originalIncludeAgents = this.includeAgents;
        if (searchingForAgent) {
            this.includeAgents = true;
        }

        try {
            const sessions = await this.scanSessions();
            const normalizedPrefix = prefix.toLowerCase();

            return sessions.filter(s =>
                s.sessionId.toLowerCase().startsWith(normalizedPrefix)
            );
        } finally {
            // Restore original setting
            this.includeAgents = originalIncludeAgents;
        }
    }

    /**
     * Find sessions for a project directory
     * @param {string} dirPath - Absolute directory path
     * @returns {Promise<Array>} Sessions in that project
     */
    async findByDirectory(dirPath) {
        // Encode the path to find the project folder
        const encodedName = SessionResolver.encodeProjectPath(dirPath);
        const projPath = path.join(this.projectsDir, encodedName);

        // Check if project directory exists
        if (!await this.isDirectory(projPath)) {
            return [];
        }

        const sessions = await this.scanProjectDir(projPath, encodedName);

        // Sort by modification date (newest first)
        sessions.sort((a, b) => b.modified - a.modified);

        return sessions;
    }

    /**
     * Handle candidates result - apply --latest or return candidates
     * @param {Array} sessions - Matching sessions
     * @param {string} input - Original input for error messages
     * @returns {Object} Resolution result
     */
    handleCandidates(sessions, input) {
        if (sessions.length === 0) {
            return { type: RESOLVE_TYPE.NOT_FOUND, input };
        }

        if (sessions.length === 1 || this.latest) {
            // Sessions are sorted by modified (newest first)
            return {
                type: RESOLVE_TYPE.MATCH,
                path: sessions[0].path,
                session: sessions[0],
            };
        }

        return { type: RESOLVE_TYPE.CANDIDATES, candidates: sessions };
    }

    /**
     * Resolve a session reference to a file path
     * @param {string} input - Session ID, file path, or directory path
     * @returns {Promise<Object>} Resolution result
     */
    async resolve(input) {
        try {
            // 1. Direct .jsonl file path?
            if (input.endsWith('.jsonl')) {
                const resolved = path.resolve(input);
                if (await this.fileExists(resolved)) {
                    return { type: RESOLVE_TYPE.FILE, path: resolved };
                }
                return { type: RESOLVE_TYPE.NOT_FOUND, input };
            }

            // 2. Path with slashes - could be file or directory
            if (input.includes('/') || input.includes('\\')) {
                const resolved = path.resolve(input);

                // Check if it's a file
                if (await this.fileExists(resolved)) {
                    return { type: RESOLVE_TYPE.FILE, path: resolved };
                }

                // Check if it's a directory
                if (await this.isDirectory(resolved)) {
                    const sessions = await this.findByDirectory(resolved);
                    return this.handleCandidates(sessions, input);
                }

                return { type: RESOLVE_TYPE.NOT_FOUND, input };
            }

            // 3. Could be '.' or '..' - check as directory first
            const resolvedDir = path.resolve(input);
            if (await this.isDirectory(resolvedDir)) {
                const sessions = await this.findByDirectory(resolvedDir);
                return this.handleCandidates(sessions, input);
            }

            // 4. Treat as session ID prefix
            const sessions = await this.findByPrefix(input);
            return this.handleCandidates(sessions, input);

        } catch (error) {
            return { type: RESOLVE_TYPE.ERROR, input, error: error.message };
        }
    }

    /**
     * Format candidate list for display
     * Note: Input is sorted newest-first internally; we reverse for display (oldest first, newest at bottom)
     * @param {Array} candidates - Array of session info objects
     * @returns {string} Formatted table
     */
    static formatCandidates(candidates) {
        const lines = [];

        // Separate regular sessions and agents
        // Reverse order so newest appears at bottom (more natural for terminal scrollback)
        const regularSessions = candidates.filter(c => !c.isAgent).reverse();
        const agentSessions = candidates.filter(c => c.isAgent);

        // Build agent lookup by parent session ID
        const agentsByParent = new Map();
        for (const agent of agentSessions) {
            if (agent.parentSessionId) {
                if (!agentsByParent.has(agent.parentSessionId)) {
                    agentsByParent.set(agent.parentSessionId, []);
                }
                agentsByParent.get(agent.parentSessionId).push(agent);
            }
        }

        // Header (MODIFIED column wider for timezone offset)
        lines.push('  SESSION ID                              PROJECT                                MODIFIED                    SIZE');
        lines.push('  ' + '─'.repeat(110));

        // Format each regular session with its agents
        for (const session of regularSessions) {
            const sessionId = session.sessionId.padEnd(36);
            const projectDir = session.projectDir.substring(0, 38).padEnd(38);
            const modified = SessionResolver.formatDateTime(session.modified).padEnd(25);
            const size = SessionResolver.formatSize(session.size).padStart(10);

            lines.push(`  ${sessionId}  ${projectDir}  ${modified}  ${size}`);

            // Add child agents indented below
            const childAgents = agentsByParent.get(session.sessionId) || [];
            for (const agent of childAgents) {
                const agentId = ('  └─ ' + agent.sessionId).padEnd(38);
                const agentModified = SessionResolver.formatDateTime(agent.modified).padEnd(25);
                const agentSize = SessionResolver.formatSize(agent.size).padStart(10);
                lines.push(`  ${agentId}  ${''.padEnd(38)}  ${agentModified}  ${agentSize}`);
            }
        }

        // Add orphan agents (agents without a parent in the list)
        const orphanAgents = agentSessions.filter(a =>
            !regularSessions.some(s => s.sessionId === a.parentSessionId)
        );
        for (const agent of orphanAgents) {
            const agentId = agent.sessionId.padEnd(36);
            const projectDir = agent.projectDir.substring(0, 38).padEnd(38);
            const modified = SessionResolver.formatDateTime(agent.modified).padEnd(25);
            const size = SessionResolver.formatSize(agent.size).padStart(10);
            lines.push(`  ${agentId}  ${projectDir}  ${modified}  ${size}  (agent)`);
        }

        lines.push('');
        const count = regularSessions.length + orphanAgents.length;
        lines.push(`Found ${count} matching sessions. Use --latest to auto-pick most recent.`);

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
                // Pass lineNumber for L-prefix display in headers
                const formatted = this.formatter.format(message, lineNumber);
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
// API EXPORTER
// ================================================================================

/**
 * Exports transcript as Anthropic API-compatible messages array.
 * Reconstructs streaming chunks into complete messages.
 */
class ApiExporter {
    /**
     * Extract API messages from transcript file
     * @param {string} filePath - Path to JSONL transcript file
     * @returns {Promise<Object>} Object with messages array and metadata
     */
    async extract(filePath) {
        return new Promise((resolve, reject) => {
            const stream = fs.createReadStream(filePath);
            const rl = readline.createInterface({
                input: stream,
                crlfDelay: Infinity,
            });

            // Cleanup function
            const cleanup = () => {
                rl.close();
                stream.destroy();
            };

            const messages = [];
            let pendingAssistant = null;  // {requestId, content: [...]}
            let hasSummaries = false;
            let sessionId = null;

            rl.on('line', (line) => {
                // Parse JSONL line
                let parsed;
                try {
                    parsed = JSON.parse(line);
                } catch (e) {
                    return;  // Skip invalid lines
                }

                // Capture session ID from first message
                if (!sessionId && parsed.sessionId) {
                    sessionId = parsed.sessionId;
                }

                // Skip non-API message types
                if (parsed.type === 'summary') {
                    hasSummaries = true;
                    return;
                }
                if (parsed.type === 'system') return;  // Hooks, not API messages
                if (parsed.isSidechain) return;  // Agent sessions

                // Handle user messages
                if (parsed.type === 'user') {
                    // Flush pending assistant if any
                    if (pendingAssistant) {
                        messages.push({ role: 'assistant', content: pendingAssistant.content });
                        pendingAssistant = null;
                    }

                    const content = parsed.message.content;
                    const lastMsg = messages[messages.length - 1];

                    // Convert content to array format for merging
                    const contentAsArray = Array.isArray(content)
                        ? content
                        : [{ type: 'text', text: content }];

                    // Merge consecutive user messages into one
                    if (lastMsg?.role === 'user') {
                        // Ensure lastMsg.content is an array
                        if (!Array.isArray(lastMsg.content)) {
                            lastMsg.content = [{ type: 'text', text: lastMsg.content }];
                        }
                        // Append new content blocks
                        lastMsg.content.push(...contentAsArray);
                    } else {
                        // New user message
                        messages.push(parsed.message);
                    }
                }

                // Handle assistant messages (accumulate by requestId)
                if (parsed.type === 'assistant' && parsed.message?.content) {
                    const requestId = parsed.requestId;

                    if (pendingAssistant && pendingAssistant.requestId === requestId) {
                        // Same response, merge content blocks
                        pendingAssistant.content.push(...parsed.message.content);
                    } else {
                        // New response - flush pending and start new
                        if (pendingAssistant) {
                            messages.push({ role: 'assistant', content: pendingAssistant.content });
                        }
                        pendingAssistant = {
                            requestId,
                            content: [...parsed.message.content]
                        };
                    }
                }
            });

            rl.on('close', () => {
                // Flush final pending assistant message
                if (pendingAssistant) {
                    messages.push({ role: 'assistant', content: pendingAssistant.content });
                }

                cleanup();
                resolve({
                    messages,
                    metadata: {
                        sessionId,
                        messageCount: messages.length,
                        hasSummaries,
                    }
                });
            });

            rl.on('error', (error) => {
                cleanup();
                reject(error);
            });

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

        // Collect multiple input arguments
        const inputs = [];

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
                    // Check if next arg exists and isn't a flag
                    if (i >= args.length || args[i].startsWith('-')) {
                        console.error(`Error: --max-length requires a numeric value`);
                        console.error(`Example: --max-length 1000`);
                        process.exit(1);
                    }
                    const maxLength = parseInt(args[i], 10);
                    if (isNaN(maxLength) || maxLength <= 0) {
                        console.error(`Error: --max-length must be a positive number`);
                        console.error(`Got: "${args[i]}"`);
                        console.error(`Example: --max-length 1000`);
                        process.exit(1);
                    }
                    options.maxToolLength = maxLength;
                    break;

                case '--no-system':
                    options.showSystemMessages = false;
                    break;

                case '--no-timestamps':
                    options.showTimestamps = false;
                    break;

                case '--api-json':
                    options.apiJson = true;
                    break;

                case '--exclude-agents':
                    options.includeAgents = false;
                    break;

                case '--latest':
                    options.latest = true;
                    break;

                default:
                    if (arg.startsWith('-')) {
                        console.error(`Unknown option: ${arg}`);
                        process.exit(1);
                    }
                    // Collect all non-flag arguments as inputs
                    inputs.push(arg);
            }
        }

        return { inputs, options };
    }

    static showUsage() {
        console.log('Usage: cc-view-transcript <session-refs...> [options]');
    }

    static showHelp() {
        const help = `
cc-view-transcript - View Claude Code session transcripts

USAGE:
    cc-view-transcript <session-refs...> [options]

ARGUMENTS:
    <session-refs...>    One or more session references:
                         - Session ID or prefix (abc123, 4eea8d85-...)
                         - Path to .jsonl file
                         - Project directory (uses sessions for that project)

OPTIONS:
    -h, --help           Show this help message
    --no-thinking        Hide thinking blocks
    --no-tools           Hide tool calls and results
    --no-metadata        Hide session metadata
    --truncate           Truncate long tool inputs/outputs
    --max-length <n>     Maximum length for truncated content (default: 500)
    --no-system          Hide system messages (fully suppressed)
    --no-timestamps      Hide timestamps from message headers
    --exclude-agents     Exclude agent sessions from listings
    --latest             Auto-select most recent session for ambiguous matches
    --api-json           Output as Anthropic API messages JSON (for API continuation)

EXAMPLES:
    cc-view-transcript abc123              # Shortened UUID (prefix match)
    cc-view-transcript ./session.jsonl     # Direct file path
    cc-view-transcript .                   # Sessions for current directory
    cc-view-transcript /path/to/project    # Sessions for specific project
    cc-view-transcript abc def ghi         # Multiple sessions
    cc-view-transcript . --latest          # Most recent session in current dir
    cc-view-transcript abc --exclude-agents # Hide agent sessions

NOTES:
    - By default, shows all content including thinking, tools, system messages, and metadata
    - Prefix matching finds sessions starting with the given ID
    - Multiple matches show a candidate list (use --latest to auto-pick)
    - Agent sessions are included by default (use --exclude-agents to hide)
`;
        console.log(help);
    }

}

// ================================================================================
// MAIN ENTRY POINT
// ================================================================================

async function main() {
    const { inputs, options } = CLI.parseArgs(process.argv);

    // Handle no inputs
    if (inputs.length === 0) {
        CLI.showHelp();
        process.exit(0);
    }

    // Create resolver with options
    const resolver = new SessionResolver(options);
    const toProcess = [];
    let hasErrors = false;

    // Resolve all inputs first (don't fail fast)
    for (const input of inputs) {
        const result = await resolver.resolve(input);

        switch (result.type) {
            case RESOLVE_TYPE.FILE:
            case RESOLVE_TYPE.MATCH:
                toProcess.push(result.path);
                break;

            case RESOLVE_TYPE.CANDIDATES:
                console.error(`\nMultiple sessions match "${input}":\n`);
                console.error(SessionResolver.formatCandidates(result.candidates));
                hasErrors = true;
                break;

            case RESOLVE_TYPE.NOT_FOUND:
                console.error(`No session found: ${input}`);
                hasErrors = true;
                break;

            case RESOLVE_TYPE.ERROR:
                console.error(`Error resolving "${input}": ${result.error}`);
                hasErrors = true;
                break;
        }
    }

    // Exit if no sessions to process
    if (toProcess.length === 0) {
        if (hasErrors) {
            process.exit(1);
        }
        return;
    }

    // Deduplicate resolved paths (in case multiple inputs resolve to same file)
    const uniquePaths = [...new Set(toProcess)];

    // Handle API JSON export mode
    if (options.apiJson) {
        const exporter = new ApiExporter();
        const allMessages = [];

        for (const filePath of uniquePaths) {
            try {
                const result = await exporter.extract(filePath);

                // Warn about summarized history on stderr
                if (result.metadata.hasSummaries) {
                    console.error(`Warning: ${filePath} contains summarized history. Export may be incomplete.`);
                }

                allMessages.push(...result.messages);
            } catch (error) {
                console.error(`Error extracting ${filePath}:`);
                console.error(error.message);
                hasErrors = true;
            }
        }

        // Output clean JSON to stdout
        console.log(JSON.stringify({ messages: allMessages }, null, 2));
        return;
    }

    // Process all resolved sessions (display mode)
    for (const filePath of uniquePaths) {
        try {
            console.log(`\n=== Parsing: ${filePath} ===\n`);
            const processor = new TranscriptProcessor(options);
            await processor.process(filePath);
        } catch (error) {
            console.error(`Error processing ${filePath}:`);
            console.error(error.message);
            if (process.env.DEBUG) {
                console.error('\nStack trace:');
                console.error(error.stack);
            }
            hasErrors = true;
        }
    }

    if (hasErrors) {
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
    SessionResolver,
    TranscriptProcessor,
    ApiExporter,
    RESOLVE_TYPE,
    DEFAULT_OPTIONS,
};