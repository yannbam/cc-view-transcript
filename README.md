# cc-view-transcript

CLI tool for viewing Claude Code session transcripts in human-readable format.

## Installation

```bash
# Clone and make executable
chmod +x cc-view-transcript.js

# Optionally add to PATH or create alias
ln -s $(pwd)/cc-view-transcript.js ~/bin/cc-view-transcript
```

## Usage

```
cc-view-transcript <session-refs...> [options]
```

### Session References

The tool accepts multiple flexible session references:

| Input Type | Example | Description |
|------------|---------|-------------|
| Session ID prefix | `abc123` | Finds sessions starting with this prefix |
| Full UUID | `4eea8d85-c8b7-4da3-...` | Exact session match |
| File path | `./session.jsonl` | Direct path to transcript file |
| Directory | `.` or `/path/to/project` | Lists sessions for that project |

### Options

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help message |
| `--no-thinking` | Hide thinking blocks (shows one-line indicator) |
| `--no-tools` | Hide tool calls and results (shows one-line indicator) |
| `--no-metadata` | Hide session metadata header |
| `--no-system` | Hide system messages (fully suppressed) |
| `--no-timestamps` | Hide timestamps from message headers |
| `--truncate` | Truncate long content |
| `--max-length <n>` | Max length for truncated content (default: 500) |
| `--exclude-agents` | Exclude agent sessions from listings |
| `--latest` | Auto-select most recent session |
| `--api-json` | Export as Anthropic API messages JSON |

### Examples

```bash
# View session by prefix (auto-selects if unique match)
cc-view-transcript 4eea

# View most recent session in current project
cc-view-transcript . --latest

# View multiple sessions
cc-view-transcript abc123 def456 ghi789

# List all sessions for current project without agents
cc-view-transcript . --exclude-agents

# Compact view without thinking blocks
cc-view-transcript 4eea --no-thinking --no-tools

# Direct file path
cc-view-transcript ~/.claude/projects/-home-jan-myproject/session.jsonl
```

## Session Resolution

When given a prefix or directory:

1. **Unique match** → Opens that session
2. **Multiple matches** → Shows candidate list with:
   - Session ID
   - Project directory (encoded)
   - Last modified date (local time with timezone offset)
   - File size
   - Agent sessions nested under parent (use `--exclude-agents` to hide)

Sessions are listed oldest-first with newest at bottom (natural terminal scrollback order).

Use `--latest` to auto-pick the most recently modified session.

## API Export

Export a session as Anthropic API-compatible JSON for use with the Messages API:

```bash
# Export to stdout
cc-view-transcript 4eea --api-json

# Save to file
cc-view-transcript 4eea --api-json > conversation.json

# Pipe to jq for inspection
cc-view-transcript 4eea --api-json | jq '.messages | length'
```

The output is a JSON object with a `messages` array ready for the Anthropic API:

```json
{
  "messages": [
    {"role": "user", "content": "Hello!"},
    {"role": "assistant", "content": [{"type": "text", "text": "Hi!"}]},
    ...
  ]
}
```

**Features:**
- Reconstructs streaming chunks into complete messages
- Merges consecutive tool_results (Bedrock compatible)
- Preserves thinking blocks with signatures
- Skips sidechains (agents) and system hooks
- Warns on stderr if session has summarized history

**Note:** Runtime context injections (system-reminders) are not stored in JSONL and cannot be exported.

## Output Format

The transcript displays:
- **Session metadata** - ID, project path, start time, message/tool counts, sub-agent indicator
- **Human messages** - User input with timestamp and line number (L-prefix)
- **Claude responses** - Text output with timestamp and line number
- **Thinking blocks** - Claude's reasoning (hideable with `--no-thinking`)
- **Tool calls** - Tool name, ID, input (hideable with `--no-tools`)
- **Tool results** - Output, errors, status with pretty-printed JSON
- **System messages** - Hooks and notifications (hideable with `--no-system`)

All timestamps display local time with timezone offset (e.g., `2025-12-29T10:30:45 +01:00`).

## File Locations

Claude Code stores sessions in:
```
~/.claude/projects/<encoded-project-path>/
├── <uuid>.jsonl           # Main sessions
└── agent-<id>.jsonl       # Sub-agent sessions
```

Project paths are encoded by replacing non-alphanumeric characters with hyphens:
- `/home/jan/my-project` → `-home-jan-my-project`
