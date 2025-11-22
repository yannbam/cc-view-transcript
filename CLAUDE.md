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

## Features to Implement

**Phase 2 - UX Improvements:**
- [ ] Pagination for large sessions
- [ ] Table of contents / overview mode
- [ ] Search/filter within transcript
- [ ] Jump to specific message by index/ID

**Phase 3 - Advanced Parsing:**
- [ ] Sub-agent transcript parsing (recursive)
- [ ] Extract and display sub-agent conversations inline
- [ ] Show sub-agent metadata and nesting levels

**Phase 4 - Output Formats:**
- [ ] Compact mode (minimal details)
- [ ] Minimal mode (conversation only, no tools)
- [ ] JSON output mode (structured data)
- [ ] Markdown export

**Maybe Later:**
- [ ] Colorized output (terminal colors)
- [ ] Interactive mode (TUI)
- [ ] Stats/analytics mode
- [ ] Diff between two sessions

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
