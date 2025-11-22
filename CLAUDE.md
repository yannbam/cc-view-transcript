# cc-view-transcript

Production-ready CLI tool for viewing Claude Code session transcripts in human-readable format.

## What is this?

Parses Claude Code session JSONL files and displays the conversation flow:
- Human messages
- Claude's responses (text + thinking)
- Tool calls and results
- Session metadata

**Philosophy:** Keep it simple. Handpick only the most important fields from the schema—don't try to implement everything.

## Schema Reference

Full Claude Code session JSONL schema:
`/home/jan/cc-misc/cc-jsonl/scripts/current-schema.json`

**Important:** We don't implement the full schema. We extract only what matters for human readability:
- Message types: user, assistant, system
- Content blocks: text, thinking, tool_use, tool_result
- Essential metadata: sessionId, timestamp, cwd
- Tool execution details: name, input, output

## Coding Guidelines

**KISS - Keep It Simple:**
- Don't overengineer
- Single file architecture (no sprawling modules)
- Stream-based processing (memory efficient)
- Clear class separation (Parser, Formatter, Metadata, Processor, CLI)

**Code Organization:**
- Each class has a single responsibility
- Methods do one thing well
- Clear comments explaining intent
- Consistent formatting

**Extensibility:**
- Design for future features without adding them prematurely
- Use TODO comments for planned features
- Keep the architecture flexible but simple

**Honesty:**
- Never claim features that aren't implemented
- Add TODO comments for incomplete features
- Remove or comment out unimplemented options

**Display Integrity:**
- NEVER remove content from display without indicating something is hidden
- When filtering/hiding content, always show a one-line replacement
- Make it clear what's being hidden and why
- User should always know the full scope of the transcript

**Display Completeness:**
- Display ALL data contained in tool results and other messages
- Err on the side of showing TOO MUCH rather than hiding fields
- Let JSON formatting do the heavy lifting (pretty-print structured data)
- Only handpick specific fields when absolutely necessary and high-confidence
- Schema will change in the future—don't make assumptions about what's "important"

**Implementation Process:**
- When implementing new features/parsing, ALWAYS look at actual session JSONL first
- The schema is for orientation only—it may have errors or missing fields
- Real data is the source of truth, not the schema
- Test with actual transcripts, not just synthetic examples

## Features to Implement

**Next Up (Current Issues):**
- [ ] Fix --truncate to apply to ALL message types, not just tools
- [ ] Fix --no-thinking: show one-line replacement instead of hiding completely
- [ ] Fix --no-tools: show one-line summary (tool name + success/failure) instead of hiding
- [ ] Add pretty-print for structured tool results (like tool inputs)
- [ ] Verify MCP tool results parse correctly (different structure than built-in tools)
  - Built-in tools (Bash, Write, etc.): return structured objects → need JSON.stringify
  - MCP tools: return ContentBlock arrays → currently only shows first block's text
  - May need to handle multiple content blocks from MCP tools

**Phase 2 - UX Improvements:**
- [ ] Add message index
- [ ] Pagination for large sessions
- [ ] Overview mode
- [ ] Jump to specific message by index/ID

**Phase 3 - Advanced Parsing:**
- [ ] Sub-agent transcript parsing
- [ ] Extract and display sub-agent conversations inline

**Phase 4 - Output Formats:**
- [ ] Compact mode
- [ ] Minimal mode
- [ ] JSON output mode (structured data)
- [ ] Markdown export

**Maybe Later:**
- [ ] Colorized output (terminal colors)
- [ ] Interactive mode (TUI)

## Current Status

✅ **Working:**
- JSONL parsing (stream-based)
- Message extraction (user, assistant, system)
- Content block parsing (text, thinking, tools)
- Metadata display
- Filtering options (--no-thinking, --no-tools, etc.)
- Truncation for long tool I/O
- Session ID lookup

❌ **Not Yet Implemented:**
- Sub-agent transcript parsing
- Output format variations
- Pagination/navigation
- Search/filter features
