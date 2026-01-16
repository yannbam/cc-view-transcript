# cc-view-transcript

Production-ready CLI tool for viewing Claude Code session transcripts in human-readable format.

## What is this?

Parses Claude Code session JSONL files and displays the conversation flow:
- Human messages
- Claude's responses (text + thinking)
- Tool calls and results
- Session metadata

**Philosophy:** Keep it simple. Handpick only the most important fields from the schema—don't try to implement everything.

## Git Workflow

**KISS - One Branch Rule:**
- All development work happens on the `dev` branch
- Do NOT create feature branches - work directly on `dev`
- When work is complete, tested, reviewed, and tested again: create a PR from `dev` → `main`
- Merge PRs **without deleting** the `dev` branch
- After merge, pull latest main into dev to stay in sync

**The Flow:**
```
1. git checkout dev
2. [do work, commit, test, review]
3. git push origin dev
4. Create PR: dev → main
5. Merge PR (do NOT delete dev branch)
6. git checkout dev && git pull origin main
```

**Why?**
- Simpler mental model
- No branch management chaos
- No accidental deletions
- Always know where to work

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

**Completed (verified 2026-01-16):**
- [x] --truncate applies to ALL message types (thinking, responses, human, tools)
- [x] --no-thinking: shows one-line indicator `● 🐱💭 [THINKING BLOCK HIDDEN]`
- [x] --no-tools: shows one-line summary with tool name + status
- [x] --no-system: fully suppresses system messages (no indicator)
- [x] --no-timestamps: hides timestamps from message headers
- [x] --no-metadata: hides session metadata header
- [x] --exclude-agents: excludes agent sessions from listings
- [x] --latest: auto-selects most recent session
- [x] --api-json: Export as Anthropic API messages JSON (preserves thinking signatures)
- [x] Pretty-print for structured tool results (JSON.stringify with indentation)
- [x] MCP tool results parse correctly (handles ContentBlock arrays, multiple blocks, non-text blocks)
- [x] Line number index (L-prefix) on all message headers
- [x] Local time with timezone offset in all timestamps
- [x] Session listing: oldest first, newest at bottom (natural terminal order)
- [x] Agent sessions nested under parent sessions in listings
- [x] Multiple session references support

**Phase 2 - UX Improvements:**
- [x] Add message index (line numbers with L-prefix) ✓
- [ ] Pagination for large sessions
- [ ] Overview mode
- [ ] Jump to specific message by index/ID

**Phase 3 - Advanced Parsing:**
- [ ] Sub-agent transcript parsing
- [ ] Extract and display sub-agent conversations inline
- [ ] Branch/sub-session separators (resume, compaction, clear, rewind points)

**Phase 4 - Output Formats:**
- [ ] Verbose mode (--verbose): include message uuid, parentUuid
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
- Metadata display with message/tool counts
- Filtering options with one-line indicators (--no-thinking, --no-tools)
- System message suppression (--no-system, fully hidden)
- Universal truncation (--truncate applies to ALL content types)
- Session resolution: file paths, UUIDs, prefixes, directories
- Multiple session references in single command
- Agent session nesting in listings (--exclude-agents to hide)
- Pretty-print for JSON tool results
- MCP and built-in tool result parsing
- API JSON export (--api-json) with thinking signature preservation
- Line number index (L-prefix) on message headers
- Local time with timezone offset throughout
- Session listing: oldest→newest (newest at bottom)

❌ **Not Yet Implemented:**
- Sub-agent transcript parsing (inline display)
- Branch/session separators (resume, compaction, rewind points)
- Verbose mode (message uuid, parentUuid)
- Output format variations (compact, minimal, markdown)
- Pagination/navigation
- Jump to specific message by index
- Colorized output
